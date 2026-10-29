// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const A = "user_a";
const B = "user_b";

type Setup = ReturnType<typeof convexTest>;

// A user with everything the product stores: open and resting thoughts,
// connections both ways (one dismissed), a note, resurfacings, settings.
async function seedUser(t: Setup, userId: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"thoughts">[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(
        await ctx.db.insert("thoughts", {
          userId,
          text: `${userId} thought ${i}`,
          createdAt: now - i,
          status: i === 2 ? "resting" : "open",
        }),
      );
    await ctx.db.insert("connections", { fromId: ids[0], toId: ids[1], score: 0.8 });
    await ctx.db.insert("connections", {
      fromId: ids[2],
      toId: ids[0],
      score: 0.7,
      dismissedAt: now,
    });
    await ctx.db.insert("notes", { thoughtId: ids[0], text: "a note", updatedAt: now });
    await ctx.db.insert("resurfacings", {
      thoughtId: ids[1],
      date: "2026-10-27",
      userId,
      deliveredAt: now,
    });
    await ctx.db.insert("settings", {
      userId,
      email: `${userId}@example.com`,
      sendTime: "08:00",
      timezone: "UTC",
    });
    return ids;
  });
}

async function counts(t: Setup) {
  return await t.run(async (ctx) => ({
    thoughts: (await ctx.db.query("thoughts").collect()).length,
    connections: (await ctx.db.query("connections").collect()).length,
    notes: (await ctx.db.query("notes").collect()).length,
    resurfacings: (await ctx.db.query("resurfacings").collect()).length,
    settings: (await ctx.db.query("settings").collect()).length,
    accountDeletions: (await ctx.db.query("accountDeletions").collect()).length,
  }));
}

describe("account deletion", () => {
  let clerkStatus = 200;
  // Which instance the secret key's JWKS reports; the issuer serves "ours".
  let keyInstanceKid = "ours";
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://api.clerk.com/v1/jwks")
      return Response.json({ keys: [{ kid: keyInstanceKid }] });
    if (url.endsWith("/.well-known/jwks.json"))
      return Response.json({ keys: [{ kid: "ours" }] });
    return new Response("{}", { status: clerkStatus });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clerkStatus = 200;
    keyInstanceKid = "ours";
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_secret");
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://example.clerk.accounts.dev");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("removes the Clerk user and every row of the account, and only that account", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, A);
    await seedUser(t, B);

    await t.withIdentity({ subject: A }).action(api.account.deleteAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.clerk.com/v1/users/${A}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    // B's data is intact; nothing of A remains, tombstone included.
    expect(await counts(t)).toEqual({
      thoughts: 3,
      connections: 2,
      notes: 1,
      resurfacings: 1,
      settings: 1,
      accountDeletions: 0,
    });
    const remaining = await t.run((ctx) => ctx.db.query("thoughts").collect());
    expect(remaining.every((r) => r.userId === B)).toBe(true);
  });

  it("purges large accounts across several transactions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 250; i++)
        await ctx.db.insert("thoughts", {
          userId: A,
          text: `t${i}`,
          createdAt: i,
          status: "open",
        });
    });
    await t.withIdentity({ subject: A }).action(api.account.deleteAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await counts(t)).thoughts).toBe(0);
  });

  it("refuses new writes while the deletion is in progress", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, A);
    await t.mutation(internal.account.request, { userId: A });

    const asA = t.withIdentity({ subject: A, email: "a@example.com" });
    await expect(asA.mutation(api.thoughts.capture, { text: "late" })).rejects.toThrow(
      "Account is being deleted",
    );
    await expect(
      asA.mutation(api.settings.save, { sendTime: "09:00", timezone: "UTC" }),
    ).rejects.toThrow("Account is being deleted");
    // The per-load call stays quiet and writes nothing.
    await asA.mutation(api.settings.ensure, { timezone: "UTC" });
    expect((await counts(t)).settings).toBe(0);
  });

  it("never links an enrichment result to a thought that is gone", async () => {
    const t = convexTest(schema, modules);
    const [first, second] = await seedUser(t, A);
    await t.run((ctx) => ctx.db.delete(second));
    await t.mutation(internal.store.insertConnection, {
      fromId: first,
      toId: second,
      score: 0.9,
    });
    const links = await t.run((ctx) =>
      ctx.db
        .query("connections")
        .withIndex("by_from", (q) => q.eq("fromId", first))
        .collect(),
    );
    expect(links.some((c) => c.toId === second)).toBe(true); // only the seeded one
    expect(links).toHaveLength(1);
  });

  it("treats the request as final when Clerk fails, purging and retrying on its own", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, A);
    clerkStatus = 500;

    await t.withIdentity({ subject: A }).action(api.account.deleteAccount, {});

    // Clerk recovers before the first scheduled retry.
    clerkStatus = 200;
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counts(t)).toEqual({
      thoughts: 0,
      connections: 0,
      notes: 0,
      resurfacings: 0,
      settings: 0,
      accountDeletions: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts a 404 as already deleted only from the instance that signs our tokens", async () => {
    const t = convexTest(schema, modules);
    clerkStatus = 404;
    keyInstanceKid = "another-instance";
    await t.withIdentity({ subject: A }).action(api.account.deleteAccount, {});
    const pending = await t.run((ctx) => ctx.db.query("accountDeletions").first());
    expect(pending?.clerkDeletedAt).toBeUndefined();

    keyInstanceKid = "ours";
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await counts(t)).accountDeletions).toBe(0);
  });
});
