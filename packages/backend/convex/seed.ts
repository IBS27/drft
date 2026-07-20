import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Dev-only: fabricate what phase 3's enrichment and phase 5's scheduler
// will write — questions, connections, one resurfacing — so the workspace
// design can be judged against real UI before the AI exists. If the
// collection is thin, plants the design doc's sample fragments first,
// aged across today / this week / earlier.
// Run:   bunx convex run seed:run '{"date":"2026-07-20"}'
// Undo:  bunx convex run seed:clear
const DAY = 86_400_000;

// The Convex runtime provides process.env; declared here so this file
// also typechecks inside the web app's program (no node types there).
declare const process: { env: Record<string, string | undefined> };

// Hard stop against running this anywhere real. Only deployments that
// explicitly set SEED_ALLOWED=1 (dev) may seed or clear — an accidental
// `--prod` run is a no-op instead of data loss.
const GUARD =
  "seed is disabled on this deployment — set SEED_ALLOWED=1 (dev only) to enable";
const seedAllowed = () => process.env.SEED_ALLOWED === "1";

// [text, days ago] — fragments from docs/design.html mockups.
const SAMPLES: [string, number][] = [
  ["what if onboarding is just the product, slowed down", 0],
  ["recipes as version control — forks & merges", 2],
  ["attention is a garden, not a mine", 4],
  ["the best interviews are mostly edited silence", 12],
  ["everyone's second language is autocomplete", 18],
  ["a commute you choose is a walk", 30],
];

export const run = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    if (!seedAllowed()) return GUARD;
    const latest = await ctx.db.query("thoughts").order("desc").first();
    if (!latest) return "nothing to seed against — capture a thought first";
    const userId = latest.userId;

    const planted: string[] = [];
    const existingTexts = new Set(
      (
        await ctx.db
          .query("thoughts")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      ).map((t) => t.text),
    );
    for (const [text, daysAgo] of SAMPLES) {
      if (existingTexts.has(text)) continue;
      await ctx.db.insert("thoughts", {
        userId,
        text,
        createdAt: Date.now() - daysAgo * DAY - 3_600_000,
        status: "open",
      });
      planted.push(text);
    }

    const open = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "open"),
      )
      .order("desc")
      .collect();
    if (open.length < 2) return "need at least two open thoughts";
    const seeded = await ctx.db
      .query("questions")
      .withIndex("by_thought", (q) => q.eq("thoughtId", open[0]._id))
      .first();
    if (seeded) return "already seeded";

    await ctx.db.insert("questions", {
      thoughtId: open[0]._id,
      text: "What would have to be true for the opposite to hold?",
    });
    await ctx.db.insert("questions", {
      thoughtId: open[0]._id,
      text: "Is this about the thing itself, or about your attention to it?",
    });
    await ctx.db.insert("connections", {
      fromId: open[0]._id,
      toId: open[1]._id,
      score: 0.82,
    });
    if (open.length > 2) {
      await ctx.db.insert("questions", {
        thoughtId: open[2]._id,
        text: "You kept this and moved on — what were you in the middle of?",
      });
      await ctx.db.insert("connections", {
        fromId: open[0]._id,
        toId: open[2]._id,
        score: 0.74,
      });
    }
    const resurfaced = open[open.length - 1];
    await ctx.db.insert("resurfacings", { thoughtId: resurfaced._id, date });
    return `planted ${planted.length} sample thoughts; seeded questions + connections; resurfaced "${resurfaced.text.slice(0, 40)}" for ${date}`;
  },
});

// Removes everything seeding created. Until phase 3 ships, every row in
// questions / connections / resurfacings is seeded, so they all go; the
// sample thoughts (and any messages on them) go too. Real captures and
// the thinking on them are untouched.
export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!seedAllowed()) return GUARD;
    for (const q of await ctx.db.query("questions").collect())
      await ctx.db.delete(q._id);
    for (const c of await ctx.db.query("connections").collect())
      await ctx.db.delete(c._id);
    for (const r of await ctx.db.query("resurfacings").collect())
      await ctx.db.delete(r._id);
    const sampleTexts = new Set(SAMPLES.map(([text]) => text));
    const thoughts = await ctx.db.query("thoughts").collect();
    let removed = 0;
    for (const t of thoughts) {
      if (!sampleTexts.has(t.text)) continue;
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thought", (q) => q.eq("thoughtId", t._id))
        .collect();
      for (const m of messages) await ctx.db.delete(m._id);
      await ctx.db.delete(t._id);
      removed++;
    }
    return `cleared seed data; removed ${removed} sample thoughts`;
  },
});
