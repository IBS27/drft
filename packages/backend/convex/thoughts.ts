import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

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

// The collection count — a fact, never a scoreboard.
export const count = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const open = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", identity.subject).eq("status", "open"),
      )
      .collect();
    return open.length;
  },
});

// The collection: open thoughts, newest first. `waiting` (an unseen
// question) is what lights the vermilion dot. `date` is the client's
// local YYYY-MM-DD — the server has no timezone, so "today" is the
// client's to define; it selects today's resurfaced thought, if any.
export const collection = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { thoughts: [], resurfacedId: null };
    const open = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", identity.subject).eq("status", "open"),
      )
      .order("desc")
      .collect();
    const thoughts = await Promise.all(
      open.map(async (t) => {
        const questions = await ctx.db
          .query("questions")
          .withIndex("by_thought", (q) => q.eq("thoughtId", t._id))
          .collect();
        return {
          _id: t._id,
          text: t.text,
          createdAt: t.createdAt,
          waiting: questions.some((q) => q.seenAt === undefined),
        };
      }),
    );
    const todays = await ctx.db
      .query("resurfacings")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();
    const mine = todays.find((r) => open.some((t) => t._id === r.thoughtId));
    return { thoughts, resurfacedId: mine?.thoughtId ?? null };
  },
});

// Everything the thought view needs, in one reactive read: the fragment,
// the partner's prepared questions, the session so far, and undismissed
// connections resolved to the other thought's words.
export const view = query({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) return null;
    const questions = (
      await ctx.db
        .query("questions")
        .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
        .collect()
    ).map((q) => ({ _id: q._id, text: q.text, seen: q.seenAt !== undefined }));
    const messages = (
      await ctx.db
        .query("messages")
        .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
        .collect()
    ).map((m) => ({ _id: m._id, role: m.role, text: m.text }));
    const links = [
      ...(await ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("fromId", thoughtId))
        .collect()),
      ...(await ctx.db
        .query("connections")
        .withIndex("by_to", (q) => q.eq("toId", thoughtId))
        .collect()),
    ]
      .filter((c) => c.dismissedAt === undefined)
      .sort((a, b) => b.score - a.score);
    const connections = (
      await Promise.all(
        links.map(async (c) => {
          const otherId = c.fromId === thoughtId ? c.toId : c.fromId;
          const other = await ctx.db.get(otherId);
          return other && other.userId === thought.userId
            ? { _id: c._id, otherId, otherText: other.text }
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
      questions,
      messages,
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
    const rows = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", identity.subject).eq("status", "resting"),
      )
      .collect();
    return rows
      .sort((a, b) => (b.restedAt ?? 0) - (a.restedAt ?? 0))
      .map((t) => ({
        _id: t._id,
        text: t.text,
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
  handler: async (ctx, { thoughtId }) => {
    const thought = await ownedThought(ctx, thoughtId);
    if (!thought) return;
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
      .collect();
    const now = Date.now();
    for (const q of questions) {
      if (q.seenAt === undefined) await ctx.db.patch(q._id, { seenAt: now });
    }
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
