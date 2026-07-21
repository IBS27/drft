"use node";

import { v } from "convex/values";
import { embed, embedMany, generateText, Output } from "ai";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EMBEDDING_MODEL, QUESTION_MODEL, openaiProvider } from "./ai/models";
import {
  LINK_THRESHOLD,
  MAX_LINKS_PER_ENRICH,
  MAX_UNSEEN_QUESTIONS,
} from "./ai/limits";
import { captureQuestionsPrompt } from "./ai/prompts";

const questionsSchema = z.object({
  questions: z
    .array(z.string())
    .max(2)
    .describe("Zero, one, or two prepared questions. Empty if nothing good."),
});

// The silent work after every capture: embed, search for resonant older
// thinking, link, draft questions. Nothing here notifies anyone — the
// partner is prepared, but waits.
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

    // Resonance lives in two places: other fragments, and the user's own
    // words in past sessions (which point back at their thought). Resting
    // thoughts stay searchable — "this echoes something you set down in May."
    const thoughtHits = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 8,
      filter: (q) => q.eq("userId", thought.userId),
    });
    const messageHits = await ctx.vectorSearch("messages", "by_embedding", {
      vector: embedding,
      limit: 8,
      filter: (q) => q.eq("userId", thought.userId),
    });
    const messageSources = await ctx.runQuery(internal.store.messageThoughtIds, {
      ids: messageHits.map((h) => h._id),
    });
    const messageScores = new Map(messageHits.map((h) => [h._id, h._score]));

    const byThought = new Map<Id<"thoughts">, number>();
    for (const hit of thoughtHits) {
      byThought.set(hit._id, Math.max(byThought.get(hit._id) ?? 0, hit._score));
    }
    for (const source of messageSources) {
      const score = messageScores.get(source._id) ?? 0;
      byThought.set(
        source.thoughtId,
        Math.max(byThought.get(source.thoughtId) ?? 0, score),
      );
    }
    byThought.delete(thoughtId);

    // alreadyLinked includes dismissed pairs — a dismissed link is never
    // re-offered, not as a chip and not quoted inside a question.
    const alreadyLinked = new Set(
      await ctx.runQuery(internal.store.linkedPartnerIds, { thoughtId }),
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

    // Draft at most two questions to leave waiting. The resonant fragments
    // travel along so a question can reach across the collection.
    const context = await ctx.runQuery(internal.store.thoughtContext, {
      thoughtId,
    });
    if (!context) return;
    const unseen = context.questions.filter((q) => !q.seen).length;
    if (unseen >= MAX_UNSEEN_QUESTIONS) return;
    const resonantTexts = (
      await ctx.runQuery(internal.store.thoughtTexts, {
        ids: offerable.slice(0, 3).map(([id]) => id),
      })
    ).map((t) => t.text);
    const result = await generateText({
      model: openai(QUESTION_MODEL),
      output: Output.object({ schema: questionsSchema }),
      prompt: captureQuestionsPrompt({
        thoughtText: thought.text,
        resonantTexts,
      }),
    });
    const texts = result.output.questions.map((q) => q.trim()).filter(Boolean);
    if (texts.length > 0) {
      // insertQuestions re-checks the unseen cap in-transaction.
      await ctx.runMutation(internal.store.insertQuestions, { thoughtId, texts });
    }
  },
});

// One-time catch-up for thoughts and messages captured before phase 3:
// embeddings only, so they can be found. Links and questions arrive
// naturally as new thinking resonates with them.
// Run with: bunx convex run enrichment:backfillEmbeddings
export const backfillEmbeddings = internalAction({
  args: {},
  handler: async (ctx) => {
    // Ownership first: a message embedding is unsearchable without the
    // userId the vector index filters on.
    await ctx.runMutation(internal.store.backfillMessageUsers, {});
    const { thoughts, messages } = await ctx.runQuery(internal.store.unembedded, {});
    const openai = openaiProvider();
    const model = openai.textEmbedding(EMBEDDING_MODEL);
    let embedded = 0;
    const batch = 100;
    for (let i = 0; i < thoughts.length; i += batch) {
      const slice = thoughts.slice(i, i + batch);
      const { embeddings } = await embedMany({
        model,
        values: slice.map((t) => t.text),
      });
      for (let j = 0; j < slice.length; j++) {
        await ctx.runMutation(internal.store.patchThoughtEmbedding, {
          thoughtId: slice[j]._id,
          embedding: embeddings[j],
        });
        embedded += 1;
      }
    }
    for (let i = 0; i < messages.length; i += batch) {
      const slice = messages.slice(i, i + batch);
      const { embeddings } = await embedMany({
        model,
        values: slice.map((m) => m.text),
      });
      for (let j = 0; j < slice.length; j++) {
        await ctx.runMutation(internal.store.patchMessageEmbedding, {
          messageId: slice[j]._id,
          embedding: embeddings[j],
        });
        embedded += 1;
      }
    }
    return { embedded };
  },
});
