"use node";

import { v } from "convex/values";
import { embed } from "ai";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EMBEDDING_MODEL, openaiProvider } from "./ai/models";
import { SEARCH_FLOOR } from "./ai/limits";

type Hit = {
  _id: Id<"thoughts">;
  text: string;
  status: "open" | "resting";
  createdAt: number;
};

// Find a thought the way you remember it: by its words, or by its
// feeling. Literal matches come first; then the query is embedded and
// searched against fragments and your own session words (mapped back to
// their thought), the same two places enrichment listens for resonance.
// Resting thoughts are included on purpose — set down, still findable.
export const thoughts = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<Hit[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];
    const userId = identity.subject;

    const literal: Hit[] = await ctx.runQuery(internal.store.literalMatches, {
      userId,
      needle: trimmed,
    });

    const openai = openaiProvider();
    const { embedding } = await embed({
      model: openai.textEmbedding(EMBEDDING_MODEL),
      value: trimmed,
    });
    const thoughtHits = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 12,
      filter: (q) => q.eq("userId", userId),
    });
    const messageHits = await ctx.vectorSearch("messages", "by_embedding", {
      vector: embedding,
      limit: 12,
      filter: (q) => q.eq("userId", userId),
    });
    const sources = await ctx.runQuery(internal.store.messageThoughtIds, {
      ids: messageHits.map((h) => h._id),
    });
    const messageScores = new Map(messageHits.map((h) => [h._id, h._score]));

    const byThought = new Map<Id<"thoughts">, number>();
    for (const hit of thoughtHits) {
      byThought.set(hit._id, Math.max(byThought.get(hit._id) ?? 0, hit._score));
    }
    for (const source of sources) {
      const score = messageScores.get(source._id) ?? 0;
      byThought.set(
        source.thoughtId,
        Math.max(byThought.get(source.thoughtId) ?? 0, score),
      );
    }

    const literalIds = new Set<string>(literal.map((r) => r._id));
    const resonantIds = [...byThought.entries()]
      .filter(([id, score]) => score >= SEARCH_FLOOR && !literalIds.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const resonant: Hit[] = await ctx.runQuery(internal.store.searchRows, {
      userId,
      ids: resonantIds,
    });
    return [...literal, ...resonant].slice(0, 12);
  },
});
