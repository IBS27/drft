// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { DAY, modules } from "./helpers";
import type { Setup } from "./helpers";

// migrations:backfillFastPaths, against a deployment as the previous
// release left it: embeddings inline on thoughts, connections without an
// owner, returns recorded only as rows.

const A = "user_a";
const B = "user_b";
const START = Date.UTC(2026, 10, 2);
const THOUGHTS_EACH = 7;

const embeddingFor = (i: number) => [i + 1, 0.5, -i, 0.25];

type Legacy = {
  a: Id<"thoughts">[];
  b: Id<"thoughts">[];
  gone: Id<"thoughts">;
  dangling: Id<"connections">;
  crossOwner: Id<"connections">;
};

async function legacyDeployment(t: Setup): Promise<Legacy> {
  vi.setSystemTime(START - 100 * DAY);
  const legacy = await t.run(async (ctx) => {
    const plant = async (userId: string) => {
      const ids: Id<"thoughts">[] = [];
      for (let i = 0; i < THOUGHTS_EACH; i++)
        ids.push(
          await ctx.db.insert("thoughts", {
            userId,
            text: `${userId} thought ${i}`,
            createdAt: START - (90 - i) * DAY,
            status: i === 5 ? "resting" : "open",
            // The last was captured without permission: never embedded.
            ...(i < THOUGHTS_EACH - 1 ? { embedding: embeddingFor(i) } : {}),
          }),
        );
      return ids;
    };
    const a = await plant(A);
    const b = await plant(B);
    const gone = await ctx.db.insert("thoughts", {
      userId: A,
      text: "deleted since",
      createdAt: 1,
      status: "open",
    });
    await ctx.db.insert("connections", { fromId: a[0], toId: a[1], score: 0.9 });
    await ctx.db.insert("connections", { fromId: a[0], toId: a[2], score: 0.8 });
    await ctx.db.insert("connections", { fromId: a[3], toId: a[0], score: 0.7, dismissedAt: 5 });
    await ctx.db.insert("connections", { fromId: b[1], toId: b[0], score: 0.6 });
    const dangling = await ctx.db.insert("connections", { fromId: a[1], toId: gone, score: 0.9 });
    const crossOwner = await ctx.db.insert("connections", { fromId: a[2], toId: b[2], score: 0.9 });
    await ctx.db.delete(gone);
    return { a, b, gone, dangling, crossOwner };
  });
  // Returns, in the order they happened: a[0] twice, a[4] once, and one
  // row from before rows carried a user.
  const returns: [Id<"thoughts">, number, string | undefined][] = [
    [legacy.a[4], START - 60 * DAY, undefined],
    [legacy.a[0], START - 50 * DAY, A],
    [legacy.a[0], START - 12 * DAY, A],
    [legacy.b[0], START - 5 * DAY, B],
  ];
  for (const [thoughtId, at, userId] of returns) {
    vi.setSystemTime(at);
    await t.run((ctx) =>
      ctx.db.insert("resurfacings", {
        thoughtId,
        date: new Date(at).toISOString().slice(0, 10),
        deliveredAt: at,
        ...(userId ? { userId } : {}),
      }),
    );
  }
  vi.setSystemTime(START);
  return legacy;
}

// Everything the backfill touches, as it stands.
async function state(t: Setup) {
  return await t.run(async (ctx) => ({
    thoughts: await ctx.db.query("thoughts").collect(),
    embeddings: await ctx.db.query("thoughtEmbeddings").collect(),
    connections: await ctx.db.query("connections").collect(),
    flags: (await ctx.db.query("migrationState").collect()).map((row) => row.name).sort(),
  }));
}

