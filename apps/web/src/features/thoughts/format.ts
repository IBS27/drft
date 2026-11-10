// Time, the way the collection speaks it: today "9:41", this week "tue",
// earlier "8 jul". All grouping is in the viewer's local timezone.

// "Now" travels through the app as epoch milliseconds — a primitive keeps
// the 30s tick from invalidating every memo it passes through.
type Now = number;

const dayStart = (d: Date, daysBack = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();

export const localDate = (now: Now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Formatters are kept: a list asks for a label per row, and building one
// costs far more than using it. A formatter holds the timezone it was made
// in, so a tab left open while the clock's zone changes makes new ones —
// otherwise labels would speak one zone while the grouping above (plain
// Date arithmetic) follows the other.
function build() {
  return {
    offset: new Date().getTimezoneOffset(),
    clock: new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }),
    weekdayShort: new Intl.DateTimeFormat("en-US", { weekday: "short" }),
    weekdayLong: new Intl.DateTimeFormat("en-US", { weekday: "long" }),
    monthShort: new Intl.DateTimeFormat("en-US", { month: "short" }),
  };
}
let built = build();
function formatters() {
  if (built.offset !== new Date().getTimezoneOffset()) built = build();
  return built;
}

// hour cycle follows the viewer's locale — "9:41" or "9:41 am" alike;
// lowercase like the rest of the shorthand ("tue", "8 jul").
const time = (d: Date) => formatters().clock.format(d).toLowerCase();

export type Group = "today" | "this week" | "earlier";
export const GROUPS: Group[] = ["today", "this week", "earlier"];
// How a group is titled on screen.
export const GROUP_LABEL: Record<Group, string> = {
  today: "Today",
  "this week": "This week",
  earlier: "Earlier",
};

export function groupOf(at: number, now: Now): Group {
  const n = new Date(now);
  if (at >= dayStart(n)) return "today";
  if (at >= dayStart(n, 6)) return "this week";
  return "earlier";
}

export function ageLabel(at: number, now: Now): string {
  const n = new Date(now);
  const d = new Date(at);
  const group = groupOf(at, now);
  if (group === "today") return time(d);
  if (group === "this week") return formatters().weekdayShort.format(d);
  const dayMonth = `${d.getDate()} ${formatters().monthShort.format(d)}`;
  return d.getFullYear() === n.getFullYear()
    ? dayMonth
    : `${dayMonth} ${String(d.getFullYear()).slice(2)}`;
}

// When a thought last came back, in words: "today", "Thursday", "23 Jul".
export function returnedLabel(at: number, now: Now): string {
  const group = groupOf(at, now);
  if (group === "today") return "today";
  if (group === "this week") return formatters().weekdayLong.format(new Date(at));
  return ageLabel(at, now);
}

// The thought view's header, in the composer's form: "Tuesday · 9:41 am",
// or "8 Jul · 9:41 am" once the weekday alone would be ambiguous ("8 Jul 25"
// from another year). Lists keep ageLabel's shorthand.
export function dateLine(at: number, now: Now): string {
  const d = new Date(at);
  let day: string;
  if (groupOf(at, now) === "earlier") {
    day = `${d.getDate()} ${formatters().monthShort.format(d)}`;
    if (d.getFullYear() !== new Date(now).getFullYear())
      day += ` ${String(d.getFullYear()).slice(2)}`;
  } else {
    day = formatters().weekdayLong.format(d);
  }
  return `${day} · ${time(d)}`;
}

export const firstLine = (text: string) => text.split("\n")[0];

// What a list row shows of a thought — the same rule the server applies
// when it builds `preview`, so an optimistic row matches the real one.
export const PREVIEW_LIMIT = 160;

export const previewOf = (text: string) =>
  (text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "")
    .trim()
    .slice(0, PREVIEW_LIMIT);

// One ordering everywhere the collection renders (the page, the rail):
// today's returned thought pinned first, held apart, then the groups.
export function orderRows<T extends { _id: string; createdAt: number }>(
  rows: T[],
  resurfacedId: string | null,
  now: Now,
): { pinned: T | null; groups: { group: Group; rows: T[] }[] } {
  const pinned = rows.find((t) => t._id === resurfacedId) ?? null;
  const rest = rows.filter((t) => t._id !== resurfacedId);
  const groups = GROUPS.map((group) => ({
    group,
    rows: rest.filter((t) => groupOf(t.createdAt, now) === group),
  })).filter(({ rows }) => rows.length > 0);
  return { pinned, groups };
}

// How long a thought has been held, counted in the viewer's days: "held
// 3d" on a card, "Held 3 days" on the thought's own chip.
export function heldAge(heldAt: number, now: Now): { short: string; long: string } {
  const days = Math.round(
    (dayStart(new Date(now)) - dayStart(new Date(heldAt))) / 86_400_000,
  );
  const unit = (n: number, short: string, word: string) => ({
    short: `${n}${short}`,
    long: `${n} ${word}${n === 1 ? "" : "s"}`,
  });
  if (days <= 0) return { short: "today", long: "today" };
  if (days < 7) return unit(days, "d", "day");
  if (days < 30) return unit(Math.floor(days / 7), "w", "week");
  if (days < 365) return unit(Math.floor(days / 30), "mo", "month");
  return unit(Math.floor(days / 365), "y", "year");
}

// The start of a text, cut at a word and never after a stop, so the
// ellipsis is the only mark at the end ("Tuesday…", not "Tuesday.…").
export function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const word = cut.slice(0, Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n")));
  return `${word.replace(/[\s.,;:!?—–-]+$/, "")}…`;
}
