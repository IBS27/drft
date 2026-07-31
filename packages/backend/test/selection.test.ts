import { describe, expect, it } from "vitest";
import {
  localParts,
  selectThoughtId,
  sendMinutes,
} from "../convex/selection";
import {
  RESURFACE_COOLDOWN_DAYS,
  RESURFACE_MIN_AGE_DAYS,
} from "../convex/ai/limits";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

const thought = (_id: string, ageDays: number) => ({
  _id,
  createdAt: NOW - ageDays * DAY,
});

const returned = (entries: Record<string, number>) =>
  new Map(Object.entries(entries).map(([id, days]) => [id, NOW - days * DAY]));

describe("selectThoughtId", () => {
  it("returns null when the collection is empty", () => {
    expect(selectThoughtId([], new Map(), NOW)).toBeNull();
  });

  it("never picks a fresh thought", () => {
    const open = [thought("fresh", RESURFACE_MIN_AGE_DAYS - 1)];
    expect(selectThoughtId(open, new Map(), NOW)).toBeNull();
  });

  it("picks a thought exactly at the minimum age", () => {
    const open = [thought("aged", RESURFACE_MIN_AGE_DAYS)];
    expect(selectThoughtId(open, new Map(), NOW)).toBe("aged");
  });

  it("prefers never-resurfaced over ever-resurfaced", () => {
    const open = [thought("seen", 200), thought("unseen", 10)];
    const last = returned({ seen: RESURFACE_COOLDOWN_DAYS + 5 });
    expect(selectThoughtId(open, last, NOW)).toBe("unseen");
  });

  it("skips thoughts inside the cooldown", () => {
    const open = [thought("recent", 200), thought("older", 200)];
    const last = returned({
      recent: RESURFACE_COOLDOWN_DAYS - 1,
      older: RESURFACE_COOLDOWN_DAYS + 10,
    });
    expect(selectThoughtId(open, last, NOW)).toBe("older");
  });

  it("goes silent when everything is cooling down", () => {
    const open = [thought("a", 200)];
    const last = returned({ a: 1 });
    expect(selectThoughtId(open, last, NOW)).toBeNull();
  });

  it("among returned thoughts, takes the one that returned longest ago", () => {
    const open = [thought("a", 300), thought("b", 300)];
    const last = returned({
      a: RESURFACE_COOLDOWN_DAYS + 2,
      b: RESURFACE_COOLDOWN_DAYS + 40,
    });
    expect(selectThoughtId(open, last, NOW)).toBe("b");
  });

  it("breaks ties by oldest capture", () => {
    const open = [thought("newer", 10), thought("oldest", 20)];
    expect(selectThoughtId(open, new Map(), NOW)).toBe("oldest");
  });

  it("does not mutate the caller's array", () => {
    const open = [thought("a", 10), thought("b", 20)];
    const copy = [...open];
    selectThoughtId(open, new Map(), NOW);
    expect(open).toEqual(copy);
  });
});

describe("localParts", () => {
  it("renders a UTC instant into a zone's wall clock", () => {
    // 2026-07-31 12:00 UTC is 08:00 in New York (EDT, UTC-4).
    const parts = localParts("America/New_York", NOW);
    expect(parts).toEqual({ date: "2026-07-31", minutesOfDay: 8 * 60 });
  });

  it("crosses the date line correctly", () => {
    // 12:00 UTC is already the next-day 00:00 in Auckland (UTC+12).
    const parts = localParts("Pacific/Auckland", NOW);
    expect(parts).toEqual({ date: "2026-08-01", minutesOfDay: 0 });
  });
});

describe("sendMinutes", () => {
  it("parses HH:MM into minutes of day", () => {
    expect(sendMinutes("08:00")).toBe(480);
    expect(sendMinutes("23:59")).toBe(1439);
    expect(sendMinutes("00:00")).toBe(0);
  });
});
