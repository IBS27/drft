import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

const CONNECTIONS_PER_DIRECTION_LIMIT = 50;
const CONNECTIONS_PER_GRAPH_THOUGHT_LIMIT = 50;
const COLLECTION_LIMIT = 500;
const PREVIEW_LIMIT = 160;

const collectionRowValidator = v.object({
  _id: v.id("thoughts"),
  preview: v.string(),
  createdAt: v.number(),
});

const connectionViewValidator = v.object({
  _id: v.id("connections"),
  otherId: v.id("thoughts"),
  otherText: v.string(),
  otherStatus: v.union(v.literal("open"), v.literal("resting")),
});

const graphThoughtValidator = v.object({
  _id: v.id("thoughts"),
  text: v.string(),
  createdAt: v.number(),
  status: v.union(v.literal("open"), v.literal("resting")),
  connections: v.array(
    v.object({
      _id: v.id("connections"),
      toId: v.id("thoughts"),
    }),
  ),
});

function preview(text: string): string {
  const line = text.split(/\r?\n/).find((part) => part.trim().length > 0);
  return (line?.trim() ?? "").slice(0, PREVIEW_LIMIT);
}

function collectionRow(thought: Doc<"thoughts">) {
  return {
    _id: thought._id,
    preview: preview(thought.text),
    createdAt: thought.createdAt,
  };
}

// A thought is only ever yours. Every read/write below goes through this.
async function ownedThought(ctx: QueryCtx, thoughtId: Id<"thoughts">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const thought = await ctx.db.get(thoughtId);
  if (!thought || thought.userId !== identity.subject) return null;
  return thought;
}

// Capture stays dumb: insert text + timestamp, return. Embedding and linking
// happen asynchronously in enrichment.ts.
export const capture = mutation({
  args: { text: v.string() },
  returns: v.id("thoughts"),
  handler: async (ctx, { text }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Empty thought");
    const thoughtId = await ctx.db.insert("thoughts", {
      userId: identity.subject,
      text: trimmed,
      createdAt: Date.now(),
      status: "open",
    });
    await ctx.scheduler.runAfter(0, internal.enrichment.enrich, { thoughtId });
    return thoughtId;
  },
});

// The collection: open thoughts, newest first. `date` is the client's local
// YYYY-MM-DD — the server has no timezone, so "today" is the client's to
// define; it selects today's resurfaced thought, if any.
export const collection = query({
  args: { date: v.string() },
  returns: v.object({
    thoughts: v.array(collectionRowValidator),
    resurfacedId: v.union(v.id("thoughts"), v.null()),
  }),
  handler: async (ctx, { date }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { thoughts: [], resurfacedId: null };
    const open = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", identity.subject).eq("status", "open"),
      )
      .order("desc")
      .take(COLLECTION_LIMIT);
    const thoughts = open.map(collectionRow);
    const today = await ctx.db
      .query("resurfacings")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", identity.subject).eq("date", date),
      )
      .first();
    // The rotation reaches for what has waited longest, so today's thought
    // is often older than this page's oldest row. It is the one thing on
    // this screen that must never be missing: fetch it by hand and carry
    // it in. (Ordering is the client's; it pins by id.)
    let resurfacedId: Id<"thoughts"> | null = null;
    if (today && open.some((t) => t._id === today.thoughtId)) {
      resurfacedId = today.thoughtId;
    } else if (today) {
      const pinned = await ctx.db.get(today.thoughtId);
      if (pinned?.userId === identity.subject && pinned.status === "open") {
        resurfacedId = pinned._id;
        thoughts.push(collectionRow(pinned));
      }
    }
    return { thoughts, resurfacedId };
  },
});

// Every thought and every live resonance, page by page, for the desktop
// connections field. A link is returned with its source thought, so walking
// the user's indexed thought pages also walks the graph without scanning the
// global connections table or adding ownership data to every existing edge.
export const connectionGraph = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(graphThoughtValidator),
  handler: async (ctx, { paginationOpts }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        page: [],
        continueCursor: "",
        isDone: true,
      };
    }
    const result = await ctx.db
      .query("thoughts")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .paginate(paginationOpts);

    const page = await Promise.all(
      result.page.map(async (thought) => {
        const candidates = await ctx.db
          .query("connections")
          .withIndex("by_from_and_dismissedAt", (q) =>
            q.eq("fromId", thought._id).eq("dismissedAt", undefined),
          )
          .take(CONNECTIONS_PER_GRAPH_THOUGHT_LIMIT);
        const connections = (
          await Promise.all(
            candidates.map(async (connection) => {
              const other = await ctx.db.get(connection.toId);
              return other?.userId === identity.subject
                ? { _id: connection._id, toId: connection.toId }
                : null;
            }),
          )
        ).filter((connection) => connection !== null);
        return {
          _id: thought._id,
          text: thought.text,
          createdAt: thought.createdAt,
          status: thought.status,
          connections,
        };
      }),
    );

    return { ...result, page };
  },
});

