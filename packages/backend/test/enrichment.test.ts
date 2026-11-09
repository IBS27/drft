// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { migratedDeployment, modules, scheduled, watchBackend } from "./helpers";
import type { Setup } from "./helpers";

// The embedding API, replaced by a table: each test says what direction a
// text points in, and cosine similarity does the rest. Unlisted text
// points somewhere nothing else does.
const { directions, embedMany } = vi.hoisted(() => {
  const directions = new Map<string, number[]>();
  const embedMany = vi.fn(async ({ values }: { values: string[] }) => ({
    embeddings: values.map((text) => directions.get(text) ?? [0, 0, 0, 1]),
  }));
  return { directions, embedMany };
});
vi.mock("ai", () => ({ embedMany }));

const A = "user_a";
const B = "user_b";

// A unit vector whose cosine with [1, 0, 0, 0] is `similarity`.
const toward = (similarity: number) => [
  similarity,
  Math.sqrt(1 - similarity * similarity),
  0,
  0,
];

const as = (t: Setup, userId: string) =>
  t.withIdentity({ subject: userId, email: `${userId}@example.com` });

async function allow(t: Setup, userId: string) {
  await t.run((ctx) =>
    ctx.db.insert("consents", { userId, aiConnections: true, decidedAt: 1 }),
  );
}

// A thought already embedded: in `thoughtEmbeddings`, or inline the way
// thoughts were before that table.
async function embedded(
  t: Setup,
  userId: string,
  text: string,
  embedding: number[],
  where: "table" | "inline" = "table",
) {
  return await t.run(async (ctx) => {
    const thoughtId = await ctx.db.insert("thoughts", {
      userId,
      text,
      createdAt: 1_000,
      status: "open",
      ...(where === "inline" ? { embedding } : {}),
    });
    if (where === "table")
      await ctx.db.insert("thoughtEmbeddings", { thoughtId, userId, embedding });
    return thoughtId;
  });
}

async function capture(t: Setup, userId: string, text: string, embedding: number[]) {
  directions.set(text, embedding);
  const id = await as(t, userId).mutation(api.thoughts.capture, { text });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return id;
}

const links = (t: Setup) =>
  t.run(async (ctx) =>
    (await ctx.db.query("connections").collect()).map((c) => ({
      fromId: c.fromId,
      toId: c.toId,
      score: Number(c.score.toFixed(2)),
      userId: c.userId,
    })),
  );

const embeddingOf = (t: Setup, thoughtId: Id<"thoughts">) =>
  t.run(async (ctx) => ({
    inline: (await ctx.db.get(thoughtId))?.embedding,
    rows: (
      await ctx.db
        .query("thoughtEmbeddings")
        .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
        .collect()
    ).map((row) => ({ userId: row.userId, embedding: row.embedding })),
  }));

let backend: ReturnType<typeof watchBackend>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  directions.clear();
  embedMany.mockClear();
});

