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
    // Set while you hold the thought close (the web's Held page): when you
    // took hold of it. One switch you flip yourself, not a tag; resting a
    // thought lets go of it.
    heldAt: v.optional(v.number()),
    // Legacy partner field; remove (with migrations.ts) once clearPartnerData has run in prod.
    unseenQuestionCount: v.optional(v.number()),
    // The capturing device's own id for this capture. A queued offline
    // capture can be sent more than once (the reply was lost, the app was
    // killed mid-send); the id lets the second send find the first.
    clientId: v.optional(v.string()),
    // When the thought last came back (the creation time of its newest
    // `resurfacings` row), kept here so the daily selection can read the
    // one thought that has waited longest straight from an index instead
    // of scanning the collection. Absent = never returned.
    lastReturnedAt: v.optional(v.number()),
    // Legacy home of the embedding; new ones are written to
    // `thoughtEmbeddings` only. Remove this field and the `by_embedding`
    // index below in the follow-up once migrations:backfillFastPaths has
    // run in prod (see migrationState.ts).
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status", "createdAt"])
    .index("by_user_clientId", ["userId", "clientId"])
    // The return loop's order: never-returned thoughts first (an absent
    // field sorts below every timestamp), then oldest return first, oldest
    // capture breaking ties — so the next thought to come back is the
    // first row of a range.
    .index("by_user_status_lastReturnedAt", [
      "userId",
      "status",
      "lastReturnedAt",
      "createdAt",
    ])
    // The resting list reads newest-set-down first, which is a different
    // order from newest-captured — it needs its own index to be able to
    // stop reading early.
    .index("by_user_status_restedAt", ["userId", "status", "restedAt"])
    // The Held page reads newest-held first; thoughts never held sort
    // below every timestamp, so a range over heldAt skips them in-index.
    .index("by_user_heldAt", ["userId", "heldAt"])
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

  // A thought's embedding, apart from the thought. It is forty times the
  // size of everything else a thought carries and only the linker reads
  // it; kept on the thought, every list, search and hold paid for it.
  // One row per embedded thought. userId is the thought's owner, copied so
  // the vector search can stay inside one person's thinking.
  thoughtEmbeddings: defineTable({
    thoughtId: v.id("thoughts"),
    userId: v.string(),
    embedding: v.array(v.float64()),
  })
    .index("by_thought", ["thoughtId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

  // Auto-linked by resonance, user-dismissable, never user-curated.
  connections: defineTable({
    fromId: v.id("thoughts"),
    toId: v.id("thoughts"),
    score: v.number(),
    dismissedAt: v.optional(v.number()),
    // The one owner of both ends, so the connections field can trust an
    // edge without reading the thought at its far end. Optional only for
    // edges written before it existed; the linker always sets it.
    userId: v.optional(v.string()),
  })
    .index("by_from_and_dismissedAt", ["fromId", "dismissedAt"])
    .index("by_to_and_dismissedAt", ["toId", "dismissedAt"])
    // "Are these two already linked?" as a point lookup, however many
    // links either thought has.
    .index("by_from_and_to", ["fromId", "toId"]),

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

  // Your own writing next to a thought — one free-text field per thought,
  // edited in place. Its own table so the constant autosave never rewrites
  // the thought document (which carries the embedding) and never wakes the
  // collection/rail subscriptions. Ownership is the thought's.
  notes: defineTable({
    thoughtId: v.id("thoughts"),
    text: v.string(),
    updatedAt: v.number(),
  }).index("by_thought", ["thoughtId"]),

  // Explicit permission to send thought text to OpenAI for embeddings
  // (connections). No row = not asked yet, which sends nothing — see
  // consent.ts.
  consents: defineTable({
    userId: v.string(),
    aiConnections: v.boolean(),
    decidedAt: v.number(),
  }).index("by_user", ["userId"]),

  // The product's one real preference: when the daily email arrives.
  // Server-owned (the server sends the email), so it lives here, not on a
  // device. sendTime is "HH:MM" 24h in the user's IANA timezone; email is
  // taken from the Clerk identity when available.
  // nextDueAt is the return loop's own bookkeeping (resurfacing.ts): the
  // next moment the daily thought could have anything to do for this user.
  // Absent sorts below every timestamp, so a row without it is simply due.
  settings: defineTable({
    userId: v.string(),
    email: v.string(),
    sendTime: v.string(),
    timezone: v.string(),
    nextDueAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_nextDueAt", ["nextDueAt"]),

  // Which one-time backfills have finished on this deployment
  // (migrationState.ts). Temporary: it goes with the legacy read paths.
  migrationState: defineTable({
    name: v.union(
      v.literal("embeddingsMoved"),
      v.literal("connectionOwners"),
      v.literal("lastReturnedAt"),
    ),
    doneAt: v.number(),
  }).index("by_name", ["name"]),

  // An account its owner asked to delete (account.ts). While the row exists
  // nothing new is written for that user; it is removed once the data is
  // purged and the Clerk user is gone, so nothing of the account remains.
  accountDeletions: defineTable({
    userId: v.string(),
    requestedAt: v.number(),
    clerkDeletedAt: v.optional(v.number()),
    purgedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),
});
