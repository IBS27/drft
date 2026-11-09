// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { markReturned } from "../convex/resurfacing";
import schema from "../convex/schema";
import {
  DAY,
  HOUR,
  MINUTE,
  migratedDeployment,
  modules,
  scheduled,
} from "./helpers";
import type { Setup } from "./helpers";

// The return loop one situation at a time: each way a thought can become
// due in the middle of a day, and that the loop notices at the very next
// tick without having asked in between. returnLoopEquivalence.test.ts
// holds the whole against the old tick; this file names the cases.

const A = "user_a";
const TICK = 15 * MINUTE;
// Monday 2 November 2026, 00:00 UTC. Times below are day, hour, minute
// from here; users are on UTC unless a test moves them.
const START = Date.UTC(2026, 10, 2);
const at = (day: number, hour = 0, minute = 0) =>
  START + day * DAY + hour * HOUR + minute * MINUTE;

const as = (t: Setup, userId: string) =>
  t.withIdentity({ subject: userId, email: `${userId}@example.com` });

async function settle(t: Setup) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function tick(t: Setup, time: number) {
  vi.setSystemTime(time);
  await t.mutation(internal.resurfacing.tick, {});
  await settle(t);
}

// Every quarter-hour tick from `from` up to and including `to`.
async function ticks(t: Setup, from: number, to: number) {
  for (let time = from; time <= to; time += TICK) await tick(t, time);
}

async function thought(
  t: Setup,
  userId: string,
  createdAt: number,
  status: "open" | "resting" = "open",
) {
  return await t.run((ctx) =>
    ctx.db.insert("thoughts", {
      userId,
      text: `kept ${new Date(createdAt).toISOString()}`,
      createdAt,
      status,
    }),
  );
}

// The thought came back (and was delivered) at `time`.
async function returnedAt(t: Setup, thoughtId: Id<"thoughts">, time: number) {
  vi.setSystemTime(time);
  await t.run(async (ctx) => {
    const thought = await ctx.db.get(thoughtId);
    const resurfacingId = await ctx.db.insert("resurfacings", {
      thoughtId,
      userId: thought?.userId,
      date: new Date(time).toISOString().slice(0, 10),
      deliveredAt: time,
    });
    await markReturned(ctx, thoughtId, resurfacingId);
  });
}

async function returned(t: Setup, userId: string) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("resurfacings")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect(),
  );
  return rows.map((r) => ({ date: r.date, thoughtId: r.thoughtId }));
}

async function nextDueAt(t: Setup, userId: string) {
  const row = await t.run((ctx) =>
    ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first(),
  );
  return row?.nextDueAt;
}

