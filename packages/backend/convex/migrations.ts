// One-time data moves, each run by hand with `bunx convex run` (add
// `--prod` for production):
//
//   migrations:backfillFastPaths — after deploying the release that moved
//     embeddings off thoughts; `migrations:fastPathStatus` shows when it
//     has finished. See the note above it.
//   migrations:clearPartnerData — before removing the legacy partner
//     field from the schema.

import { defineSchema, defineTable } from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  GenericDatabaseWriter,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { saveEmbedding } from "./embeddings";
import { markMigrated, migrated } from "./migrationState";

const MAX_BATCH_SIZE = 100;
const MAX_PAGE_BYTES_READ = 4_000_000;
// A thought still carrying its embedding is ~14 KB, read here and written
// again to its new home: fifty a transaction is about a megabyte each way,
// a small part of what one may read. Should a run of unusually long
// thoughts ever exceed that, the batch fails as a whole and nothing is
// lost: run it again with a smaller `batchSize`.
const FAST_PATH_THOUGHT_BATCH_SIZE = 50;
const FAST_PATH_CONNECTION_BATCH_SIZE = 200;
const LEGACY_DELETE_BATCH_SIZE = 1;
const MAX_LEGACY_PAGE_BYTES_READ = 2_000_000;

// These tables are deliberately absent from schema.ts. This local definition
// only gives the cleanup mutation precise types for legacy rows that still
// exist in a deployment; it does not register or validate either table.
const legacyPartnerSchema = defineSchema({
  questions: defineTable({
    thoughtId: v.id("thoughts"),
    text: v.string(),
    seenAt: v.optional(v.number()),
  }),
  messages: defineTable({
    thoughtId: v.id("thoughts"),
    userId: v.optional(v.string()),
    role: v.union(v.literal("you"), v.literal("partner")),
    text: v.string(),
    embedding: v.optional(v.array(v.float64())),
  }),
});

type LegacyPartnerDataModel = DataModelFromSchemaDefinition<
  typeof legacyPartnerSchema
>;
type ClearPartnerDataArgs = {
  phase?: "thoughts" | "questions" | "messages";
  thoughtCursor?: string;
  thoughtBatchSize?: number;
  thoughtsDone?: boolean;
};
type ClearPartnerDataResult = {
  thoughtsCleared: number;
  questionsDeleted: number;
  messagesDeleted: number;
  scheduledNextBatch: boolean;
};

export const clearPartnerData = internalMutation({
  args: {
    phase: v.optional(
      v.union(
        v.literal("thoughts"),
        v.literal("questions"),
        v.literal("messages"),
      ),
    ),
    thoughtCursor: v.optional(v.string()),
    thoughtBatchSize: v.optional(v.number()),
    // Compatibility for jobs scheduled before cleanup was split into phases.
    thoughtsDone: v.optional(v.boolean()),
  },
  returns: v.object({
    thoughtsCleared: v.number(),
    questionsDeleted: v.number(),
    messagesDeleted: v.number(),
    scheduledNextBatch: v.boolean(),
  }),
  handler: async (
    ctx,
    { phase, thoughtCursor, thoughtBatchSize, thoughtsDone },
  ): Promise<ClearPartnerDataResult> => {
    phase ??= thoughtsDone ? "questions" : "thoughts";

    if (phase === "questions") {
      const legacyDb =
        ctx.db as unknown as GenericDatabaseWriter<LegacyPartnerDataModel>;
      const questionPage = await legacyDb.query("questions").paginate({
        cursor: null,
        numItems: LEGACY_DELETE_BATCH_SIZE,
        maximumRowsRead: LEGACY_DELETE_BATCH_SIZE,
        maximumBytesRead: MAX_LEGACY_PAGE_BYTES_READ,
      });
      if (questionPage.pageStatus === "SplitRequired") {
        throw new Error(
          "A single legacy partner row exceeds the migration read limit",
        );
      }
      for (const question of questionPage.page) {
        await legacyDb.delete(question._id);
      }
      await ctx.scheduler.runAfter(0, internal.migrations.clearPartnerData, {
        phase: questionPage.isDone ? "messages" : "questions",
      });
      return {
        thoughtsCleared: 0,
        questionsDeleted: questionPage.page.length,
        messagesDeleted: 0,
        scheduledNextBatch: true,
      };
    }

    if (phase === "messages") {
      const legacyDb =
        ctx.db as unknown as GenericDatabaseWriter<LegacyPartnerDataModel>;
      const messagePage = await legacyDb.query("messages").paginate({
        cursor: null,
        numItems: LEGACY_DELETE_BATCH_SIZE,
        maximumRowsRead: LEGACY_DELETE_BATCH_SIZE,
        maximumBytesRead: MAX_LEGACY_PAGE_BYTES_READ,
      });
      if (messagePage.pageStatus === "SplitRequired") {
        throw new Error(
          "A single legacy partner row exceeds the migration read limit",
        );
      }
      for (const message of messagePage.page) {
        await legacyDb.delete(message._id);
      }
      if (!messagePage.isDone) {
        await ctx.scheduler.runAfter(0, internal.migrations.clearPartnerData, {
          phase: "messages",
        });
      }
      return {
        thoughtsCleared: 0,
        questionsDeleted: 0,
        messagesDeleted: messagePage.page.length,
        scheduledNextBatch: !messagePage.isDone,
      };
    }

    const pageSize = Math.max(
      1,
      Math.min(MAX_BATCH_SIZE, Math.floor(thoughtBatchSize ?? MAX_BATCH_SIZE)),
    );
    const thoughtPage = await ctx.db
      .query("thoughts")
      .filter((q) => q.neq(q.field("unseenQuestionCount"), undefined))
      .paginate({
        cursor: thoughtCursor ?? null,
        numItems: pageSize,
        maximumRowsRead: pageSize,
        maximumBytesRead: MAX_PAGE_BYTES_READ,
      });

    // A SplitRequired page may be incomplete. Do not mutate anything from it
    // or advance its cursor; retry the same range with fewer rows instead.
    if (thoughtPage.pageStatus === "SplitRequired") {
      if (pageSize === 1) {
        throw new Error("A single thought exceeds the migration read limit");
      }
      const retryArgs: ClearPartnerDataArgs = {
        thoughtBatchSize: Math.max(1, Math.floor(pageSize / 2)),
      };
      if (thoughtCursor !== undefined) {
        retryArgs.thoughtCursor = thoughtCursor;
      }
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.clearPartnerData,
        retryArgs,
      );
      return {
        thoughtsCleared: 0,
        questionsDeleted: 0,
        messagesDeleted: 0,
        scheduledNextBatch: true,
      };
    }

    const thoughts = thoughtPage.page;
    for (const thought of thoughts) {
      await ctx.db.patch(thought._id, { unseenQuestionCount: undefined });
    }

    const nextArgs: ClearPartnerDataArgs = thoughtPage.isDone
      ? { phase: "questions" }
      : {
          phase: "thoughts",
          thoughtCursor: thoughtPage.continueCursor,
          thoughtBatchSize: pageSize,
        };
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.clearPartnerData,
      nextArgs,
    );

    return {
      thoughtsCleared: thoughts.length,
      questionsDeleted: 0,
      messagesDeleted: 0,
      scheduledNextBatch: true,
    };
  },
});

