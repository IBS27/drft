import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Capture stays dumb: insert text + timestamp, return. Everything
// intelligent (embed, link, questions) is async enrichment — phase 3.
export const capture = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Empty thought");
    return await ctx.db.insert("thoughts", {
      userId: identity.subject,
      text: trimmed,
      createdAt: Date.now(),
      status: "open",
    });
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
