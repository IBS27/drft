import { v } from "convex/values";
import { query } from "./_generated/server";

// Find a thought by its words, at the speed of typing: a reactive query
// over the by_text search index — relevance-ranked, prefix-matched on
// the last term — answers every keystroke, no Enter, no debounce.
// Resting thoughts are included on purpose — set down, still findable.
export const thoughts = query({
  args: { query: v.string() },
  handler: async (ctx, { query: raw }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    // Convex search errors above 16 terms; a long paste searches by its
    // first sixteen words instead of erroring the subscription.
    const trimmed = raw.trim().split(/\s+/).slice(0, 16).join(" ");
    if (!trimmed) return [];
    const rows = await ctx.db
      .query("thoughts")
      .withSearchIndex("by_text", (q) =>
        q.search("text", trimmed).eq("userId", identity.subject),
      )
      .take(12);
    return rows.map((t) => ({
      _id: t._id,
      text: t.text,
      status: t.status,
      createdAt: t.createdAt,
    }));
  },
});
