// Run with `bunx convex run migrations:clearPartnerData` (add `--prod` for
// production before removing the legacy schema field).

import { defineSchema, defineTable } from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  GenericDatabaseWriter,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const MAX_BATCH_SIZE = 100;
const MAX_PAGE_BYTES_READ = 4_000_000;
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
