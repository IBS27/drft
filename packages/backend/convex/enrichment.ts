"use node";

import { v } from "convex/values";
import { embedMany } from "ai";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EMBEDDING_MODEL, openaiProvider } from "./ai/models";
import { LINK_CANDIDATES } from "./ai/limits";

type BackfillEmbeddingsResult = {
  embedded: number;
  scheduledNextBatch: boolean;
};

const BACKFILL_PAGE_SIZE = 100;
// One more than the linker weighs: a thought that already has an
// embedding finds itself first.
const SEARCH_LIMIT = LINK_CANDIDATES + 1;

// The silent work after every capture: embed, search for resonant older
// thinking, and link related thoughts. Nothing here notifies anyone.
// One read (which also re-checks permission, right before the text leaves
// for OpenAI), the embedding, the search, one write.
export const enrich = internalAction({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    await enrichThoughts(ctx, [thoughtId]);
  },
});

// The same for a page of thoughts at once — what was captured while
// permission was missing (consent.catchUp). One request embeds them all;
// each is then searched and written in turn, so a thought can link to the
// ones before it in the same page.
export const enrichMany = internalAction({
  args: { thoughtIds: v.array(v.id("thoughts")) },
  handler: async (ctx, { thoughtIds }) => {
    await enrichThoughts(ctx, thoughtIds);
  },
});

async function enrichThoughts(ctx: ActionCtx, thoughtIds: Id<"thoughts">[]) {
  const { thoughts, searchLegacyIndex } = await ctx.runQuery(
    internal.store.enrichmentContext,
    { thoughtIds },
  );
  if (thoughts.length === 0) return;
  const openai = openaiProvider();
  const { embeddings } = await embedMany({
    model: openai.textEmbedding(EMBEDDING_MODEL),
    values: thoughts.map((t) => t.text),
  });

  for (let i = 0; i < thoughts.length; i++) {
    const { _id: thoughtId, userId } = thoughts[i];
    const vector = embeddings[i];
    // Resting thoughts stay searchable so older thinking can still connect.
    const hits = await ctx.vectorSearch("thoughtEmbeddings", "by_embedding", {
      vector,
      limit: SEARCH_LIMIT,
      filter: (q) => q.eq("userId", userId),
    });
    // Until the backfill has moved them (migrationState.ts), older
    // embeddings are still on their thoughts; the strongest of both
    // searches are the strongest overall.
    const legacyHits = searchLegacyIndex
      ? await ctx.vectorSearch("thoughts", "by_embedding", {
          vector,
          limit: SEARCH_LIMIT,
          filter: (q) => q.eq("userId", userId),
        })
      : [];
    await ctx.runMutation(internal.store.enriched, {
      thoughtId,
      embedding: vector,
      neighbours: [
        ...hits.map((hit) => ({ embeddingId: hit._id, score: hit._score })),
        ...legacyHits.map((hit) => ({ thoughtId: hit._id, score: hit._score })),
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT),
    });
  }
}

// One-time catch-up for thoughts captured before embeddings were introduced.
// Only thoughts whose owner allowed connections are sent (store.unembedded).
// Run with: bunx convex run enrichment:backfillEmbeddings
export const backfillEmbeddings = internalAction({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { cursor, pageSize },
  ): Promise<BackfillEmbeddingsResult> => {
    const boundedPageSize = Math.max(
      1,
      Math.min(BACKFILL_PAGE_SIZE, Math.floor(pageSize ?? BACKFILL_PAGE_SIZE)),
    );
    const thoughts = await ctx.runQuery(internal.store.unembedded, {
      cursor: cursor ?? null,
      pageSize: boundedPageSize,
    });

    // Never embed an incomplete page or advance past it. Shrinking both the
    // row and byte-bounded scan makes progress without split-range bookkeeping.
    if (thoughts.pageStatus === "SplitRequired") {
      if (boundedPageSize === 1) {
        throw new Error("A single thought exceeds the backfill read limit");
      }
      const retryArgs: { cursor?: string; pageSize: number } = {
        pageSize: Math.max(1, Math.floor(boundedPageSize / 2)),
      };
      if (cursor !== undefined) retryArgs.cursor = cursor;
      await ctx.scheduler.runAfter(
        0,
        internal.enrichment.backfillEmbeddings,
        retryArgs,
      );
      return { embedded: 0, scheduledNextBatch: true };
    }

    let embedded = 0;
    if (thoughts.page.length > 0) {
      const openai = openaiProvider();
      const { embeddings } = await embedMany({
        model: openai.textEmbedding(EMBEDDING_MODEL),
        values: thoughts.page.map((t) => t.text),
      });
      for (let i = 0; i < thoughts.page.length; i++) {
        await ctx.runMutation(internal.store.patchThoughtEmbedding, {
          thoughtId: thoughts.page[i]._id,
          embedding: embeddings[i],
        });
        embedded += 1;
      }
    }

    if (!thoughts.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.enrichment.backfillEmbeddings,
        { cursor: thoughts.continueCursor, pageSize: boundedPageSize },
      );
    }
    return { embedded, scheduledNextBatch: !thoughts.isDone };
  },
});
