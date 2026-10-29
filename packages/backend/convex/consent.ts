import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// Connections need each thought's text sent to OpenAI for an embedding.
// That only happens with the user's explicit permission (App Store
// guideline 5.1.2(i)): no row means "not asked yet" and, like a refusal,
// sends nothing. Captures made before a decision simply wait — allowing
// later catches them up.

const CATCH_UP_PAGE_SIZE = 100;

export async function allowsAiConnections(
  ctx: QueryCtx,
  userId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("consents")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return row?.aiConnections === true;
}

// null = never asked; clients show the permission prompt once.
export const get = query({
  args: {},
  returns: v.union(v.null(), v.object({ aiConnections: v.boolean() })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("consents")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique();
    return row ? { aiConnections: row.aiConnections } : null;
  },
});

export const setAiConnections = mutation({
  args: { allowed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { allowed }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const userId = identity.subject;
    const existing = await ctx.db
      .query("consents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const decision = { aiConnections: allowed, decidedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, decision);
    else await ctx.db.insert("consents", { userId, ...decision });

    if (allowed && existing?.aiConnections !== true) {
      await ctx.scheduler.runAfter(0, internal.consent.catchUp, {
        userId,
        cursor: null,
      });
    }
    return null;
  },
});

export const allowed = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: (ctx, { userId }) => allowsAiConnections(ctx, userId),
});

// Enriches what was captured while permission was missing, a page at a
// time. Re-checks permission on every page so turning it off mid-way stops
// the walk.
export const catchUp = internalMutation({
  args: { userId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { userId, cursor }) => {
    if (!(await allowsAiConnections(ctx, userId))) return null;
    const result = await ctx.db
      .query("thoughts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({ cursor, numItems: CATCH_UP_PAGE_SIZE });
    for (const thought of result.page) {
      if (thought.embedding !== undefined) continue;
      await ctx.scheduler.runAfter(0, internal.enrichment.enrich, {
        thoughtId: thought._id,
      });
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.consent.catchUp, {
        userId,
        cursor: result.continueCursor,
      });
    }
    return null;
  },
});
