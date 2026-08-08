"use node";

import { v } from "convex/values";
import { embed, embedMany } from "ai";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EMBEDDING_MODEL, openaiProvider } from "./ai/models";
import { LINK_THRESHOLD, MAX_LINKS_PER_ENRICH } from "./ai/limits";

type BackfillEmbeddingsResult = {
  embedded: number;
  scheduledNextBatch: boolean;
};

// The silent work after every capture: embed, search for resonant older
// thinking, and link related thoughts. Nothing here notifies anyone.
export const enrich = internalAction({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const thought = await ctx.runQuery(internal.store.getThought, { thoughtId });
    if (!thought) return;
    const openai = openaiProvider();

    const { embedding } = await embed({
      model: openai.textEmbedding(EMBEDDING_MODEL),
      value: thought.text,
    });
    await ctx.runMutation(internal.store.patchThoughtEmbedding, {
      thoughtId,
      embedding,
    });

    // Resting thoughts stay searchable so older thinking can still connect.
    const thoughtHits = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 8,
      filter: (q) => q.eq("userId", thought.userId),
    });

    const byThought = new Map<Id<"thoughts">, number>();
    for (const hit of thoughtHits) {
      byThought.set(hit._id, Math.max(byThought.get(hit._id) ?? 0, hit._score));
    }
    byThought.delete(thoughtId);

    // alreadyLinked includes dismissed pairs — a dismissed link is never
    // re-offered.
    const alreadyLinked = new Set(
      await ctx.runQuery(internal.store.linkedThoughtIds, { thoughtId }),
    );
    const offerable = [...byThought.entries()]
      .filter(([id, score]) => score >= LINK_THRESHOLD && !alreadyLinked.has(id))
      .sort((a, b) => b[1] - a[1]);
    for (const [toId, score] of offerable.slice(0, MAX_LINKS_PER_ENRICH)) {
      await ctx.runMutation(internal.store.insertConnection, {
        fromId: thoughtId,
        toId,
        score,
      });
    }
  },
});

// One-time catch-up for thoughts captured before embeddings were introduced.
// Run with: bunx convex run enrichment:backfillEmbeddings
export const backfillEmbeddings = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<BackfillEmbeddingsResult> => {
    const thoughts = await ctx.runQuery(internal.store.unembedded, {
      cursor: cursor ?? null,
    });
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
        { cursor: thoughts.continueCursor },
      );
    }
    return { embedded, scheduledNextBatch: !thoughts.isDone };
  },
});
