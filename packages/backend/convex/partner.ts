"use node";

import { v } from "convex/values";
import { embed, generateText, Output, streamText } from "ai";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  EMBEDDING_MODEL,
  QUESTION_MODEL,
  SESSION_MODEL,
  openaiProvider,
} from "./ai/models";
import {
  MAX_UNSEEN_QUESTIONS,
  SESSION_RESONANCE_THRESHOLD,
  SESSION_SETTLE_MS,
} from "./ai/limits";
import { sessionQuestionsPrompt, sessionSystemPrompt } from "./ai/prompts";

const questionsSchema = z.object({
  questions: z
    .array(z.string())
    .max(2)
    .describe("Zero, one, or two prepared questions. Empty if nothing good."),
});

function ageLine(createdAt: number): string {
  const days = Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

// The live side of the partner: one streamed turn per thing you say.
// The reply fills a message row as tokens arrive; the client's reactive
// query is the transport.
export const reply = internalAction({
  args: { thoughtId: v.id("thoughts"), userMessageId: v.id("messages") },
  handler: async (ctx, { thoughtId, userMessageId }) => {
    const said = await ctx.runQuery(internal.store.getMessage, {
      messageId: userMessageId,
    });
    if (!said || said.thoughtId !== thoughtId) return;
    const openai = openaiProvider();

    // Your side of the conversation is captured thinking too — embed it so
    // it can resonate with future captures, whatever happens below.
    const { embedding } = await embed({
      model: openai.textEmbedding(EMBEDDING_MODEL),
      value: said.text,
    });
    await ctx.runMutation(internal.store.patchMessageEmbedding, {
      messageId: userMessageId,
      embedding,
    });

    // Context is read after the slow embed so this check also sees
    // anything said meanwhile: if a newer message exists, its job answers
    // the whole exchange — one reply, not a backlog of them.
    const context = await ctx.runQuery(internal.store.thoughtContext, {
      thoughtId,
    });
    if (!context) return;
    const newer = context.messages.some(
      (m) => m.role === "you" && m.createdAt > said._creationTime,
    );
    if (newer) return;

    // What else in the collection resonates with what was just said —
    // beyond the links already on the thought. Excluded by id: the thought
    // itself and every linked partner, dismissed ones above all — a
    // dismissed link is never re-offered, not even in passing.
    const linked = new Set(
      await ctx.runQuery(internal.store.linkedPartnerIds, { thoughtId }),
    );
    const hits = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 6,
      filter: (q) => q.eq("userId", context.thought.userId),
    });
    const resonantIds = hits
      .filter(
        (h) =>
          h._id !== thoughtId &&
          !linked.has(h._id) &&
          h._score >= SESSION_RESONANCE_THRESHOLD,
      )
      .slice(0, 3)
      .map((h) => h._id);
    const resonantTexts = (
      await ctx.runQuery(internal.store.thoughtTexts, { ids: resonantIds })
    ).map((t) => t.text);

    const system = sessionSystemPrompt({
      thoughtText: context.thought.text,
      createdAgo: ageLine(context.thought.createdAt),
      connectedTexts: context.connectedTexts,
      resonantTexts,
      preparedQuestions: context.questions.map((q) => q.text),
    });
    const transcript = context.messages.map((m) => ({
      role: m.role === "you" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    }));

    const messageId = await ctx.runMutation(internal.store.insertPartnerMessage, {
      thoughtId,
    });
    let text = "";
    try {
      const stream = streamText({
        model: openai(SESSION_MODEL),
        system,
        messages: transcript,
      });
      let lastPatch = 0;
      for await (const chunk of stream.textStream) {
        text += chunk;
        const now = Date.now();
        if (now - lastPatch > 200) {
          lastPatch = now;
          await ctx.runMutation(internal.store.patchMessageText, {
            messageId,
            text,
          });
        }
      }
    } finally {
      if (text.trim()) {
        await ctx.runMutation(internal.store.patchMessageText, {
          messageId,
          text: text.trim(),
        });
      } else {
        await ctx.runMutation(internal.store.deleteMessageIfEmpty, { messageId });
      }
      // Even if the stream broke, the session still settles: once quiet
      // long enough, the partner prepares from what was said.
      await ctx.scheduler.runAfter(SESSION_SETTLE_MS, internal.partner.settle, {
        thoughtId,
      });
    }
  },
});

// A session has no end state — "settled" just means quiet long enough.
// Every reply schedules one of these; only the one belonging to the last
// message does any work, the rest wake up, notice newer activity, and leave.
export const settle = internalAction({
  args: { thoughtId: v.id("thoughts") },
  handler: async (ctx, { thoughtId }) => {
    const context = await ctx.runQuery(internal.store.thoughtContext, {
      thoughtId,
    });
    if (!context || context.thought.status === "resting") return;
    if (context.messages.length === 0) return;
    const last = Math.max(...context.messages.map((m) => m.createdAt));
    if (Date.now() - last < SESSION_SETTLE_MS - 60 * 1000) return;
    const unseen = context.questions.filter((q) => !q.seen).length;
    if (unseen >= MAX_UNSEEN_QUESTIONS) return;
    if (context.questions.some((q) => q.createdAt > last)) return;

    const openai = openaiProvider();
    const result = await generateText({
      model: openai(QUESTION_MODEL),
      output: Output.object({ schema: questionsSchema }),
      prompt: sessionQuestionsPrompt({
        thoughtText: context.thought.text,
        transcript: context.messages.map((m) => ({
          role: m.role,
          text: m.text,
        })),
        preparedQuestions: context.questions.map((q) => q.text),
      }),
    });
    const texts = result.output.questions.map((q) => q.trim()).filter(Boolean);
    if (texts.length > 0) {
      // Re-checked in-transaction: the cap, and that the room stayed quiet
      // while the questions were drafted.
      await ctx.runMutation(internal.store.insertQuestions, {
        thoughtId,
        texts,
        ifQuietSince: last,
      });
    }
  },
});
