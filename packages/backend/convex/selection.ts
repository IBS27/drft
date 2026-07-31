// The return loop's arithmetic, kept pure so it can be tested directly
// (test/selection.test.ts); resurfacing.ts reads the rows and this
// decides. See docs/experience.html §03.

import { RESURFACE_COOLDOWN_DAYS, RESURFACE_MIN_AGE_DAYS } from "./ai/limits";

const DAY = 86_400_000;

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
      now - t.createdAt >= RESURFACE_MIN_AGE_DAYS * DAY &&
      now - (lastReturned.get(t._id) ?? -Infinity) >=
        RESURFACE_COOLDOWN_DAYS * DAY,
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const lastA = lastReturned.get(a._id) ?? 0;
    const lastB = lastReturned.get(b._id) ?? 0;
    return lastA - lastB || a.createdAt - b.createdAt;
  });
  return eligible[0]._id;
}

// A user's wall clock, without a timezone library: Intl formats the
// current instant into their zone.
export function localParts(timezone: string, now: number) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const [hour, minute] = clock.split(":").map(Number);
  return { date, minutesOfDay: hour * 60 + minute };
}

export function sendMinutes(sendTime: string): number {
  const [hour, minute] = sendTime.split(":").map(Number);
  return hour * 60 + minute;
}
