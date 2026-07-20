// Time, the way the collection speaks it: today "9:41", this week "tue",
// earlier "8 jul". All grouping is in the viewer's local timezone.

const dayStart = (d: Date, daysBack = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();

export const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const time = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });

export type Group = "today" | "this week" | "earlier";
export const GROUPS: Group[] = ["today", "this week", "earlier"];

export function groupOf(at: number, now: Date): Group {
  if (at >= dayStart(now)) return "today";
  if (at >= dayStart(now, 6)) return "this week";
  return "earlier";
}

export function ageLabel(at: number, now: Date): string {
  const d = new Date(at);
  const group = groupOf(at, now);
  if (group === "today") return time(d);
  if (group === "this week")
    return d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const dayMonth = `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" }).toLowerCase()}`;
  return d.getFullYear() === now.getFullYear()
    ? dayMonth
    : `${dayMonth} ${String(d.getFullYear()).slice(2)}`;
}

// The thought view's header: "tuesday · 9:41", or "8 jul · 9:41" once
// the weekday alone would be ambiguous.
export function dateLine(at: number, now: Date): string {
  const d = new Date(at);
  const day =
    groupOf(at, now) === "earlier"
      ? ageLabel(at, now)
      : d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  return `${day} · ${time(d)}`;
}

export const firstLine = (text: string) => text.split("\n")[0];