afterEach(() => {
  backend?.restore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("enrichment after a capture", () => {
  async function start() {
    const t = await migratedDeployment();
    backend = watchBackend();
    await allow(t, A);
    return t;
  }

  it("is one read, one search and one write", async () => {
    const t = await start();
    const near = await embedded(t, A, "near", toward(0.9));
    const nearer = await embedded(t, A, "nearer", toward(0.95));
    await embedded(t, A, "also near", toward(0.8));
    await embedded(t, A, "unrelated", toward(0.2));

    directions.set("new", toward(1));
    const id = await t.run((ctx) =>
      ctx.db.insert("thoughts", { userId: A, text: "new", createdAt: 2_000, status: "open" }),
    );
    const before = backend.transactions.length;
    await t.action(internal.enrichment.enrich, { thoughtId: id });

    // Everything the action asked of the database: a query, then the one
    // mutation — a single commit for the thought's page to react to.
    expect(
      backend.transactions.slice(before).map((txn) => txn.documentsWritten > 0),
    ).toEqual([false, true]);
    expect(backend.searches).toEqual(["thoughtEmbeddings.by_embedding"]);
    // The embedding is stored apart from the thought.
    expect(await embeddingOf(t, id)).toEqual({
      inline: undefined,
      rows: [{ userId: A, embedding: toward(1) }],
    });
    // The two strongest, each carrying its owner; never a third.
    expect(await links(t)).toEqual([
      { fromId: id, toId: nearer, score: 0.95, userId: A },
      { fromId: id, toId: near, score: 0.9, userId: A },
    ]);
  });

  it("links nothing below the threshold, and nothing across owners", async () => {
    const t = await start();
    await embedded(t, A, "faint", toward(0.41));
    await embedded(t, B, "someone else's", toward(0.99));
    const resonant = await embedded(t, A, "resonant", toward(0.43));

    const id = await capture(t, A, "new", toward(1));
    expect(await links(t)).toEqual([
      { fromId: id, toId: resonant, score: 0.43, userId: A },
    ]);
  });

  it("never re-offers a pair already linked or dismissed, in either direction", async () => {
    const t = await start();
    const dismissed = await embedded(t, A, "dismissed", toward(0.99));
    const linkedBack = await embedded(t, A, "linked back", toward(0.98));
    const fresh = await embedded(t, A, "fresh", toward(0.6));
    const id = await as(t, A).mutation(api.thoughts.capture, { text: "new" });
    await t.run(async (ctx) => {
      await ctx.db.insert("connections", {
        fromId: id,
        toId: dismissed,
        score: 0.5,
        dismissedAt: 1,
        userId: A,
      });
      await ctx.db.insert("connections", {
        fromId: linkedBack,
        toId: id,
        score: 0.5,
        userId: A,
      });
    });
    directions.set("new", toward(1));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await links(t)).toHaveLength(3);
    expect(await links(t)).toContainEqual({ fromId: id, toId: fresh, score: 0.6, userId: A });
  });

  it("weighs only the nearest seven other thoughts", async () => {
    const t = await start();
    const id = await as(t, A).mutation(api.thoughts.capture, { text: "new" });
    // Seven nearer neighbours, all dismissed, crowd out an eighth that
    // would otherwise link.
    for (let i = 0; i < 7; i++) {
      const toId = await embedded(t, A, `dismissed ${i}`, toward(0.9 - i * 0.01));
      await t.run((ctx) =>
        ctx.db.insert("connections", { fromId: id, toId, score: 0.9, dismissedAt: 1, userId: A }),
      );
    }
    await embedded(t, A, "eighth", toward(0.7));
    directions.set("new", toward(1));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await links(t)).filter((c) => c.score !== 0.9)).toEqual([]);
  });

  it("replaces the embedding of a thought enriched again, without linking it to itself or twice", async () => {
    const t = await start();
    const near = await embedded(t, A, "near", toward(0.9));
    const id = await capture(t, A, "new", toward(1));
    expect(await links(t)).toHaveLength(1);

    directions.set("new", toward(0.99));
    await t.action(internal.enrichment.enrich, { thoughtId: id });

    expect((await embeddingOf(t, id)).rows).toEqual([
      { userId: A, embedding: toward(0.99) },
    ]);
    expect(await links(t)).toEqual([{ fromId: id, toId: near, score: 0.9, userId: A }]);
  });

  it("sends nothing without permission, and stores nothing if it is withdrawn meanwhile", async () => {
    const t = await migratedDeployment();
    backend = watchBackend();
    const near = await embedded(t, A, "near", toward(0.9));

    // Never asked: capture does not even schedule it; run directly, the
    // text still never leaves.
    const id = await capture(t, A, "new", toward(1));
    expect(await scheduled(t, "enrichment:enrich")).toBe(0);
    await t.action(internal.enrichment.enrich, { thoughtId: id });
    expect(embedMany).not.toHaveBeenCalled();

    // Allowed when the text was sent, withdrawn by the time the result
    // is back: the write checks again.
    const hit = await t.run((ctx) =>
      ctx.db
        .query("thoughtEmbeddings")
        .withIndex("by_thought", (q) => q.eq("thoughtId", near))
        .first(),
    );
    if (!hit) throw new Error("fixture");
    await t.mutation(internal.store.enriched, {
      thoughtId: id,
      embedding: toward(1),
      neighbours: [{ embeddingId: hit._id, score: 0.9 }],
    });
    expect((await embeddingOf(t, id)).rows).toEqual([]);
    expect(await links(t)).toEqual([]);
  });

  it("never links to a thought that is gone by the time the result is back", async () => {
    const t = await start();
    const near = await embedded(t, A, "near", toward(0.9));
    const id = await as(t, A).mutation(api.thoughts.capture, { text: "new" });
    const hit = await t.run((ctx) =>
      ctx.db
        .query("thoughtEmbeddings")
        .withIndex("by_thought", (q) => q.eq("thoughtId", near))
        .first(),
    );
    if (!hit) throw new Error("fixture");
    const neighbours = [{ embeddingId: hit._id, score: 0.9 }];

    await t.run((ctx) => ctx.db.delete(near));
    await t.mutation(internal.store.enriched, {
      thoughtId: id,
      embedding: toward(1),
      neighbours,
    });
    expect(await links(t)).toEqual([]);
    expect((await embeddingOf(t, id)).rows).toHaveLength(1);

    // And nothing at all for a thought deleted while the action was out.
    await t.run((ctx) => ctx.db.delete(id));
    await t.mutation(internal.store.enriched, {
      thoughtId: id,
      embedding: toward(1),
      neighbours,
    });
    expect((await embeddingOf(t, id)).rows).toHaveLength(1);
  });
});