// Carries rows written before this release over to the shapes its fast
// paths read, then marks each one finished (migrationState.ts) so the
// readers stop taking the old path:
//
//   thoughts — the inline embedding moves to `thoughtEmbeddings` (in the
//     same transaction it leaves the thought, so it is always in exactly
//     one place), and `lastReturnedAt` is set from the thought's returns.
//   connections — each edge gets its owner.
//
// Safe while the app is live: every writer already uses the new shapes,
// so a row this has passed never goes back. Safe to interrupt and to run
// again: it restarts from the first row and skips whatever is already
// carried over. A deployment with nothing to move finishes at once.
export const backfillFastPaths = internalMutation({
  args: {
    phase: v.optional(v.union(v.literal("thoughts"), v.literal("connections"))),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    phase: v.union(v.literal("thoughts"), v.literal("connections")),
    changed: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, { phase = "thoughts", cursor, batchSize }) => {
    const largest =
      phase === "thoughts"
        ? FAST_PATH_THOUGHT_BATCH_SIZE
        : FAST_PATH_CONNECTION_BATCH_SIZE;
    const numItems = Math.max(1, Math.min(largest, Math.floor(batchSize ?? largest)));
    const paging = { cursor: cursor ?? null, numItems };
    const page =
      phase === "thoughts"
        ? { phase, ...(await ctx.db.query("thoughts").paginate(paging)) }
        : { phase, ...(await ctx.db.query("connections").paginate(paging)) };

    let changed = 0;
    if (page.phase === "thoughts") {
      for (const thought of page.page) {
        const returns = await ctx.db
          .query("resurfacings")
          .withIndex("by_thought", (q) => q.eq("thoughtId", thought._id))
          .collect();
        const lastReturnedAt =
          returns.length > 0
            ? Math.max(...returns.map((r) => r._creationTime))
            : undefined;
        if (thought.embedding !== undefined)
          await saveEmbedding(ctx, thought, thought.embedding);
        if (lastReturnedAt !== thought.lastReturnedAt)
          await ctx.db.patch(thought._id, { lastReturnedAt });
        if (
          thought.embedding !== undefined ||
          lastReturnedAt !== thought.lastReturnedAt
        )
          changed += 1;
      }
    } else {
      for (const connection of page.page) {
        if (connection.userId !== undefined) continue;
        const from = await ctx.db.get(connection.fromId);
        const to = await ctx.db.get(connection.toId);
        // An edge with a missing end, or ends with different owners, was
        // never shown to anyone (every reader checked both). It stays as
        // it is, without an owner, and stays unshown.
        if (!from || !to || from.userId !== to.userId) continue;
        await ctx.db.patch(connection._id, { userId: from.userId });
        changed += 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillFastPaths, {
        phase,
        cursor: page.continueCursor,
        batchSize: numItems,
      });
      return { phase, changed, done: false };
    }
    if (phase === "thoughts") {
      await markMigrated(ctx, "embeddingsMoved");
      await markMigrated(ctx, "lastReturnedAt");
      await ctx.scheduler.runAfter(0, internal.migrations.backfillFastPaths, {
        phase: "connections",
      });
      return { phase, changed, done: false };
    }
    await markMigrated(ctx, "connectionOwners");
    return { phase, changed, done: true };
  },
});

// All three true = the backfill above has finished on this deployment.
export const fastPathStatus = internalQuery({
  args: {},
  returns: v.object({
    embeddingsMoved: v.boolean(),
    lastReturnedAt: v.boolean(),
    connectionOwners: v.boolean(),
  }),
  handler: async (ctx) => ({
    embeddingsMoved: await migrated(ctx, "embeddingsMoved"),
    lastReturnedAt: await migrated(ctx, "lastReturnedAt"),
    connectionOwners: await migrated(ctx, "connectionOwners"),
  }),
});
