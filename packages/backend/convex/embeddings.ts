import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Where a thought's embedding lives (schema.ts: `thoughtEmbeddings`), for
// the few places that write or look for one. A thought embedded before
// that table existed still carries it inline until
// migrations:backfillFastPaths moves it; both count as "has one", and an
// embedding is only ever in one of the two places.

export async function hasEmbedding(
  ctx: QueryCtx,
  thought: Doc<"thoughts">,
): Promise<boolean> {
  if (thought.embedding !== undefined) return true;
  const row = await ctx.db
    .query("thoughtEmbeddings")
    .withIndex("by_thought", (q) => q.eq("thoughtId", thought._id))
    .first();
  return row !== null;
}

export async function saveEmbedding(
  ctx: MutationCtx,
  thought: Doc<"thoughts">,
  embedding: number[],
) {
  const existing = await ctx.db
    .query("thoughtEmbeddings")
    .withIndex("by_thought", (q) => q.eq("thoughtId", thought._id))
    .first();
  if (existing) await ctx.db.patch(existing._id, { embedding });
  else
    await ctx.db.insert("thoughtEmbeddings", {
      thoughtId: thought._id,
      userId: thought.userId,
      embedding,
    });
  if (thought.embedding !== undefined)
    await ctx.db.patch(thought._id, { embedding: undefined });
}
