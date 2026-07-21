import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { MAX_UNSEEN_QUESTIONS } from "./ai/limits";

// Internal reads/writes for the AI layer (enrichment.ts, partner.ts).
// Actions can't touch the db directly, so everything they need is here.
// The actions' work spans slow API calls; any invariant that must hold
// (link uniqueness, question caps) is re-checked here, in-transaction.

export const getThought = internalQuery({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => ctx.db.get(thoughtId),
});

export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => ctx.db.get(messageId),
});

// Everything the partner needs to speak: the fragment, its prepared
// questions, the session so far, and the words of connected thoughts.
export const thoughtContext = internalQuery({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const thought = await ctx.db.get(thoughtId);
    if (!thought) return null;
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
      .collect();
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
      .collect();
    const links = [
      ...(await ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("fromId", thoughtId))
        .collect()),
      ...(await ctx.db
        .query("connections")
        .withIndex("by_to", (q) => q.eq("toId", thoughtId))
        .collect()),
    ].filter((c) => c.dismissedAt === undefined);
    const connectedTexts = (
      await Promise.all(
        links.map(async (c) => {
          const other = await ctx.db.get(
            c.fromId === thoughtId ? c.toId : c.fromId,
          );
          return other && other.userId === thought.userId ? other.text : null;
        }),
      )
    ).filter((t): t is string => t !== null);
    return {
      thought: {
        _id: thought._id,
        userId: thought.userId,
        text: thought.text,
        status: thought.status,
        createdAt: thought.createdAt,
      },
      questions: questions.map((q) => ({
        text: q.text,
        seen: q.seenAt !== undefined,
        createdAt: q._creationTime,
      })),
      messages: messages.map((m) => ({
        _id: m._id,
        role: m.role,
        text: m.text,
        createdAt: m._creationTime,
      })),
      connectedTexts,
    };
  },
});

// Thoughts a linker candidate must not duplicate: every partner this
// thought is already connected to, dismissed ones included — dismissed
// means "don't re-offer", not "forgot".
export const linkedPartnerIds = internalQuery({
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

export const thoughtTexts = internalQuery({
  args: { ids: v.array(v.id("thoughts")) },
  handler: async (ctx, { ids }) => {
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows.flatMap((t) => (t ? [{ _id: t._id, text: t.text }] : []));
  },
});

export const messageThoughtIds = internalQuery({
  args: { ids: v.array(v.id("messages")) },
  handler: async (ctx, { ids }) => {
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return rows.flatMap((m) => (m ? [{ _id: m._id, thoughtId: m.thoughtId }] : []));
  },
});

export const patchThoughtEmbedding = internalMutation({
  args: { thoughtId: v.id("thoughts"), embedding: v.array(v.float64()) },
  handler: async (ctx, { thoughtId, embedding }) => {
    if (await ctx.db.get(thoughtId)) await ctx.db.patch(thoughtId, { embedding });
  },
});

export const patchMessageEmbedding = internalMutation({
  args: { messageId: v.id("messages"), embedding: v.array(v.float64()) },
  handler: async (ctx, { messageId, embedding }) => {
    if (await ctx.db.get(messageId)) await ctx.db.patch(messageId, { embedding });
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

// Inserts at most what the unseen cap allows, checked in-transaction —
// generation is slow and two preparers can race. `ifQuietSince` lets the
// settle path bail if the user spoke again while questions were drafted.
export const insertQuestions = internalMutation({
  args: {
    thoughtId: v.id("thoughts"),
    texts: v.array(v.string()),
    ifQuietSince: v.optional(v.number()),
  },
  handler: async (ctx, { thoughtId, texts, ifQuietSince }) => {
    const thought = await ctx.db.get(thoughtId);
    if (!thought || thought.status !== "open") return;
    if (ifQuietSince !== undefined) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
        .collect();
      if (messages.some((m) => m._creationTime > ifQuietSince)) return;
    }
    const existing = await ctx.db
      .query("questions")
      .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
      .collect();
    const unseen = existing.filter((q) => q.seenAt === undefined).length;
    for (const text of texts.slice(0, Math.max(0, MAX_UNSEEN_QUESTIONS - unseen))) {
      await ctx.db.insert("questions", { thoughtId, text });
    }
  },
});

// The partner's reply starts as an empty row and fills as tokens arrive;
// the client's reactive query is the stream.
export const insertPartnerMessage = internalMutation({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) =>
    ctx.db.insert("messages", { thoughtId, role: "partner", text: "" }),
});

export const patchMessageText = internalMutation({
  args: { messageId: v.id("messages"), text: v.string() },
  handler: async (ctx, { messageId, text }) => {
    if (await ctx.db.get(messageId)) await ctx.db.patch(messageId, { text });
  },
});

// If the model never produced a word, the room stays quiet — an empty
// partner turn is worse than none.
export const deleteMessageIfEmpty = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (message && message.text.trim() === "") await ctx.db.delete(messageId);
  },
});

// One-time migration: messages written before phase 3 carry no userId.
export const backfillMessageUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const messages = await ctx.db.query("messages").collect();
    let patched = 0;
    for (const m of messages) {
      if (m.userId !== undefined || m.role !== "you") continue;
      const thought = await ctx.db.get(m.thoughtId);
      if (!thought) continue;
      await ctx.db.patch(m._id, { userId: thought.userId });
      patched += 1;
    }
    return { patched };
  },
});

// Backfill support: everything not yet embedded (thoughts from phases 1-2,
// plus any messages that slipped past their embed step).
export const unembedded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const thoughts = (await ctx.db.query("thoughts").collect())
      .filter((t) => t.embedding === undefined)
      .map((t) => ({ _id: t._id, text: t.text }));
    const messages = (await ctx.db.query("messages").collect())
      .filter((m) => m.embedding === undefined && m.role === "you")
      .map((m) => ({ _id: m._id, text: m.text }));
    return { thoughts, messages };
  },
});
