import { describe, expect, it } from "vitest";
import {
  earliestEligibleAt,
  eligibleAt,
  localInstant,
  localParts,
  nextDate,
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

describe("eligibleAt", () => {
  it("is the first moment selectThoughtId would take the thought", () => {
    const cases: [string, number, number | undefined][] = [
      ["never returned", NOW - 2 * DAY, undefined],
      ["cooling down", NOW - 200 * DAY, NOW - 12 * DAY],
      ["returned while young", NOW - 2 * DAY, NOW - 29 * DAY],
    ];
    for (const [id, createdAt, last] of cases) {
      const open = [{ _id: id, createdAt }];
      const lastReturned = new Map(last === undefined ? [] : [[id, last]]);
      const moment = eligibleAt(createdAt, last);
      expect(selectThoughtId(open, lastReturned, moment - 1)).toBeNull();
      expect(selectThoughtId(open, lastReturned, moment)).toBe(id);
      expect(earliestEligibleAt(open, lastReturned)).toBe(moment);
    }
  });

  it("has no moment for an empty collection", () => {
    expect(earliestEligibleAt([], new Map())).toBe(Infinity);
  });
});

describe("nextDate", () => {
  it("steps over month and year ends", () => {
    expect(nextDate("2026-07-31")).toBe("2026-08-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
    expect(nextDate("2028-02-28")).toBe("2028-02-29");
  });
});

describe("localInstant", () => {
  const MINUTE = 60_000;

  it("finds a wall time in a zone", () => {
    // 08:30 in New York on 31 July (EDT, UTC-4) is 12:30 UTC.
    expect(localInstant("America/New_York", "2026-07-31", 8 * 60 + 30)).toBe(
      Date.UTC(2026, 6, 31, 12, 30),
    );
    expect(localInstant("Asia/Kolkata", "2026-07-31", 0)).toBe(
      Date.UTC(2026, 6, 30, 18, 30),
    );
  });

  it("uses the offset in force at that time on a day the clocks change", () => {
    // 1 Nov 2026, New York: 02:00 EDT becomes 01:00 EST.
    expect(localInstant("America/New_York", "2026-11-01", 0)).toBe(
      Date.UTC(2026, 10, 1, 4, 0),
    );
    expect(localInstant("America/New_York", "2026-11-01", 8 * 60)).toBe(
      Date.UTC(2026, 10, 1, 13, 0),
    );
    // 01:30 happens twice; the first is the one that counts.
    expect(localInstant("America/New_York", "2026-11-01", 90)).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    );
  });

  it("is early, never late, for a time the clocks skip", () => {
    // 8 Mar 2026, New York: 02:00 EST jumps to 03:00 EDT at 07:00 UTC.
    const skipped = localInstant("America/New_York", "2026-03-08", 2 * 60 + 30);
    expect(skipped).toBeLessThanOrEqual(Date.UTC(2026, 2, 8, 7, 0));
    expect(skipped).toBeGreaterThanOrEqual(Date.UTC(2026, 2, 8, 6, 0));
    expect(localInstant("America/New_York", "2026-03-08", 3 * 60)).toBe(
      Date.UTC(2026, 2, 8, 7, 0),
    );
  });

  it("is the first minute the clock reads at least that time, in any zone on any day", () => {
    const zones = [
      "UTC",
      "America/New_York",
      "America/St_Johns",
      "Europe/London",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Australia/Lord_Howe",
      "Pacific/Auckland",
      "Pacific/Kiritimati",
      "Pacific/Niue",
    ];
    // The loop's question at a tick: has today's time come?
    const due = (zone: string, date: string, minutes: number, instant: number) => {
      const parts = localParts(zone, instant);
      return parts.date > date || (parts.date === date && parts.minutesOfDay >= minutes);
    };
    for (const zone of zones) {
      for (let day = 0; day < 366; day += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
        for (const minutes of [0, 90, 150, 8 * 60, 23 * 60 + 45]) {
          const instant = localInstant(zone, date, minutes);
          const context = `${zone} ${date} ${minutes}`;
          // Never late: the minute before is not yet due.
          expect(due(zone, date, minutes, instant - MINUTE), context).toBe(false);
          // Exact, unless the clocks skip that time (then within the hour).
          if (!due(zone, date, minutes, instant)) {
            expect(due(zone, date, minutes, instant + 60 * MINUTE), context).toBe(true);
          }
        }
      }
    }
  });
});
