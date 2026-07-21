import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Dev-only. Phase 3 made enrichment real, so seeding now plants the design
// doc's sample fragments (aged across today / this week / earlier) and lets
// real enrichment embed, link, and question them. Only the resurfacing is
// still fabricated — the scheduler that writes it is phase 5.
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

// Questions the pre-phase-3 seed fabricated (sometimes onto real thoughts,
// since it targeted the newest open one) — clear hunts these down by text.
const LEGACY_FAKE_QUESTIONS = new Set([
  "What would have to be true for the opposite to hold?",
  "Is this about the thing itself, or about your attention to it?",
  "You kept this and moved on — what were you in the middle of?",
]);
// Same for its connections: real scores are cosine similarities and won't
// land exactly on these hand-picked values.
const LEGACY_FAKE_SCORES = new Set([0.82, 0.74]);

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
      const thoughtId = await ctx.db.insert("thoughts", {
        userId,
        text,
        createdAt: Date.now() - daysAgo * DAY - 3_600_000,
        status: "open",
      });
      // Real enrichment, same as a capture (needs OPENAI_API_KEY set).
      await ctx.scheduler.runAfter(0, internal.enrichment.enrich, { thoughtId });
      planted.push(text);
    }

    const open = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "open"),
      )
      .order("desc")
      .collect();
    if (open.length === 0) return `planted ${planted.length}; no open thoughts`;
    const existing = await ctx.db
      .query("resurfacings")
      .withIndex("by_date", (q) => q.eq("date", date))
      .first();
    if (existing) return `planted ${planted.length}; ${date} already has a resurfacing`;
    const resurfaced = open[open.length - 1];
    await ctx.db.insert("resurfacings", { thoughtId: resurfaced._id, date });
    return `planted ${planted.length} sample thoughts (enrichment scheduled); resurfaced "${resurfaced.text.slice(0, 40)}" for ${date}`;
  },
});

// Removes everything seeding created: the sample thoughts and all rows
// hanging off them (messages, questions, connections, resurfacings), plus
// any legacy fabricated questions/connections the old seed left on real
// thoughts. Real captures and their real enrichment are untouched.
export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!seedAllowed()) return GUARD;
    const sampleTexts = new Set(SAMPLES.map(([text]) => text));
    const thoughts = await ctx.db.query("thoughts").collect();
    const sampleIds = new Set(
      thoughts.filter((t) => sampleTexts.has(t.text)).map((t) => t._id),
    );

    for (const q of await ctx.db.query("questions").collect()) {
      if (sampleIds.has(q.thoughtId) || LEGACY_FAKE_QUESTIONS.has(q.text))
        await ctx.db.delete(q._id);
    }
    for (const c of await ctx.db.query("connections").collect()) {
      if (
        sampleIds.has(c.fromId) ||
        sampleIds.has(c.toId) ||
        LEGACY_FAKE_SCORES.has(c.score)
      )
        await ctx.db.delete(c._id);
    }
    for (const r of await ctx.db.query("resurfacings").collect()) {
      await ctx.db.delete(r._id);
    }
    let removed = 0;
    for (const id of sampleIds) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_thought", (q) => q.eq("thoughtId", id))
        .collect();
      for (const m of messages) await ctx.db.delete(m._id);
      await ctx.db.delete(id);
      removed++;
    }
    return `cleared seed data; removed ${removed} sample thoughts`;
  },
});