// What each user can see through the readers the backfill switches over,
// which must not change at any point.
async function visible(t: Setup, legacy: Legacy) {
  const seen: Record<string, unknown> = {};
  for (const [userId, ids] of [
    [A, legacy.a],
    [B, legacy.b],
  ] as const) {
    const user = t.withIdentity({ subject: userId });
    const graph = [];
    let cursor: string | null = null;
    do {
      const page = await user.query(api.thoughts.connectionGraph, {
        paginationOpts: { numItems: 3, cursor },
      });
      graph.push(...page.page);
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
    seen[userId] = {
      graph,
      views: await Promise.all(
        ids.map((thoughtId) => user.query(api.thoughts.view, { thoughtId })),
      ),
      collection: await user.query(api.thoughts.collection, { date: "2026-11-02" }),
      resting: await user.query(api.thoughts.resting, {}),
    };
  }
  return seen;
}

// Each embedding in exactly one place, value intact.
function expectEveryEmbeddingOnce(now: Awaited<ReturnType<typeof state>>, legacy: Legacy) {
  for (const [userId, ids] of [
    [A, legacy.a],
    [B, legacy.b],
  ] as const) {
    ids.forEach((thoughtId, i) => {
      const inline = now.thoughts.find((t) => t._id === thoughtId)?.embedding;
      const rows = now.embeddings.filter((row) => row.thoughtId === thoughtId);
      const found = [
        ...(inline ? [inline] : []),
        ...rows.map((row) => {
          expect(row.userId).toBe(userId);
          return row.embedding;
        }),
      ];
      expect(found).toEqual(i < THOUGHTS_EACH - 1 ? [embeddingFor(i)] : []);
    });
  }
}

async function finish(t: Setup) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("migrations:backfillFastPaths", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("carries a legacy deployment over without changing anything a user can see", async () => {
    const t = convexTest(schema, modules);
    const legacy = await legacyDeployment(t);
    const before = await visible(t, legacy);
    expect(await t.query(internal.migrations.fastPathStatus, {})).toEqual({
      embeddingsMoved: false,
      lastReturnedAt: false,
      connectionOwners: false,
    });
    // The legacy readers hide an edge to a deleted thought or to someone
    // else's; nothing below may bring one into view.
    expect(JSON.stringify(before)).not.toContain(legacy.gone);

    // One batch in, then interrupted: partly moved, still on the old paths.
    const first = await t.mutation(internal.migrations.backfillFastPaths, { batchSize: 3 });
    expect(first).toEqual({ phase: "thoughts", changed: 3, done: false });
    const midway = await state(t);
    expect(midway.flags).toEqual([]);
    expect(midway.embeddings).toHaveLength(3);
    expectEveryEmbeddingOnce(midway, legacy);
    expect(await visible(t, legacy)).toEqual(before);

    // Started again from the top while the first run's next batch is
    // still queued: both run to the end, in any order.
    await t.mutation(internal.migrations.backfillFastPaths, { batchSize: 4 });
    await finish(t);

    const after = await state(t);
    expect(after.flags).toEqual(["connectionOwners", "embeddingsMoved", "lastReturnedAt"]);
    expect(await t.query(internal.migrations.fastPathStatus, {})).toEqual({
      embeddingsMoved: true,
      lastReturnedAt: true,
      connectionOwners: true,
    });
    expect(after.thoughts.every((thought) => thought.embedding === undefined)).toBe(true);
    expect(after.embeddings).toHaveLength(2 * (THOUGHTS_EACH - 1));
    expectEveryEmbeddingOnce(after, legacy);
    expect(await visible(t, legacy)).toEqual(before);

    // lastReturnedAt is the newest return, userless rows included.
    const lastReturnedAt = (id: Id<"thoughts">) =>
      after.thoughts.find((thought) => thought._id === id)?.lastReturnedAt;
    expect(lastReturnedAt(legacy.a[0])).toBe(START - 12 * DAY);
    expect(lastReturnedAt(legacy.a[4])).toBe(START - 60 * DAY);
    expect(lastReturnedAt(legacy.b[0])).toBe(START - 5 * DAY);
    expect(after.thoughts.filter((thought) => thought.lastReturnedAt !== undefined)).toHaveLength(3);

    // Every real edge has its owner; the two no reader ever showed are
    // left as they were, ownerless, and stay hidden.
    for (const connection of after.connections) {
      const hidden = [legacy.dangling, legacy.crossOwner].includes(connection._id);
      expect(connection.userId).toBe(
        hidden ? undefined : legacy.a.includes(connection.fromId) ? A : B,
      );
    }
    expect(after.connections).toHaveLength(6);

    // Running it again finds nothing to do and changes nothing.
    const again = await t.mutation(internal.migrations.backfillFastPaths, {});
    expect(again.changed).toBe(0);
    await finish(t);
    expect(await state(t)).toEqual(after);
  });

  it("picks the same thought to return before, during and after", async () => {
    const worlds = [];
    for (const progress of ["before", "midway", "after"] as const) {
      const t = convexTest(schema, modules);
      const legacy = await legacyDeployment(t);
      await t.run((ctx) =>
        ctx.db.insert("settings", {
          userId: A,
          email: "a@example.com",
          sendTime: "00:00",
          timezone: "UTC",
        }),
      );
      if (progress !== "before")
        await t.mutation(internal.migrations.backfillFastPaths, { batchSize: 3 });
      if (progress === "after") await finish(t);
      else await t.run(async (ctx) => {
        // Leave the queued batch unrun: this deployment stays midway.
        for (const job of await ctx.db.system.query("_scheduled_functions").collect())
          await ctx.scheduler.cancel(job._id);
      });

      // Six days of returns: never-returned thoughts oldest first, then
      // the one whose return is oldest and out of its cooldown.
      const picked = [];
      for (let day = 0; day < 6; day++) {
        vi.setSystemTime(START + day * DAY + 60_000);
        await t.mutation(internal.resurfacing.forUser, { userId: A });
        const row = await t.run((ctx) =>
          ctx.db
            .query("resurfacings")
            .withIndex("by_user_date", (q) => q.eq("userId", A))
            .order("desc")
            .first(),
        );
        picked.push(row ? legacy.a.indexOf(row.thoughtId) : null);
      }
      worlds.push(picked);
    }
    const [before, midway, after] = worlds;
    expect(before).toEqual([1, 2, 3, 6, 4, 4]);
    expect(midway).toEqual(before);
    expect(after).toEqual(before);
  });

  it("finishes at once on a deployment with nothing to move", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.migrations.backfillFastPaths, {})).toEqual({
      phase: "thoughts",
      changed: 0,
      done: false,
    });
    await finish(t);
    expect((await state(t)).flags).toEqual([
      "connectionOwners",
      "embeddingsMoved",
      "lastReturnedAt",
    ]);
  });

  it("moves real-sized embeddings a batch at a time inside Convex's limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i++)
        await ctx.db.insert("thoughts", {
          userId: A,
          text: `thought ${i}`,
          createdAt: i,
          status: "open",
          embedding,
        });
    });

    await t.mutation(internal.migrations.backfillFastPaths, {});
    await finish(t);

    const after = await state(t);
    expect(after.flags).toHaveLength(3);
    expect(after.embeddings).toHaveLength(120);
    expect(after.thoughts.some((thought) => thought.embedding !== undefined)).toBe(false);
  });
});