beforeEach(() => {
  vi.useFakeTimers();
  // Long before anything a test dates: the fake database never lets a
  // row's creation time run backwards, so history is laid down in order.
  vi.setSystemTime(START - 400 * DAY);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Both sides of migrations:backfillFastPaths: the indexed selection, and
// the scan it replaces until thoughts returned before the release carry
// lastReturnedAt.
describe.each([
  ["after the backfill", migratedDeployment],
  ["before the backfill", async () => convexTest(schema, modules)],
])("the daily return, %s", (_, deployment) => {
  // A user on UTC whose thought arrives at 08:00.
  async function start(sendTime = "08:00") {
    const t = await deployment();
    await as(t, A).mutation(api.settings.save, { sendTime, timezone: "UTC" });
    return t;
  }

  it("waits for the chosen time, then returns the thought at that tick", async () => {
    const t = await start();
    const id = await thought(t, A, at(-10));

    await tick(t, at(0, 7, 45));
    expect(await returned(t, A)).toEqual([]);
    expect(await nextDueAt(t, A)).toBe(at(0, 8));

    await tick(t, at(0, 8));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
  });

  it("returns a thought that comes of age during the day at that tick", async () => {
    const t = await start();
    // Three days old at 13:07 today.
    const id = await thought(t, A, at(-3, 13, 7));

    await ticks(t, at(0, 8), at(0, 13));
    expect(await returned(t, A)).toEqual([]);
    // Not asked every tick in between: told once when to look.
    expect(await nextDueAt(t, A)).toBe(at(0, 13, 7));
    expect(await scheduled(t, "resurfacing:forUser")).toBe(1);

    await tick(t, at(0, 13, 15));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
  });

  it("returns a thought whose cooldown runs out during the day at that tick", async () => {
    const t = await start();
    const id = await thought(t, A, at(-90));
    // Thirty days ago at 10:20.
    await returnedAt(t, id, at(-30, 10, 20));

    await ticks(t, at(0, 8), at(0, 10, 15));
    expect(await returned(t, A)).toHaveLength(1);
    expect(await scheduled(t, "resurfacing:forUser")).toBe(1);

    await tick(t, at(0, 10, 30));
    expect(await returned(t, A)).toContainEqual({ date: "2026-11-02", thoughtId: id });
  });

  it("returns a woken thought at the next tick", async () => {
    const t = await start();
    const id = await thought(t, A, at(-10), "resting");

    await tick(t, at(0, 8));
    expect(await returned(t, A)).toEqual([]);
    expect(await nextDueAt(t, A)).toBeGreaterThan(at(1));

    vi.setSystemTime(at(0, 10, 7));
    await as(t, A).mutation(api.thoughts.wake, { thoughtId: id });
    await tick(t, at(0, 10, 15));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
  });

  it("does not return a woken thought that is still cooling down", async () => {
    const t = await start();
    const id = await thought(t, A, at(-90), "resting");
    await returnedAt(t, id, at(-10, 9));

    await tick(t, at(0, 8));
    vi.setSystemTime(at(0, 10, 7));
    await as(t, A).mutation(api.thoughts.wake, { thoughtId: id });
    await ticks(t, at(0, 10, 15), at(0, 12));

    expect(await returned(t, A)).toHaveLength(1);
    // Twenty days of cooldown left is later than the loop meant to look
    // anyway, so waking it changed nothing.
    expect(await nextDueAt(t, A)).toBe(at(0, 8) + 3 * DAY - HOUR);
    expect(await scheduled(t, "resurfacing:forUser")).toBe(1);
  });

  it("returns a capture made now once it is three days old, without being told", async () => {
    const t = await start();
    await tick(t, at(0, 8));

    vi.setSystemTime(at(0, 9, 10));
    const id = await as(t, A).mutation(api.thoughts.capture, { text: "new" });
    // A plain capture leaves the schedule alone.
    expect(await nextDueAt(t, A)).toBe(at(0, 8) + 3 * DAY - HOUR);

    await ticks(t, at(0, 9, 15), at(3, 9));
    expect(await returned(t, A)).toEqual([]);
    await tick(t, at(3, 9, 15));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-05", thoughtId: id }]);
  });

  it("returns on time a capture that reached the server a little late", async () => {
    // Midnight send time, so the day it comes of age is decided by the
    // minute: three days after 23:20 is still the 4th.
    const t = await start("00:00");
    await tick(t, at(0, 0));

    vi.setSystemTime(at(0, 0, 5));
    const id = await as(t, A).mutation(api.thoughts.capture, {
      text: "typed on the train",
      createdAt: at(-1, 23, 20),
    });

    await ticks(t, at(0, 0, 15), at(2, 23, 15));
    expect(await returned(t, A)).toEqual([]);
    await tick(t, at(2, 23, 30));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-04", thoughtId: id }]);
  });

  it("returns an offline capture from days ago at the next tick", async () => {
    const t = await start();
    await tick(t, at(0, 8));

    vi.setSystemTime(at(0, 11, 2));
    const id = await as(t, A).mutation(api.thoughts.capture, {
      text: "written on a flight",
      createdAt: at(-5),
      clientId: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
    });

    await tick(t, at(0, 11, 15));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
  });

  it("honours a send time moved earlier at the next tick", async () => {
    const t = await start("20:00");
    const id = await thought(t, A, at(-10));
    await tick(t, at(0, 9));
    expect(await nextDueAt(t, A)).toBe(at(0, 20));

    vi.setSystemTime(at(0, 9, 5));
    await as(t, A).mutation(api.settings.save, { sendTime: "09:00", timezone: "UTC" });
    await tick(t, at(0, 9, 15));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
  });

  it("honours a new timezone at the next tick", async () => {
    const t = await start("20:00");
    const id = await thought(t, A, at(-10));
    await tick(t, at(0, 9));

    // 09:05 UTC is 22:05 in Auckland: already past 20:00 there.
    vi.setSystemTime(at(0, 9, 5));
    await as(t, A).mutation(api.settings.ensure, { timezone: "Pacific/Auckland" });
    await tick(t, at(0, 9, 15));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
  });

  it("keeps one email per waking day across a timezone change, and resumes when the floor lapses", async () => {
    const t = await start();
    const first = await thought(t, A, at(-10));
    const second = await thought(t, A, at(-9));
    await tick(t, at(0, 8));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: first }]);

    // Lands in Auckland: 12:00 UTC is 01:00 on the 3rd there, a new day
    // whose 08:00 comes only eleven hours after the last email.
    vi.setSystemTime(at(0, 12));
    await as(t, A).mutation(api.settings.ensure, { timezone: "Pacific/Auckland" });
    await ticks(t, at(0, 12), at(1, 3, 45));
    expect(await returned(t, A)).toHaveLength(1);

    // Twenty hours after the first, to the tick.
    await ticks(t, at(1, 4), at(1, 4, 15));
    expect(await returned(t, A)).toContainEqual({ date: "2026-11-03", thoughtId: second });
  });

  it("picks up a row dated ahead of today when its date arrives", async () => {
    // Chosen in Auckland for the 3rd, never delivered; the user is back
    // on UTC, where the 3rd has not started.
    const t = await start("00:00");
    const id = await thought(t, A, at(-10));
    vi.setSystemTime(at(0, 13));
    await t.run((ctx) =>
      ctx.db.insert("resurfacings", { thoughtId: id, userId: A, date: "2026-11-03" }),
    );
    await ticks(t, at(0, 13), at(0, 23, 45));
    expect(await scheduled(t, "email:deliver")).toBe(0);

    await tick(t, at(1, 0));
    expect(await scheduled(t, "email:deliver")).toBe(1);
  });

  it("hands an undelivered thought to delivery again every tick, then waits for tomorrow", async () => {
    const t = await start();
    const id = await thought(t, A, at(-10));
    await thought(t, A, at(-9));

    await tick(t, at(0, 8));
    expect(await scheduled(t, "email:deliver")).toBe(1);
    await tick(t, at(0, 8, 15));
    await tick(t, at(0, 8, 30));
    expect(await scheduled(t, "email:deliver")).toBe(3);
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);

    const row = await t.run((ctx) => ctx.db.query("resurfacings").first());
    if (!row) throw new Error("no resurfacing");
    await t.mutation(internal.resurfacing.markDelivered, { resurfacingId: row._id });

    await ticks(t, at(0, 8, 45), at(1, 7, 45));
    expect(await scheduled(t, "email:deliver")).toBe(3);
    expect(await nextDueAt(t, A)).toBe(at(1, 8));
    // Asked once after delivery, then not again until tomorrow's time.
    expect(await scheduled(t, "resurfacing:forUser")).toBe(4);

    await tick(t, at(1, 8));
    expect(await returned(t, A)).toHaveLength(2);
  });

  it("goes quiet for a user with nothing to return, without forgetting them", async () => {
    const t = await start();
    await ticks(t, at(0, 8), at(2, 8));
    // One look, then none for nearly three days.
    expect(await scheduled(t, "resurfacing:forUser")).toBe(1);
    await ticks(t, at(2, 8, 15), at(4, 8));
    expect(await scheduled(t, "resurfacing:forUser")).toBeLessThanOrEqual(4);
  });
});

