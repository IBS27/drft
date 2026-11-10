// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { DAY, HOUR, modules, scheduled } from "./helpers";
import type { Setup } from "./helpers";

const A = "user_a";
const B = "user_b";
const NOW = Date.UTC(2026, 10, 2, 9, 0);
const CLIENT_ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF";

const as = (t: Setup, userId: string) =>
  t.withIdentity({ subject: userId, email: `${userId}@example.com` });

const thoughts = (t: Setup) => t.run((ctx) => ctx.db.query("thoughts").collect());

describe("capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a thought from a client that sends only its text, exactly as before", async () => {
    const t = convexTest(schema, modules);
    const id = await as(t, A).mutation(api.thoughts.capture, { text: "  a thought \n" });

    expect(await thoughts(t)).toEqual([
      {
        _id: id,
        _creationTime: expect.any(Number),
        userId: A,
        text: "a thought",
        createdAt: NOW,
        status: "open",
      },
    ]);
    // No permission yet: nothing is sent anywhere.
    expect(await scheduled(t, "enrichment:enrich")).toBe(0);
    await expect(as(t, A).mutation(api.thoughts.capture, { text: "  " })).rejects.toThrow(
      "Empty thought",
    );
    await expect(t.mutation(api.thoughts.capture, { text: "x" })).rejects.toThrow(
      "Not signed in",
    );
  });

  it("returns the thought already kept when a device sends the same capture again", async () => {
    const t = convexTest(schema, modules);
    await as(t, A).mutation(api.consent.setAiConnections, { allowed: true });
    const args = { text: "queued offline", clientId: CLIENT_ID, createdAt: NOW - HOUR };

    const first = await as(t, A).mutation(api.thoughts.capture, args);
    vi.setSystemTime(NOW + 5_000);
    const again = await as(t, A).mutation(api.thoughts.capture, args);
    // Even if the retry carries something else: the first send is the thought.
    const edited = await as(t, A).mutation(api.thoughts.capture, {
      ...args,
      text: "queued offline, retyped",
    });

    expect(again).toBe(first);
    expect(edited).toBe(first);
    const kept = await thoughts(t);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ text: "queued offline", clientId: CLIENT_ID });
    expect(await scheduled(t, "enrichment:enrich")).toBe(1);
  });

  it("scopes a capture's id to its user, and to that capture", async () => {
    const t = convexTest(schema, modules);
    const mine = await as(t, A).mutation(api.thoughts.capture, {
      text: "mine",
      clientId: CLIENT_ID,
    });
    const theirs = await as(t, B).mutation(api.thoughts.capture, {
      text: "theirs",
      clientId: CLIENT_ID,
    });
    const another = await as(t, A).mutation(api.thoughts.capture, {
      text: "another",
      clientId: "another-id",
    });
    // Captures without an id are never mistaken for one another.
    const plain = await as(t, A).mutation(api.thoughts.capture, { text: "mine" });
    const plainAgain = await as(t, A).mutation(api.thoughts.capture, { text: "mine" });

    expect(new Set([mine, theirs, another, plain, plainAgain]).size).toBe(5);
  });

  it("refuses an id that could not be a device's", async () => {
    const t = convexTest(schema, modules);
    for (const clientId of ["", "x".repeat(65)]) {
      await expect(
        as(t, A).mutation(api.thoughts.capture, { text: "t", clientId }),
      ).rejects.toThrow("Invalid clientId");
    }
    await as(t, A).mutation(api.thoughts.capture, { text: "t", clientId: "x".repeat(64) });
    expect(await thoughts(t)).toHaveLength(1);
  });

  it("dates an offline capture when it was had, never in the future", async () => {
    const t = convexTest(schema, modules);
    const capturedAt = async (createdAt: number) => {
      const id = await as(t, A).mutation(api.thoughts.capture, { text: "t", createdAt });
      return (await t.run((ctx) => ctx.db.get(id)))?.createdAt;
    };

    expect(await capturedAt(NOW - 4 * DAY)).toBe(NOW - 4 * DAY);
    expect(await capturedAt(NOW)).toBe(NOW);
    // A device clock running ahead.
    expect(await capturedAt(NOW + 1)).toBe(NOW);
    expect(await capturedAt(NOW + 30 * DAY)).toBe(NOW);
    // Not a time at all: the capture is still kept, dated now.
    for (const nonsense of [NaN, Infinity, -Infinity, -1, 0])
      expect(await capturedAt(nonsense)).toBe(NOW);
  });

  it("leaves nothing of a capture behind when the account is deleted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_secret");
    const t = convexTest(schema, modules);
    await as(t, A).mutation(api.thoughts.capture, { text: "t", clientId: CLIENT_ID });

    await as(t, A).action(api.account.deleteAccount, {});
    await expect(
      as(t, A).mutation(api.thoughts.capture, { text: "t", clientId: CLIENT_ID }),
    ).rejects.toThrow("Account is being deleted");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await thoughts(t)).toEqual([]);
    expect(await t.query(internal.account.clerkDeletionPending, { userId: A })).toBe(false);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
