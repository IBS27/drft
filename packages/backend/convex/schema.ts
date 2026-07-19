import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Shapes pinned down in docs/experience.html §08. No title, no tags, no
// category on thoughts — their absence is the product.
export default defineSchema({
  thoughts: defineTable({
    userId: v.string(),
    text: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("open"), v.literal("resting")),
    restingNote: v.optional(v.string()),
    restedAt: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status", "createdAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId", "status"],
    }),

  // Partner-drafted questions; an unseen one lights the vermilion dot and
  // feeds resurfacing readiness.
  questions: defineTable({
    thoughtId: v.id("thoughts"),
    text: v.string(),
    seenAt: v.optional(v.number()),
  }).index("by_thought", ["thoughtId"]),

  // Auto-linked by resonance, user-dismissable, never user-curated.
  connections: defineTable({
    fromId: v.id("thoughts"),
    toId: v.id("thoughts"),
    score: v.number(),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_from", ["fromId"])
    .index("by_to", ["toId"]),

  // Append-only conversation per thought; no session end-state, so no
  // sessions table — the thought is the session. User messages get embedded
  // and resonate like fragments do.
  messages: defineTable({
    thoughtId: v.id("thoughts"),
    role: v.union(v.literal("you"), v.literal("partner")),
    text: v.string(),
    embedding: v.optional(v.array(v.float64())),
  }).index("by_thought", ["thoughtId"]),

  // One per day, never repeat too soon, never resting thoughts. The
  // scheduler that writes it is phase 5; date is YYYY-MM-DD.
  resurfacings: defineTable({
    thoughtId: v.id("thoughts"),
    date: v.string(),
  })
    .index("by_date", ["date"])
    .index("by_thought", ["thoughtId"]),
});
