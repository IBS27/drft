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
    // Denormalized so the collection can render its waiting dot without
    // joining every thought to its question history.
    unseenQuestionCount: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status", "createdAt"])
    .index("by_user_and_unseenQuestionCount", [
      "userId",
      "unseenQuestionCount",
    ])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId", "status"],
    }),

  // Partner-drafted questions; an unseen one lights the vermilion dot and
  // can shape the question carried by a resurfacing.
  questions: defineTable({
    thoughtId: v.id("thoughts"),
    text: v.string(),
    seenAt: v.optional(v.number()),
  })
    .index("by_thought", ["thoughtId"])
    .index("by_thought_and_seenAt", ["thoughtId", "seenAt"]),

  // Auto-linked by resonance, user-dismissable, never user-curated.
  connections: defineTable({
    fromId: v.id("thoughts"),
    toId: v.id("thoughts"),
    score: v.number(),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_from", ["fromId"])
    .index("by_to", ["toId"])
    .index("by_from_and_dismissedAt", ["fromId", "dismissedAt"])
    .index("by_to_and_dismissedAt", ["toId", "dismissedAt"]),

  // Append-only conversation per thought; no session end-state, so no
  // sessions table — the thought is the session. Your messages carry your
  // userId and an embedding so they resonate with future captures like
  // fragments do; the partner's side is never embedded.
  messages: defineTable({
    thoughtId: v.id("thoughts"),
    userId: v.optional(v.string()),
    role: v.union(v.literal("you"), v.literal("partner")),
    text: v.string(),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_thought", ["thoughtId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // The selection log: one per user per day, never repeat too soon, never
  // resting thoughts; date is the user's local YYYY-MM-DD. Selection is
  // channel-agnostic — channel + deliveredAt are stamped by the delivery
  // adapter (email today); a row without deliveredAt was chosen but not
  // yet sent and delivery retries it that day. (Seed stamps deliveredAt
  // with no channel so the adapter never touches fabricated rows.)
  // userId is optional only for rows written before phase 5; the
  // scheduler always sets it.
  // See docs/experience.html §03.
  resurfacings: defineTable({
    thoughtId: v.id("thoughts"),
    date: v.string(),
    userId: v.optional(v.string()),
    channel: v.optional(v.literal("email")),
    deliveredAt: v.optional(v.number()),
    // The exact request accepted by the email adapter. Persisting it before
    // the external call makes every retry a true idempotent replay.
    emailPayload: v.optional(
      v.object({
        from: v.string(),
        to: v.string(),
        subject: v.string(),
        text: v.string(),
        html: v.string(),
      }),
    ),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_thought", ["thoughtId"]),

  // The product's one real preference: when the daily email arrives.
  // Server-owned (the server sends the email), so it lives here, not on a
  // device. sendTime is "HH:MM" 24h in the user's IANA timezone; email is
  // taken from the Clerk identity when available.
  settings: defineTable({
    userId: v.string(),
    email: v.string(),
    sendTime: v.string(),
    timezone: v.string(),
  }).index("by_user", ["userId"]),
});
