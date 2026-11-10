// The return loop's arithmetic, kept pure so it can be tested directly
// (test/selection.test.ts); resurfacing.ts reads the rows and this
// decides. See docs/experience.html §03.

import { RESURFACE_COOLDOWN_DAYS, RESURFACE_MIN_AGE_DAYS } from "./ai/limits";

const MINUTE = 60_000;
const DAY = 86_400_000;

export const MIN_AGE_MS = RESURFACE_MIN_AGE_DAYS * DAY;
export const COOLDOWN_MS = RESURFACE_COOLDOWN_DAYS * DAY;

// How far behind the server's clock a capture's own timestamp may be and
// still count as "just now". A capture that says it is older than this was
// made offline and sat on the device; it may already be old enough to come
// back, so it moves the user's next return check up (thoughts.capture).
// The check after a silent day is never scheduled further out than a
// capture this late could need (resurfacing.ts) — which is what lets every
// ordinary capture skip that bookkeeping.
export const CAPTURE_LAG_MS = 3_600_000;

// Skip the fresh, skip the recently returned, then take whichever open
// thought has waited longest: never-resurfaced before ever-resurfaced,
// oldest return before recent, oldest capture as the tiebreak.
export function selectThoughtId<Id extends string>(
  open: ReadonlyArray<{ _id: Id; createdAt: number }>,
  lastReturned: ReadonlyMap<string, number>,
  now: number,
): Id | null {
  const eligible = open.filter(
    (t) =>
      now - t.createdAt >= MIN_AGE_MS &&
      now - (lastReturned.get(t._id) ?? -Infinity) >= COOLDOWN_MS,
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const lastA = lastReturned.get(a._id) ?? 0;
    const lastB = lastReturned.get(b._id) ?? 0;
    return lastA - lastB || a.createdAt - b.createdAt;
  });
  return eligible[0]._id;
}

// The first moment an open thought may come back: old enough, and out of
// its cooldown if it has returned before.
export function eligibleAt(createdAt: number, lastReturnedAt?: number): number {
  return Math.max(
    createdAt + MIN_AGE_MS,
    (lastReturnedAt ?? -Infinity) + COOLDOWN_MS,
  );
}

// When the first of these thoughts becomes eligible; Infinity if there are
// none. With nothing eligible today, this is how long the silence lasts.
export function earliestEligibleAt(
  open: ReadonlyArray<{ _id: string; createdAt: number }>,
  lastReturned: ReadonlyMap<string, number>,
): number {
  return open.reduce(
    (earliest, t) =>
      Math.min(earliest, eligibleAt(t.createdAt, lastReturned.get(t._id))),
    Infinity,
  );
}

// Building a formatter costs far more than using one, and the return loop
// asks for the same few zones again and again.
const formatters = new Map<string, Intl.DateTimeFormat>();

// A user's wall clock, without a timezone library: Intl formats the
// instant into their zone. `wall` is that reading as if it were UTC, so
// two readings can be subtracted.
function wallClock(timezone: string, at: number) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  const part: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(at)) part[type] = value;
  const date = `${part.year}-${part.month}-${part.day}`;
  const minutesOfDay = Number(part.hour) * 60 + Number(part.minute);
  return { date, minutesOfDay, wall: Date.parse(date) + minutesOfDay * MINUTE };
}

export function localParts(timezone: string, now: number) {
  const { date, minutesOfDay } = wallClock(timezone, now);
  return { date, minutesOfDay };
}

export function sendMinutes(sendTime: string): number {
  const [hour, minute] = sendTime.split(":").map(Number);
  return hour * 60 + minute;
}

// The local date after `date` (YYYY-MM-DD).
export function nextDate(date: string): string {
  return new Date(Date.parse(date) + DAY).toISOString().slice(0, 10);
}

// The first instant the zone's clock reads `minutes` past midnight on
// `date`. A zone has one offset on either side of a clock change, so the
// answer is the wall time under one of the two offsets around that day —
// the earlier one when the hour repeats (clocks go back). When the hour
// is skipped (clocks go forward over it) no instant reads that time; the
// result is then up to the skipped hour early, never late. Callers treat
// it as "look again from here", not as the moment itself.
export function localInstant(
  timezone: string,
  date: string,
  minutes: number,
): number {
  const wall = Date.parse(date) + minutes * MINUTE;
  const candidates = [wall - DAY, wall + DAY].map(
    (probe) => wall - (wallClock(timezone, probe).wall - probe),
  );
  const exact = candidates.filter(
    (at) => wallClock(timezone, at).wall === wall,
  );
  return Math.min(...(exact.length > 0 ? exact : candidates));
}