// The thought, its connections, and its return/rest state.
export const view = query({
  args: { thoughtId: v.id("thoughts") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("thoughts"),
      text: v.string(),
      createdAt: v.number(),
      status: v.union(v.literal("open"), v.literal("resting")),
      restingNote: v.optional(v.string()),
      restedAt: v.optional(v.number()),
      lastReturnedAt: v.union(v.number(), v.null()),
      connections: v.array(connectionViewValidator),
    }),
  ),
  handler: async (ctx, { thoughtId }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) return null;
    const [fromLinks, toLinks, lastReturn] = await Promise.all([
      ctx.db
        .query("connections")
        .withIndex("by_from_and_dismissedAt", (q) =>
          q.eq("fromId", thoughtId).eq("dismissedAt", undefined),
        )
        .take(CONNECTIONS_PER_DIRECTION_LIMIT),
      ctx.db
        .query("connections")
        .withIndex("by_to_and_dismissedAt", (q) =>
          q.eq("toId", thoughtId).eq("dismissedAt", undefined),
        )
        .take(CONNECTIONS_PER_DIRECTION_LIMIT),
      ctx.db
        .query("resurfacings")
        .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
        .order("desc")
        .first(),
    ]);
    const links = [...fromLinks, ...toLinks].sort((a, b) => b.score - a.score);
    const connections = (
      await Promise.all(
        links.map(async (c) => {
          const otherId = c.fromId === thoughtId ? c.toId : c.fromId;
          const other = await ctx.db.get(otherId);
          return other && other.userId === thought.userId
            ? {
                _id: c._id,
                otherId,
                otherText: other.text,
                otherStatus: other.status,
              }
            : null;
        }),
      )
    ).filter((c) => c !== null);
    return {
      _id: thought._id,
      text: thought.text,
      createdAt: thought.createdAt,
      status: thought.status,
      restingNote: thought.restingNote,
      restedAt: thought.restedAt,
      lastReturnedAt: lastReturn?._creationTime ?? null,
      connections,
    };
  },
});

// Thoughts that were set down. Still part of your thinking's history.
export const resting = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    // Ordered by the index, not in memory: sorting a truncated page would
    // cut the oldest-*captured* thoughts and then claim to be the most
    // recently set down.
    const rows = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status_restedAt", (q) =>
        q.eq("userId", identity.subject).eq("status", "resting"),
      )
      .order("desc")
      .take(COLLECTION_LIMIT);
    return rows.map((t) => ({
      _id: t._id,
      preview: preview(t.text),
      restedAt: t.restedAt,
      restingNote: t.restingNote,
    }));
  },
});

// The one transition, and the user makes it. Optional single line about
// where it landed; reversible.
export const rest = mutation({
  args: { thoughtId: v.id("thoughts"), note: v.optional(v.string()) },
  handler: async (ctx, { thoughtId, note }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) throw new Error("Not found");
    const trimmed = note?.trim();
    await ctx.db.patch(thoughtId, {
      status: "resting",
      restedAt: Date.now(),
      restingNote: trimmed || undefined,
    });
  },
});

// Some thoughts wake up.
export const wake = mutation({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) throw new Error("Not found");
    await ctx.db.patch(thoughtId, {
      status: "open",
      restedAt: undefined,
      restingNote: undefined,
    });
  },
});

// One click to dismiss a bad link. Dismissed, not deleted — phase 3's
// linker uses dismissedAt to know not to re-offer it.
export const dismissConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) return;
    const from = await ownedThought(ctx, connection.fromId);
    if (!from) throw new Error("Not found");
    await ctx.db.patch(connectionId, { dismissedAt: Date.now() });
  },
});

// And one click back — a dismissal shouldn't be the one irreversible act
// in a product where even resting is reversible. The linker still won't
// re-offer the pair on its own; only the user brings it back.
export const undismissConnection = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) return;
    const from = await ownedThought(ctx, connection.fromId);
    if (!from) throw new Error("Not found");
    await ctx.db.patch(connectionId, { dismissedAt: undefined });
  },
});
