import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { MAX_UNSEEN_QUESTIONS } from "./ai/limits";

const QUESTION_HISTORY_LIMIT = 100;
const CONNECTIONS_PER_DIRECTION_LIMIT = 50;
const QUESTION_COUNT_BACKFILL_BATCH = 64;
const COLLECTION_LIMIT = 500;
const PREVIEW_LIMIT = 160;

const collectionRowValidator = v.object({
  _id: v.id("thoughts"),
  preview: v.string(),
  createdAt: v.number(),
  waiting: v.boolean(),
});

const questionViewValidator = v.object({
  _id: v.id("questions"),
  text: v.string(),
  seen: v.boolean(),
});

const connectionViewValidator = v.object({
  _id: v.id("connections"),
  otherId: v.id("thoughts"),
  otherText: v.string(),
  otherStatus: v.union(v.literal("open"), v.literal("resting")),
});

const messageViewValidator = v.object({
  _id: v.id("messages"),
  role: v.union(v.literal("you"), v.literal("partner")),
  text: v.string(),
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
    waiting: (thought.unseenQuestionCount ?? 0) > 0,
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

// Capture stays dumb: insert text + timestamp, return. Everything
// intelligent (embed, link, questions) happens async in enrichment.ts —
// prepared, but waiting; capture never becomes a conversation.
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
      unseenQuestionCount: 0,
    });
    await ctx.scheduler.runAfter(0, internal.enrichment.enrich, { thoughtId });
    return thoughtId;
  },
});

// The collection: open thoughts, newest first. `waiting` (an unseen
// question) is what lights the vermilion dot. `date` is the client's
// local YYYY-MM-DD — the server has no timezone, so "today" is the
// client's to define; it selects today's resurfaced thought, if any.
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

// Mostly-static thought material. The hot message stream has its own
// paginated query below, so a token patch does not reread this whole margin.
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
      questions: v.array(questionViewValidator),
      connections: v.array(connectionViewValidator),
    }),
  ),
  handler: async (ctx, { thoughtId }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) return null;
    const [questionRows, fromLinks, toLinks, lastReturn] = await Promise.all([
      ctx.db
        .query("questions")
        .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
        .order("desc")
        .take(QUESTION_HISTORY_LIMIT),
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
    const questions = [...questionRows]
      .reverse()
      .map((q) => ({ _id: q._id, text: q.text, seen: q.seenAt !== undefined }));
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
      questions,
      connections,
    };
  },
});

// The append-only, frequently changing part of a thought. Newest-first
// pagination keeps streaming updates inside the first small reactive page.
export const conversation = query({
  args: {
    thoughtId: v.id("thoughts"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(messageViewValidator),
  handler: async (ctx, { thoughtId, paginationOpts }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) {
      return { page: [], continueCursor: "", isDone: true };
    }
    const page = await ctx.db
      .query("messages")
      .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((m) => ({
        _id: m._id,
        role: m.role,
        text: m.text,
      })),
    };
  },
});

async function backfillQuestionCountBatch(
  ctx: MutationCtx,
  userId: string,
): Promise<boolean> {
  const legacy = await ctx.db
    .query("thoughts")
    .withIndex("by_user_and_unseenQuestionCount", (q) =>
      q.eq("userId", userId).eq("unseenQuestionCount", undefined),
    )
    .take(QUESTION_COUNT_BACKFILL_BATCH);
  for (const thought of legacy) {
    const unseen = await ctx.db
      .query("questions")
      .withIndex("by_thought_and_seenAt", (q) =>
        q.eq("thoughtId", thought._id).eq("seenAt", undefined),
      )
      .take(MAX_UNSEEN_QUESTIONS);
    await ctx.db.patch(thought._id, {
      unseenQuestionCount: unseen.length,
    });
  }
  return legacy.length === QUESTION_COUNT_BACKFILL_BATCH;
}

// Compatibility entry point retained for callers from before the migration
// became server-owned. Indexed batches keep it cheap and resumable.
export const ensureQuestionCounts = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    return backfillQuestionCountBatch(ctx, identity.subject);
  },
});

export const backfillQuestionCounts = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }): Promise<null> => {
    const hasMore = await backfillQuestionCountBatch(ctx, userId);
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.thoughts.backfillQuestionCounts,
        { userId },
      );
    }
    return null;
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

// Your side of the conversation. Kept verbatim, like a capture; the
// partner streams a reply and your words get embedded, both async.
export const say = mutation({
  args: { thoughtId: v.id("thoughts"), text: v.string() },
  handler: async (ctx, { thoughtId, text }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) throw new Error("Not found");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Empty message");
    const messageId = await ctx.db.insert("messages", {
      thoughtId,
      userId: thought.userId,
      role: "you",
      text: trimmed,
    });
    await ctx.scheduler.runAfter(0, internal.partner.reply, {
      thoughtId,
      userMessageId: messageId,
    });
    return messageId;
  },
});

// Arriving at a thought is what "sees" its questions — the dot marks
// now, and now is over once you're in the room.
export const markQuestionsSeen = mutation({
  args: { thoughtId: v.id("thoughts") },
  returns: v.null(),
  handler: async (ctx, { thoughtId }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) return null;
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_thought_and_seenAt", (q) =>
        q.eq("thoughtId", thoughtId).eq("seenAt", undefined),
      )
      .take(MAX_UNSEEN_QUESTIONS);
    const now = Date.now();
    for (const q of questions) {
      await ctx.db.patch(q._id, { seenAt: now });
    }
    if (thought.unseenQuestionCount !== 0) {
      await ctx.db.patch(thoughtId, { unseenQuestionCount: 0 });
    }
    return null;
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
