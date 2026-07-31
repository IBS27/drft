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

const time = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });

export type Group = "today" | "this week" | "earlier";
export const GROUPS: Group[] = ["today", "this week", "earlier"];

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
  if (group === "this week")
    return d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const dayMonth = `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" }).toLowerCase()}`;
  return d.getFullYear() === n.getFullYear()
    ? dayMonth
    : `${dayMonth} ${String(d.getFullYear()).slice(2)}`;
}

// The thought view's header: "tuesday · 9:41", or "8 jul · 9:41" once
// the weekday alone would be ambiguous.
export function dateLine(at: number, now: Now): string {
  const d = new Date(at);
  const day =
    groupOf(at, now) === "earlier"
      ? ageLabel(at, now)
      : d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
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
