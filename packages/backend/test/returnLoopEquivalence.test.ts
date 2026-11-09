// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import schema from "../convex/schema";
import { localParts, selectThoughtId, sendMinutes } from "../convex/selection";
import { DAY, HOUR, MINUTE, modules } from "./helpers";
import type { Setup } from "./helpers";

// The return loop used to ask every user, every quarter hour, whether
// today's thought was due. It now asks only the users whose `nextDueAt`
// has come. This file holds the two to the same behaviour: the old tick,
// kept here word for word as the reference, runs beside the new one
// through days of random activity, and after every tick both must have
// returned the same thoughts on the same dates and handed the same number
// of rows to delivery.

const TICK = 15 * MINUTE;
const MIN_GAP_MS = 20 * HOUR;

// resurfacing.tick as it was before nextDueAt (one transaction, every user).
async function referenceTick(ctx: MutationCtx) {
  const now = Date.now();
  const allSettings = await ctx.db.query("settings").collect();
  for (const settings of allSettings) {
    const { date, minutesOfDay } = localParts(settings.timezone, now);
    if (minutesOfDay < sendMinutes(settings.sendTime)) continue;

    const today = await ctx.db
      .query("resurfacings")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", settings.userId).eq("date", date),
      )
      .first();
    if (today) {
      if (today.deliveredAt === undefined)
        await ctx.scheduler.runAfter(0, internal.email.deliver, {
          resurfacingId: today._id,
        });
      continue;
    }

    const latest = await ctx.db
      .query("resurfacings")
      .withIndex("by_user_date", (q) => q.eq("userId", settings.userId))
      .order("desc")
      .first();
    if (latest && now - latest._creationTime < MIN_GAP_MS) continue;

    const open = await ctx.db
      .query("thoughts")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", settings.userId).eq("status", "open"),
      )
      .collect();
    const lastReturned = new Map<string, number>();
    for (const t of open) {
      const rows = await ctx.db
        .query("resurfacings")
        .withIndex("by_thought", (q) => q.eq("thoughtId", t._id))
        .collect();
      for (const r of rows) {
        lastReturned.set(
          t._id,
          Math.max(lastReturned.get(t._id) ?? 0, r._creationTime),
        );
      }
    }
    const thoughtId = selectThoughtId(open, lastReturned, now);
    if (!thoughtId) continue;
    const resurfacingId = await ctx.db.insert("resurfacings", {
      thoughtId,
      date,
      userId: settings.userId,
    });
    await ctx.scheduler.runAfter(0, internal.email.deliver, { resurfacingId });
  }
}

// Deterministic randomness, so a failure names a seed that reproduces it.
function random(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    below: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  };
}

// Three collections, so every reason for a silent day comes up: one with
// plenty waiting; one that is nearly all new, where thoughts come of age
// mid-run; one where everything returned about a month ago, where
// cooldowns run out mid-run.
const USERS = ["user_plenty", "user_new", "user_returned"];
const ZONES = ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"];
const SEND_TIMES = ["00:00", "02:30", "08:00", "13:15", "23:45"];

type World = {
  t: Setup;
  tick: () => Promise<void>;
  deliveries: number;
};

// Runs one thing in one world, through to the end of whatever it
// scheduled, and counts the rows it handed to delivery. Without a Resend
// key the adapter is dormant and says so once per hand-off; that line is
// the count.
async function step(world: World, act: (t: Setup) => Promise<unknown>) {
  const said = vi.mocked(console.log).mock.calls;
  const before = said.length;
  await act(world.t);
  await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  world.deliveries += said
    .slice(before)
    .filter(([line]) => String(line).includes("delivery dormant")).length;
}

// What the user could observe of the loop: which thought came back on
// which local date, whether it was delivered, and how many times delivery
// has been asked for.
async function observe({ t, deliveries }: World) {
  const rows = await t.run(async (ctx) => {
    const resurfacings = await ctx.db.query("resurfacings").collect();
    return await Promise.all(
      resurfacings.map(async (r) => ({
        userId: r.userId,
        date: r.date,
        thought: (await ctx.db.get(r.thoughtId))?.text,
        delivered: r.deliveredAt !== undefined,
      })),
    );
  });
  const key = (r: (typeof rows)[number]) => `${r.userId} ${r.date} ${r.thought}`;
  return {
    returned: rows.sort((a, b) => key(a).localeCompare(key(b))),
    deliveries,
  };
}

