import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal reads/writes for enrichment.ts. Actions can't touch the db
// directly, so database access and link uniqueness live here.

export const getThought = internalQuery({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => ctx.db.get(thoughtId),
});

// Thoughts a linker candidate must not duplicate: every thought this one is
// already connected to, dismissed ones included — dismissed
// means "don't re-offer", not "forgot".
export const linkedThoughtIds = internalQuery({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const links = [
      ...(await ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("fromId", thoughtId))
        .collect()),
      ...(await ctx.db
        .query("connections")
        .withIndex("by_to", (q) => q.eq("toId", thoughtId))
        .collect()),
    ];
    return links.map((c) => (c.fromId === thoughtId ? c.toId : c.fromId));
  },
});

export const patchThoughtEmbedding = internalMutation({
  args: { thoughtId: v.id("thoughts"), embedding: v.array(v.float64()) },
  handler: async (ctx, { thoughtId, embedding }) => {
    if (await ctx.db.get(thoughtId)) await ctx.db.patch(thoughtId, { embedding });
  },
});

// The linker's read-then-insert spans an API call, and two enrichments can
// run at once (a seeded batch does) — so uniqueness is enforced here, in
// the transaction. Either direction counts; dismissed pairs stay dead.
export const insertConnection = internalMutation({
  args: {
    fromId: v.id("thoughts"),
    toId: v.id("thoughts"),
    score: v.number(),
  },
  handler: async (ctx, { fromId, toId, score }) => {
    if (fromId === toId) return;
    const around = [
      ...(await ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("fromId", fromId))
        .collect()),
      ...(await ctx.db
        .query("connections")
        .withIndex("by_to", (q) => q.eq("toId", fromId))
        .collect()),
    ];
    if (around.some((c) => c.fromId === toId || c.toId === toId)) return;
    await ctx.db.insert("connections", { fromId, toId, score });
  },
});

// Backfill support for thoughts captured before embeddings were introduced.
export const unembedded = internalQuery({
  args: {},
  handler: async (ctx) => {
    return (await ctx.db.query("thoughts").collect())
      .filter((t) => t.embedding === undefined)
      .map((t) => ({ _id: t._id, text: t.text }));
  },
});
