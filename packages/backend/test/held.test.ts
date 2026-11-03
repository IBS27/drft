// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const A = "user_a";
const B = "user_b";
const DATE = "2026-11-02";

type Setup = ReturnType<typeof convexTest>;

async function thoughts(t: Setup, userId: string, count: number) {
  return await t.run(async (ctx) => {
    const ids: Id<"thoughts">[] = [];
    for (let i = 0; i < count; i++)
      ids.push(
        await ctx.db.insert("thoughts", {
          userId,
          text: `${userId} thought ${i}\nsecond line`,
          createdAt: 1_000 + i,
          status: "open",
        }),
      );
    return ids;
  });
}

describe("hold and let go", () => {
  it("holds, shows the hold on the collection and the view, and lets go", async () => {
    const t = convexTest(schema, modules);
    const [id] = await thoughts(t, A, 1);
    const asA = t.withIdentity({ subject: A });

    await asA.mutation(api.thoughts.hold, { thoughtId: id });
    const view = await asA.query(api.thoughts.view, { thoughtId: id });
    expect(view?.heldAt).toBeTypeOf("number");
    const { thoughts: rows } = await asA.query(api.thoughts.collection, { date: DATE });
    expect(rows[0].heldAt).toBe(view?.heldAt);

    await asA.mutation(api.thoughts.letGo, { thoughtId: id });
    expect((await asA.query(api.thoughts.view, { thoughtId: id }))?.heldAt).toBeUndefined();
    expect(await asA.query(api.thoughts.held, {})).toEqual([]);
  });

  it("keeps the original time when held twice", async () => {
    const t = convexTest(schema, modules);
    const [id] = await thoughts(t, A, 1);
    const asA = t.withIdentity({ subject: A });
    await asA.mutation(api.thoughts.hold, { thoughtId: id, since: 5_000 });
    await asA.mutation(api.thoughts.hold, { thoughtId: id });
    expect((await asA.query(api.thoughts.view, { thoughtId: id }))?.heldAt).toBe(5_000);
  });

  it("restores an undone hold's time, but never one before capture or in the future", async () => {
    const t = convexTest(schema, modules);
    const [a, b] = await thoughts(t, A, 2);
    const asA = t.withIdentity({ subject: A });
    await asA.mutation(api.thoughts.hold, { thoughtId: a, since: 10 });
    await asA.mutation(api.thoughts.hold, { thoughtId: b, since: Date.now() + 60_000 });
    const heldA = (await asA.query(api.thoughts.view, { thoughtId: a }))?.heldAt ?? 0;
    const heldB = (await asA.query(api.thoughts.view, { thoughtId: b }))?.heldAt ?? 0;
    expect(heldA).toBeGreaterThan(10);
    expect(heldB).toBeLessThanOrEqual(Date.now());
  });

  it("can't hold a resting thought, and resting lets go", async () => {
    const t = convexTest(schema, modules);
    const [id] = await thoughts(t, A, 1);
    const asA = t.withIdentity({ subject: A });
    await asA.mutation(api.thoughts.hold, { thoughtId: id });
    await asA.mutation(api.thoughts.rest, { thoughtId: id });
    expect((await asA.query(api.thoughts.view, { thoughtId: id }))?.heldAt).toBeUndefined();
    await expect(asA.mutation(api.thoughts.hold, { thoughtId: id })).rejects.toThrow();

    await asA.mutation(api.thoughts.wake, { thoughtId: id });
    expect((await asA.query(api.thoughts.view, { thoughtId: id }))?.heldAt).toBeUndefined();
  });

  it("never touches someone else's thought", async () => {
    const t = convexTest(schema, modules);
    const [theirs] = await thoughts(t, B, 1);
    const asA = t.withIdentity({ subject: A });
    await expect(asA.mutation(api.thoughts.hold, { thoughtId: theirs })).rejects.toThrow();
    await t.withIdentity({ subject: B }).mutation(api.thoughts.hold, { thoughtId: theirs });
    await expect(asA.mutation(api.thoughts.letGo, { thoughtId: theirs })).rejects.toThrow();
    expect(await asA.query(api.thoughts.held, {})).toEqual([]);
  });
});

describe("held", () => {
  it("is empty when signed out", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.thoughts.held, {})).toEqual([]);
  });

  it("lists held thoughts newest hold first, in full, with a notes excerpt", async () => {
    const t = convexTest(schema, modules);
    const [a, b, c] = await thoughts(t, A, 3);
    const asA = t.withIdentity({ subject: A });
    await asA.mutation(api.thoughts.hold, { thoughtId: a, since: 2_000 });
    await asA.mutation(api.thoughts.hold, { thoughtId: c, since: 3_000 });
    await asA.mutation(api.thoughts.setNotes, { thoughtId: c, text: "n".repeat(1_000) });

    const cards = await asA.query(api.thoughts.held, {});
    expect(cards.map((card) => card._id)).toEqual([c, a]);
    expect(cards[0].text).toBe("user_a thought 2\nsecond line");
    expect(cards[0].notes).toHaveLength(400);
    expect(cards[1].notes).toBe("");
    expect(cards.some((card) => card._id === b)).toBe(false);
  });

  it("links only to other held thoughts, both directions, skipping dismissed links", async () => {
    const t = convexTest(schema, modules);
    const [a, b, c, d] = await thoughts(t, A, 4);
    await t.run(async (ctx) => {
      await ctx.db.insert("connections", { fromId: a, toId: b, score: 0.8 });
      await ctx.db.insert("connections", { fromId: c, toId: a, score: 0.9 });
      // not held
      await ctx.db.insert("connections", { fromId: a, toId: d, score: 0.95 });
      // dismissed
      await ctx.db.insert("connections", {
        fromId: b,
        toId: c,
        score: 0.7,
        dismissedAt: 1,
      });
    });
    const asA = t.withIdentity({ subject: A });
    for (const id of [a, b, c]) await asA.mutation(api.thoughts.hold, { thoughtId: id });

    const cards = await asA.query(api.thoughts.held, {});
    const linksOf = (id: Id<"thoughts">) =>
      cards.find((card) => card._id === id)?.links;
    expect(linksOf(a)).toEqual([
      { otherId: c, score: 0.9 },
      { otherId: b, score: 0.8 },
    ]);
    expect(linksOf(b)).toEqual([{ otherId: a, score: 0.8 }]);
    expect(linksOf(c)).toEqual([{ otherId: a, score: 0.9 }]);
  });
});
