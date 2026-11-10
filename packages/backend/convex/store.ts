import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { LINK_CANDIDATES, LINK_THRESHOLD, MAX_LINKS_PER_ENRICH } from "./ai/limits";
import { allowsAiConnections } from "./consent";
import { hasEmbedding, saveEmbedding } from "./embeddings";
import { migrated } from "./migrationState";

const BACKFILL_PAGE_SIZE = 100;
const BACKFILL_MAXIMUM_BYTES_READ = 4_000_000;

// Internal reads/writes for enrichment.ts. Actions can't touch the db
// directly, so database access and link uniqueness live here.

// Everything an enrichment needs before any text leaves for OpenAI, in one
// read: the thoughts that still exist and whose owner allows connections
// right now — so a capture scheduled before the user turned connections
// off never sends.
export const enrichmentContext = internalQuery({
  args: { thoughtIds: v.array(v.id("thoughts")) },
  handler: async (ctx, { thoughtIds }) => {
    const allowedByUser = new Map<string, boolean>();
    const thoughts = [];
    for (const thoughtId of thoughtIds) {
      const thought = await ctx.db.get(thoughtId);
      if (!thought) continue;
      let allowed = allowedByUser.get(thought.userId);
      if (allowed === undefined) {
        allowed = await allowsAiConnections(ctx, thought.userId);
        allowedByUser.set(thought.userId, allowed);
      }
      if (allowed)
        thoughts.push({ _id: thought._id, userId: thought.userId, text: thought.text });
    }
    return {
      thoughts,
      // Embeddings not yet moved are only findable where they were written.
      searchLegacyIndex: !(await migrated(ctx, "embeddingsMoved")),
    };
  },
});

// The one write of an enrichment: the embedding and the links it earns, in
// a single transaction — the thought's page updates once, and a thought is
// never left embedded but unlinked by a failure in between.
//
// `neighbours` is what the vector search returned. Which of them become
// links is decided here, where the answer can't go stale: the strongest
// few other thoughts, resonant enough, not already linked. The action has
// been away at the API, so the thought, its owner's permission and each
// far end are checked again first.
export const enriched = internalMutation({
  args: {
    thoughtId: v.id("thoughts"),
    embedding: v.array(v.float64()),
    neighbours: v.array(
      v.union(
        v.object({ embeddingId: v.id("thoughtEmbeddings"), score: v.number() }),
        // A hit from the legacy index on thoughts (see migrationState.ts).
        v.object({ thoughtId: v.id("thoughts"), score: v.number() }),
      ),
    ),
  },
  handler: async (ctx, { thoughtId, embedding, neighbours }) => {
    const thought = await ctx.db.get(thoughtId);
    if (!thought || !(await allowsAiConnections(ctx, thought.userId))) return;
    await saveEmbedding(ctx, thought, embedding);

    const seen = new Set<Id<"thoughts">>();
    let weighed = 0;
    let linked = 0;
    for (const hit of [...neighbours].sort((a, b) => b.score - a.score)) {
      if (
        hit.score < LINK_THRESHOLD ||
        weighed === LINK_CANDIDATES ||
        linked === MAX_LINKS_PER_ENRICH
      )
        break;
      const toId =
        "thoughtId" in hit
          ? hit.thoughtId
          : (await ctx.db.get(hit.embeddingId))?.thoughtId;
      // A thought enriched again finds itself first; that is not a neighbour.
      // Nor is one already weighed: while embeddings are being moved, the
      // same thought can come back from both searches.
      if (toId === thoughtId || (toId && seen.has(toId))) continue;
      if (toId) seen.add(toId);
      weighed += 1;
      if (toId && (await link(ctx, thought, toId, hit.score))) linked += 1;
    }
  },
});

// Two enrichments can run at once (a seeded batch does), so uniqueness is
// enforced here, in the transaction. Either direction counts, and a
// dismissed pair stays dead — dismissed means "don't re-offer", not
// "forgot". Either end may also have been deleted (account deletion)
// while the action was out at the API; never link to nothing, and never
// across owners.
async function link(
  ctx: MutationCtx,
  from: Doc<"thoughts">,
  toId: Id<"thoughts">,
  score: number,
): Promise<boolean> {
  if (from._id === toId) return false;
  const to = await ctx.db.get(toId);
  if (!to || to.userId !== from.userId) return false;
  for (const [a, b] of [
    [from._id, toId],
    [toId, from._id],
  ]) {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_from_and_to", (q) => q.eq("fromId", a).eq("toId", b))
      .first();
    if (existing) return false;
  }
  await ctx.db.insert("connections", {
    fromId: from._id,
    toId,
    score,
    userId: from.userId,
  });
  return true;
}

// Stores an embedding without linking: the one-time backfill
// (enrichment.backfillEmbeddings).
export const patchThoughtEmbedding = internalMutation({
  args: { thoughtId: v.id("thoughts"), embedding: v.array(v.float64()) },
  handler: async (ctx, { thoughtId, embedding }) => {
    const thought = await ctx.db.get(thoughtId);
    if (thought) await saveEmbedding(ctx, thought, embedding);
  },
});

// Backfill support for thoughts captured before embeddings were introduced.
// The page advances over every thought, but only those whose owner allowed
// connections are returned for embedding.
export const unembedded = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    pageSize: v.number(),
  },
  handler: async (ctx, { cursor, pageSize }) => {
    const boundedPageSize = Math.max(
      1,
      Math.min(BACKFILL_PAGE_SIZE, Math.floor(pageSize)),
    );
    const result = await ctx.db
      .query("thoughts")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .paginate({
        cursor,
        numItems: boundedPageSize,
        maximumRowsRead: boundedPageSize,
        maximumBytesRead: BACKFILL_MAXIMUM_BYTES_READ,
      });
    const allowedByUser = new Map<string, boolean>();
    const page = [];
    for (const t of result.page) {
      if (await hasEmbedding(ctx, t)) continue;
      let allowed = allowedByUser.get(t.userId);
      if (allowed === undefined) {
        allowed = await allowsAiConnections(ctx, t.userId);
        allowedByUser.set(t.userId, allowed);
      }
      if (allowed) page.push({ _id: t._id, text: t.text });
    }
    return { ...result, page };
  },
});

// The three calls the previous `enrich` made. An action that was already
// out at the API when this release deployed finishes on its old code and
// still calls them by name; they keep its capture from going unlinked.
// Nothing new calls them — remove with the legacy paths
// (migrationState.ts).

export const getThought = internalQuery({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => ctx.db.get(thoughtId),
});

export const linkedThoughtIds = internalQuery({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const links = [
      ...(await ctx.db
        .query("connections")
        .withIndex("by_from_and_dismissedAt", (q) => q.eq("fromId", thoughtId))
        .collect()),
      ...(await ctx.db
        .query("connections")
        .withIndex("by_to_and_dismissedAt", (q) => q.eq("toId", thoughtId))
        .collect()),
    ];
    return links.map((c) => (c.fromId === thoughtId ? c.toId : c.fromId));
  },
});

export const insertConnection = internalMutation({
  args: {
    fromId: v.id("thoughts"),
    toId: v.id("thoughts"),
    score: v.number(),
  },
  handler: async (ctx, { fromId, toId, score }) => {
    const from = await ctx.db.get(fromId);
    if (from) await link(ctx, from, toId, score);
  },
});