describe("enrichment before the backfill has moved older embeddings", () => {
  it("searches both homes and links to the strongest of either", async () => {
    const t = convexTest(schema, modules);
    backend = watchBackend();
    await allow(t, A);
    const legacyNear = await embedded(t, A, "legacy near", toward(0.9), "inline");
    await embedded(t, A, "legacy far", toward(0.5), "inline");
    const moved = await embedded(t, A, "already in the table", toward(0.95));
    await embedded(t, B, "someone else's", toward(0.99), "inline");

    const id = await capture(t, A, "new", toward(1));

    // Old home first: an embedding moved between the two searches is
    // then still found by the second.
    expect(backend.searches).toEqual([
      "thoughts.by_embedding",
      "thoughtEmbeddings.by_embedding",
    ]);
    expect(await links(t)).toEqual([
      { fromId: id, toId: moved, score: 0.95, userId: A },
      { fromId: id, toId: legacyNear, score: 0.9, userId: A },
    ]);
    // New embeddings go to the table only, even now.
    expect(await embeddingOf(t, id)).toEqual({
      inline: undefined,
      rows: [{ userId: A, embedding: toward(1) }],
    });
  });

  it("weighs a thought once when both searches return it", async () => {
    const t = convexTest(schema, modules);
    await allow(t, A);
    const id = await embedded(t, A, "new", toward(1));
    // Moved between the two searches: the old index and the new both saw it.
    const moved = await embedded(t, A, "moved mid-search", toward(0.99));
    const movedRow = await t.run(async (ctx) => {
      await ctx.db.insert("connections", { fromId: moved, toId: id, score: 0.99, userId: A });
      const row = await ctx.db
        .query("thoughtEmbeddings")
        .withIndex("by_thought", (q) => q.eq("thoughtId", moved))
        .first();
      return row!._id;
    });
    // Five more already linked, so the seventh candidate is the first that can be.
    const linked = [];
    for (let i = 0; i < 5; i++) {
      const other = await embedded(t, A, `linked ${i}`, toward(0.9 - i / 100));
      await t.run((ctx) =>
        ctx.db.insert("connections", { fromId: id, toId: other, score: 0.9, userId: A }),
      );
      linked.push({ thoughtId: other, score: 0.9 - i / 100 });
    }
    const last = await embedded(t, A, "seventh", toward(0.6));

    await t.mutation(internal.store.enriched, {
      thoughtId: id,
      embedding: toward(1),
      neighbours: [
        { thoughtId: moved, score: 0.99 },
        { embeddingId: movedRow, score: 0.99 },
        ...linked,
        { thoughtId: last, score: 0.6 },
      ],
    });

    expect(await links(t)).toContainEqual({ fromId: id, toId: last, score: 0.6, userId: A });
  });

  it("moves a legacy thought's embedding when it is enriched again", async () => {
    const t = convexTest(schema, modules);
    backend = watchBackend();
    await allow(t, A);
    const near = await embedded(t, A, "near", toward(0.9), "inline");
    const id = await embedded(t, A, "legacy", toward(0.3), "inline");
    directions.set("legacy", toward(1));

    await t.action(internal.enrichment.enrich, { thoughtId: id });

    // In exactly one place, and it found its neighbour but not itself.
    expect(await embeddingOf(t, id)).toEqual({
      inline: undefined,
      rows: [{ userId: A, embedding: toward(1) }],
    });
    expect(await links(t)).toEqual([{ fromId: id, toId: near, score: 0.9, userId: A }]);
  });

  it("stops searching the old home once the backfill is done", async () => {
    const t = convexTest(schema, modules);
    await allow(t, A);
    const legacy = await embedded(t, A, "legacy", toward(0.9), "inline");
    await t.mutation(internal.migrations.backfillFastPaths, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    backend = watchBackend();

    const id = await capture(t, A, "new", toward(1));
    expect(backend.searches).toEqual(["thoughtEmbeddings.by_embedding"]);
    expect(await links(t)).toEqual([{ fromId: id, toId: legacy, score: 0.9, userId: A }]);
  });
});

describe("catching up after permission is given", () => {
  it.each([
    ["after the backfill", migratedDeployment, "table" as const],
    ["before the backfill", async () => convexTest(schema, modules), "inline" as const],
  ])("embeds what is missing in one request per page, %s", async (_, deployment, olderHome) => {
    const t = await deployment();
    backend = watchBackend();
    const inTable = await embedded(t, A, "embedded", toward(0.9));
    const older = await embedded(t, A, "embedded earlier", toward(0.8), olderHome);
    directions.set("first", toward(1));
    directions.set("second", toward(0.97));
    directions.set("alone", [0, 0, 1, 0]);
    const waiting: Id<"thoughts">[] = [];
    for (const text of ["first", "second", "alone"])
      waiting.push(await as(t, A).mutation(api.thoughts.capture, { text }));
    await as(t, B).mutation(api.thoughts.capture, { text: "not theirs to send" });

    await as(t, A).mutation(api.consent.setAiConnections, { allowed: true });
    const before = backend.transactions.length;
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // One action and one embedding request for the page, not one each;
    // then one write per thought.
    expect(await scheduled(t, "enrichment:enrichMany")).toBe(1);
    expect(await scheduled(t, "enrichment:enrich")).toBe(0);
    expect(embedMany).toHaveBeenCalledTimes(1);
    expect(embedMany.mock.calls[0][0].values).toEqual(["first", "second", "alone"]);
    expect(
      backend.transactions.slice(before).filter((txn) => txn.documentsWritten > 0),
    ).toHaveLength(3);

    for (const id of waiting) expect((await embeddingOf(t, id)).rows).toHaveLength(1);
    // Already-embedded thoughts are left exactly where they were.
    expect((await embeddingOf(t, inTable)).rows).toHaveLength(1);
    expect(await embeddingOf(t, older)).toEqual(
      olderHome === "inline"
        ? { inline: toward(0.8), rows: [] }
        : { inline: undefined, rows: [{ userId: A, embedding: toward(0.8) }] },
    );
    // Linked like any capture — including to each other, in page order:
    // the second finds the first, which was written just before it.
    const [first, second] = waiting;
    const pairs = (await links(t)).map((link) => `${link.fromId} -> ${link.toId}`);
    expect(pairs.sort()).toEqual(
      [
        `${first} -> ${inTable}`,
        `${first} -> ${older}`,
        `${second} -> ${inTable}`,
        `${second} -> ${first}`,
      ].sort(),
    );
  });
});

describe("the embedding backfill", () => {
  it("embeds only thoughts that have no embedding in either home", async () => {
    const t = convexTest(schema, modules);
    backend = watchBackend();
    await allow(t, A);
    await embedded(t, A, "in the table", toward(0.9));
    await embedded(t, A, "inline", toward(0.9), "inline");
    const bare = await t.run((ctx) =>
      ctx.db.insert("thoughts", { userId: A, text: "bare", createdAt: 1, status: "open" }),
    );
    await t.run((ctx) =>
      ctx.db.insert("thoughts", { userId: B, text: "no permission", createdAt: 1, status: "open" }),
    );
    directions.set("bare", toward(1));

    const result = await t.action(internal.enrichment.backfillEmbeddings, {});

    expect(result).toEqual({ embedded: 1, scheduledNextBatch: false });
    expect(embedMany.mock.calls[0][0].values).toEqual(["bare"]);
    expect((await embeddingOf(t, bare)).rows).toEqual([
      { userId: A, embedding: toward(1) },
    ]);
    // It stores; it does not link.
    expect(await links(t)).toEqual([]);
  });
});

// An enrich action already out at the API when this release deploys
// finishes on its old code and calls these three by name.
describe("the calls an in-flight enrichment still makes", () => {
  it("store the embedding in its new home and link with the same rules", async () => {
    const t = convexTest(schema, modules);
    const [from, to, other] = await t.run(async (ctx) => {
      const ids = [];
      for (const userId of [A, A, B])
        ids.push(
          await ctx.db.insert("thoughts", { userId, text: "t", createdAt: 1, status: "open" }),
        );
      return ids;
    });

    await t.mutation(internal.store.patchThoughtEmbedding, {
      thoughtId: from,
      embedding: toward(1),
    });
    expect(await embeddingOf(t, from)).toEqual({
      inline: undefined,
      rows: [{ userId: A, embedding: toward(1) }],
    });

    for (const toId of [to, to, other, from])
      await t.mutation(internal.store.insertConnection, { fromId: from, toId, score: 0.9 });
    await t.mutation(internal.store.insertConnection, { fromId: to, toId: from, score: 0.9 });
    expect(await links(t)).toEqual([{ fromId: from, toId: to, score: 0.9, userId: A }]);
    expect(await t.query(internal.store.linkedThoughtIds, { thoughtId: to })).toEqual([from]);
    expect((await t.query(internal.store.getThought, { thoughtId: from }))?._id).toBe(from);
  });
});