describe("delivery", () => {
  it("clears the stored email once it is delivered, and replays it exactly until then", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    let status = 500;
    const fetchMock = vi.fn(async () => new Response("{}", { status }));
    vi.stubGlobal("fetch", fetchMock);

    const t = await migratedDeployment();
    await as(t, A).mutation(api.settings.save, { sendTime: "08:00", timezone: "UTC" });
    await thought(t, A, at(-10));
    const row = async () => {
      const resurfacing = await t.run((ctx) => ctx.db.query("resurfacings").first());
      if (!resurfacing) throw new Error("no resurfacing");
      return resurfacing;
    };

    // Resend is down: the request is kept so the retry is a replay.
    await tick(t, at(0, 8));
    expect((await row()).deliveredAt).toBeUndefined();
    expect((await row()).emailPayload?.to).toBe(`${A}@example.com`);

    status = 200;
    await tick(t, at(0, 8, 15));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(second[1].body).toBe(first[1].body);
    expect((await row()).deliveredAt).toBe(at(0, 8, 15));
    expect((await row()).emailPayload).toBeUndefined();

    // Delivered: nothing is sent again, today or by a stray retry.
    await ticks(t, at(0, 8, 30), at(0, 12));
    await t.action(internal.email.deliver, { resurfacingId: (await row())._id });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the tick", () => {
  it("treats a settings row from before nextDueAt existed as due", async () => {
    const t = await migratedDeployment();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", {
        userId: A,
        email: "a@example.com",
        sendTime: "08:00",
        timezone: "UTC",
      });
    });
    const id = await thought(t, A, at(-10));

    await tick(t, at(0, 8));
    expect(await returned(t, A)).toEqual([{ date: "2026-11-02", thoughtId: id }]);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("resurfacings").first();
      if (row) await ctx.db.patch(row._id, { deliveredAt: Date.now() });
    });
    await tick(t, at(0, 8, 15));
    expect(await nextDueAt(t, A)).toBe(at(1, 8));
  });

  it("does not let one user's failure cost anyone else their thought", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await migratedDeployment();
    const users = ["user_a", "user_broken", "user_c"];
    const ids = new Map<string, Id<"thoughts">>();
    for (const userId of users) {
      await as(t, userId).mutation(api.settings.save, {
        sendTime: "08:00",
        timezone: "UTC",
      });
      ids.set(userId, await thought(t, userId, at(-10)));
    }
    // A row no code path writes: its run throws on the timezone.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", "user_broken"))
        .first();
      if (row) await ctx.db.patch(row._id, { timezone: "Nowhere/Nothing" });
    });

    await tick(t, at(0, 8));
    expect(await returned(t, "user_a")).toHaveLength(1);
    expect(await returned(t, "user_c")).toHaveLength(1);
    expect(await returned(t, "user_broken")).toEqual([]);

    // Still due, so the next tick tries again — and succeeds once the
    // row is whole.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("settings")
        .withIndex("by_user", (q) => q.eq("userId", "user_broken"))
        .first();
      if (row) await ctx.db.patch(row._id, { timezone: "UTC" });
    });
    await tick(t, at(0, 8, 15));
    expect(await returned(t, "user_broken")).toEqual([
      { date: "2026-11-02", thoughtId: ids.get("user_broken") },
    ]);
  });

  it("reaches every due user, however many, inside Convex's limits", async () => {
    const t = await migratedDeployment({
      schema,
      modules,
      transactionLimits: true,
    });
    const USERS = 450;
    await t.run(async (ctx) => {
      for (let i = 0; i < USERS; i++) {
        await ctx.db.insert("settings", {
          userId: `user_${i}`,
          email: `${i}@example.com`,
          sendTime: "08:00",
          timezone: "UTC",
          nextDueAt: at(0, 8),
        });
        await ctx.db.insert("thoughts", {
          userId: `user_${i}`,
          text: `thought ${i}`,
          createdAt: at(-10),
          status: "open",
        });
      }
    });

    await tick(t, at(0, 8));
    const rows = await t.run((ctx) => ctx.db.query("resurfacings").collect());
    expect(new Set(rows.map((r) => r.userId)).size).toBe(USERS);
    // Three pages of 200.
    expect(await scheduled(t, "resurfacing:tick")).toBe(2);
  });
});

