import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Shapes pinned down in docs/experience.html §07. No title, no tags, no
// category on thoughts — their absence is the product.
export default defineSchema({
  thoughts: defineTable({
    userId: v.string(),
    text: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("open"), v.literal("resting")),
    restingNote: v.optional(v.string()),
    restedAt: v.optional(v.number()),
    // Legacy partner field; remove (with migrations.ts) once clearPartnerData has run in prod.
    unseenQuestionCount: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status", "createdAt"])
    // The resting list reads newest-set-down first, which is a different
    // order from newest-captured — it needs its own index to be able to
    // stop reading early.
    .index("by_user_status_restedAt", ["userId", "status", "restedAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId", "status"],
    })
    // Find answers every keystroke from this index: relevance-ranked,
    // prefix-matched on the last term, filtered to one user inside the
    // index itself.
    .searchIndex("by_text", {
      searchField: "text",
      filterFields: ["userId"],
    }),

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
