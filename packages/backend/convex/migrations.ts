// Run with `bunx convex run migrations:clearPartnerData` (add `--prod` for
// production before removing the legacy schema field).

import {
  defineSchema,
  defineTable,
  makeFunctionReference,
} from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  FunctionReference,
  GenericDatabaseWriter,
} from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const BATCH_SIZE = 100;

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
type EmptyArgs = Record<string, never>;
type ClearPartnerDataResult = {
  thoughtsCleared: number;
  questionsDeleted: number;
  messagesDeleted: number;
  scheduledNextBatch: boolean;
};

const clearPartnerDataRef = makeFunctionReference<
  "mutation",
  EmptyArgs,
  ClearPartnerDataResult
>("migrations:clearPartnerData") as unknown as FunctionReference<
  "mutation",
  "internal",
  EmptyArgs,
  ClearPartnerDataResult
>;

export const clearPartnerData = internalMutation({
  args: {},
  returns: v.object({
    thoughtsCleared: v.number(),
    questionsDeleted: v.number(),
    messagesDeleted: v.number(),
    scheduledNextBatch: v.boolean(),
  }),
  handler: async (ctx): Promise<ClearPartnerDataResult> => {
    const thoughts = await ctx.db
      .query("thoughts")
      .filter((q) =>
        q.neq(q.field("unseenQuestionCount"), undefined),
      )
      .take(BATCH_SIZE);
    for (const thought of thoughts) {
      await ctx.db.patch(thought._id, { unseenQuestionCount: undefined });
    }

    const legacyDb =
      ctx.db as unknown as GenericDatabaseWriter<LegacyPartnerDataModel>;
    const [questions, messages] = await Promise.all([
      legacyDb.query("questions").take(BATCH_SIZE),
      legacyDb.query("messages").take(BATCH_SIZE),
    ]);
    for (const question of questions) await legacyDb.delete(question._id);
    for (const message of messages) await legacyDb.delete(message._id);

    const scheduledNextBatch =
      thoughts.length === BATCH_SIZE ||
      questions.length === BATCH_SIZE ||
      messages.length === BATCH_SIZE;
    if (scheduledNextBatch) {
      await ctx.scheduler.runAfter(0, clearPartnerDataRef, {});
    }

    return {
      thoughtsCleared: thoughts.length,
      questionsDeleted: questions.length,
      messagesDeleted: messages.length,
      scheduledNextBatch,
    };
  },
});