async function simulate(seed: number, start: number, days: number) {
  const rng = random(seed);
  const reference: World = {
    t: convexTest(schema, modules),
    tick: async () => await reference.t.run(referenceTick),
    deliveries: 0,
  };
  const beforeBackfill: World = {
    t: convexTest(schema, modules),
    tick: async () =>
      void (await beforeBackfill.t.mutation(internal.resurfacing.tick, {})),
    deliveries: 0,
  };
  const afterBackfill: World = {
    t: convexTest(schema, modules),
    tick: async () =>
      void (await afterBackfill.t.mutation(internal.resurfacing.tick, {})),
    deliveries: 0,
  };
  const worlds = [reference, beforeBackfill, afterBackfill];
  // What happened, for the message of a failed comparison.
  const log: string[] = [];
  const everywhere = async (act: (t: Setup) => Promise<unknown>, what: string) => {
    log.push(`${new Date(Date.now()).toISOString()} ${what}`);
    for (const world of worlds) await step(world, act);
  };

  // History from before this release, identical in every world — returns
  // as rows only, the way the old code left them.
  const thoughts: { userId: string; text: string; createdAt: number }[] = [];
  const history: { text: string; at: number }[] = [];
  const minutesBefore = (latest: number, span: number) =>
    latest - rng.below(Math.max(1, Math.floor(span / MINUTE))) * MINUTE;
  for (let i = 0; i < 12; i++) {
    // Whole hours and a coarse grid of days, so equal ages do occur and
    // the tiebreak is exercised.
    const createdAt = start - rng.below(70) * DAY - rng.below(3) * HOUR;
    const text = `user_plenty old ${i}`;
    thoughts.push({ userId: "user_plenty", text, createdAt });
    for (let n = rng.below(3); n > 0; n--) {
      const earliest = createdAt + 3 * DAY;
      if (earliest < start - DAY)
        history.push({ text, at: minutesBefore(start - DAY, start - DAY - earliest) });
    }
  }
  for (let i = 0; i < 4; i++) {
    const text = `user_new old ${i}`;
    thoughts.push({ userId: "user_new", text, createdAt: minutesBefore(start, 4 * DAY) });
  }
  for (let i = 0; i < 5; i++) {
    const text = `user_returned old ${i}`;
    thoughts.push({ userId: "user_returned", text, createdAt: start - (40 + rng.below(30)) * DAY });
    history.push({ text, at: minutesBefore(start - 25 * DAY, 5 * DAY) });
  }
  history.sort((a, b) => a.at - b.at);
  const resting = new Set(thoughts.filter(() => rng.next() < 0.3).map((t) => t.text));
  const settings = USERS.map((userId) => ({
    userId,
    email: `${userId}@example.com`,
    sendTime: rng.pick(SEND_TIMES),
    timezone: rng.pick(ZONES),
  }));
  for (const { t } of worlds) {
    vi.setSystemTime(start - 80 * DAY);
    const ids = new Map(
      await t.run(async (ctx) => {
        for (const row of settings) await ctx.db.insert("settings", row);
        const ids = [];
        for (const thought of thoughts) {
          const status = resting.has(thought.text) ? "resting" : "open";
          const id = await ctx.db.insert("thoughts", { ...thought, status });
          ids.push([thought.text, id] as const);
        }
        return ids;
      }),
    );
    for (const { text, at } of history) {
      vi.setSystemTime(at);
      const thought = thoughts.find((candidate) => candidate.text === text);
      const thoughtId = ids.get(text);
      if (!thought || !thoughtId) throw new Error("fixture");
      await t.run((ctx) =>
        ctx.db.insert("resurfacings", {
          thoughtId,
          userId: thought.userId,
          date: localParts("UTC", at).date,
          deliveredAt: at,
        }),
      );
    }
  }
  vi.setSystemTime(start - 10 * MINUTE);
  await afterBackfill.t.mutation(internal.migrations.backfillFastPaths, {});
  await afterBackfill.t.finishAllScheduledFunctions(vi.runAllTimers);

  let captured = 0;
  const thoughtId = async (t: Setup, text: string) => {
    const thought = await t.run((ctx) =>
      ctx.db
        .query("thoughts")
        .filter((q) => q.eq(q.field("text"), text))
        .first(),
    );
    if (!thought) throw new Error(`no thought "${text}"`);
    return thought._id;
  };
  const texts = async (userId: string, status: "open" | "resting") =>
    await reference.t.run(async (ctx) =>
      (
        await ctx.db
          .query("thoughts")
          .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
          .collect()
      ).map((thought) => thought.text),
    );

  let sends = 0;
  for (let at = start; at < start + days * DAY; at += TICK + 1) {
    // Each tick a millisecond later in its quarter hour than the last. A
    // real cron never fires on the exact millisecond a 20-hour floor or
    // a cooldown ends; on a perfect grid the fake clock does, and then
    // the sub-millisecond order of inserts inside one world decides.
    vi.setSystemTime(at);
    for (const world of worlds) await step(world, world.tick);
    const expected = await observe(reference);
    const context = `seed ${seed}, tick ${new Date(at).toISOString()}, after:\n${log.slice(-12).join("\n")}\n`;
    expect(await observe(afterBackfill), `after the backfill, ${context}`).toEqual(expected);
    expect(await observe(beforeBackfill), `before the backfill, ${context}`).toEqual(expected);
    sends = expected.returned.length - history.length;

    // Between this tick and the next, sometimes something happens.
    vi.setSystemTime(at + (1 + rng.below(13)) * MINUTE);
    const userId = rng.pick(USERS);
    const identity = { subject: userId, email: `${userId}@example.com` };
    const roll = rng.next();
    if (roll < 0.04) {
      const text = `${userId} new ${captured++}`;
      await everywhere(
        (t) => t.withIdentity(identity).mutation(api.thoughts.capture, { text }),
        `capture "${text}"`,
      );
    } else if (roll < 0.07) {
      // Captured offline, anything from minutes to ten days ago.
      const text = `${userId} offline ${captured++}`;
      const createdAt = Date.now() - rng.below(10 * 24 * 60) * MINUTE;
      await everywhere(
        (t) =>
          t
            .withIdentity(identity)
            .mutation(api.thoughts.capture, { text, createdAt, clientId: text }),
        `capture "${text}" from ${new Date(createdAt).toISOString()}`,
      );
    } else if (roll < 0.1) {
      const open = await texts(userId, "open");
      if (open.length > 0) {
        const text = rng.pick(open);
        await everywhere(
          async (t) =>
            t
              .withIdentity(identity)
              .mutation(api.thoughts.rest, { thoughtId: await thoughtId(t, text) }),
          `rest "${text}"`,
        );
      }
    } else if (roll < 0.14) {
      const set = await texts(userId, "resting");
      if (set.length > 0) {
        const text = rng.pick(set);
        await everywhere(
          async (t) =>
            t
              .withIdentity(identity)
              .mutation(api.thoughts.wake, { thoughtId: await thoughtId(t, text) }),
          `wake "${text}"`,
        );
      }
    } else if (roll < 0.16) {
      const args = { sendTime: rng.pick(SEND_TIMES), timezone: rng.pick(ZONES) };
      await everywhere(
        (t) => t.withIdentity(identity).mutation(api.settings.save, args),
        `${userId} saves ${args.sendTime} ${args.timezone}`,
      );
    } else if (roll < 0.18) {
      const args = { timezone: rng.pick(ZONES) };
      await everywhere(
        (t) => t.withIdentity(identity).mutation(api.settings.ensure, args),
        `${userId} arrives in ${args.timezone}`,
      );
    } else if (roll < 0.3) {
      // The email goes through for whichever row is still waiting.
      const waiting = expected.returned.find((r) => !r.delivered && r.userId === userId);
      if (waiting)
        await everywhere(async (t) => {
          const row = await t.run((ctx) =>
            ctx.db
              .query("resurfacings")
              .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", waiting.date))
              .first(),
          );
          if (row)
            await t.mutation(internal.resurfacing.markDelivered, {
              resurfacingId: row._id,
            });
        }, `${userId}'s email for ${waiting.date} is delivered`);
    }
  }
  return sends;
}

describe("the return loop, old and new side by side", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Several starts cross a clock change: New York falls back on 1 Nov
  // 2026 and springs forward on 8 Mar 2026 (when 02:30, one of the send
  // times, does not exist); Auckland changes on 5 Apr and 27 Sep.
  const STARTS = [
    Date.UTC(2026, 9, 30),
    Date.UTC(2026, 2, 6),
    Date.UTC(2026, 5, 14),
    Date.UTC(2026, 11, 29),
    Date.UTC(2026, 3, 3),
    Date.UTC(2026, 8, 25),
  ];
  // RETURN_LOOP_SEEDS=200 bun run test — for a longer look after changing
  // anything the loop depends on.
  const SEEDS = Number(process.env.RETURN_LOOP_SEEDS ?? 8);

  it.each(Array.from({ length: SEEDS }, (_, i) => [i + 1, STARTS[i % STARTS.length]]))(
    "returns the same thoughts at the same ticks (seed %i)",
    async (seed, start) => {
      const sends = await simulate(seed, start, 5);
      // The run must have had something to agree about.
      expect(sends).toBeGreaterThan(2);
    },
    120_000,
  );
});