describe("settings", () => {
  it("leaves the row alone when a load changes nothing", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(at(0, 9));
    await as(t, A).mutation(api.settings.ensure, { timezone: "UTC" });
    expect(await nextDueAt(t, A)).toBe(at(0, 9));
    await tick(t, at(0, 9));
    const scheduledFor = await nextDueAt(t, A);

    vi.setSystemTime(at(0, 9, 20));
    await as(t, A).mutation(api.settings.ensure, { timezone: "UTC" });
    await as(t, A).mutation(api.settings.save, { sendTime: "08:00", timezone: "UTC" });
    expect(await nextDueAt(t, A)).toBe(scheduledFor);

    // The address is kept current without touching the schedule.
    await t
      .withIdentity({ subject: A, email: "new@example.com" })
      .mutation(api.settings.ensure, { timezone: "UTC" });
    expect(await as(t, A).query(api.settings.get, {})).toEqual({
      sendTime: "08:00",
      timezone: "UTC",
      email: "new@example.com",
    });
    expect(await nextDueAt(t, A)).toBe(scheduledFor);
  });
});

describe("the dev seed", () => {
  it("keeps fabricated returns in step with the rotation and tells the loop to look", async () => {
    vi.stubEnv("SEED_ALLOWED", "1");
    const t = await migratedDeployment();
    await as(t, A).mutation(api.settings.save, { sendTime: "08:00", timezone: "UTC" });
    const own = await thought(t, A, at(-40));
    const other = await thought(t, A, at(-39));
    // A pre-phase-5 fake (no userId) on a real thought, as the old seed left.
    vi.setSystemTime(at(-20));
    await t.run(async (ctx) => {
      const resurfacingId = await ctx.db.insert("resurfacings", {
        thoughtId: other,
        date: "2026-10-13",
      });
      await markReturned(ctx, other, resurfacingId);
    });
    const farOff = async () =>
      await t.run(async (ctx) => {
        const row = await ctx.db.query("settings").first();
        if (row) await ctx.db.patch(row._id, { nextDueAt: at(5) });
      });
    const lastReturnedAt = async (id: Id<"thoughts">) =>
      (await t.run((ctx) => ctx.db.get(id)))?.lastReturnedAt;

    // Planting aged samples and "returning" the oldest open thought.
    await farOff();
    vi.setSystemTime(at(0, 7, 5));
    await t.mutation(internal.seed.run, { date: "2026-11-01" });
    await settle(t);
    expect(await nextDueAt(t, A)).toBe(at(0, 7, 5));
    expect(await returned(t, A)).toContainEqual({ date: "2026-11-01", thoughtId: own });
    const seededAt = await lastReturnedAt(own);
    expect(Math.floor(seededAt ?? 0)).toBe(at(0, 7, 5));

    // Clearing drops the old fake, so that thought has never returned.
    await farOff();
    vi.setSystemTime(at(0, 7, 20));
    await t.mutation(internal.seed.clear, {});
    expect(await lastReturnedAt(other)).toBeUndefined();
    expect(await lastReturnedAt(own)).toBe(seededAt);
    expect(await nextDueAt(t, A)).toBe(at(0, 7, 20));
    expect(await t.run((ctx) => ctx.db.query("thoughts").collect())).toHaveLength(2);
  });
});
