import { Moon } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { ageLabel, firstLine } from "../thoughts/format";
import { hitOptionId, type Hit } from "./useThoughtSearch";

// The words you typed, picked out where they occur in a hit.
function highlight(text: string, query: string): ReactNode {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return text;
  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent font-medium text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

// Hits wear the collection's own row clothes (first line, age, the same
// tinted highlight) so finding never looks like a different place, only
// the collection answering to fewer names. Resting thoughts carry a small
// moon.
export function FindResults({
  query,
  hits,
  active,
  setActive,
  now,
  go,
  prewarm,
  listboxId,
}: {
  query: string;
  hits: Hit[] | null;
  active: number;
  setActive: (i: number) => void;
  now: number;
  go: (hit: Hit) => void;
  prewarm: (thoughtId: Id<"thoughts">) => void;
  // The input steering these rows stays focused, so it announces the
  // active one by id: this names the listbox, and `${listboxId}-${i}`
  // names each option (see hitOptionId).
  listboxId: string;
}) {
  if (hits && hits.length === 0) return <Note text="Nothing found" />;
  if (!hits) return null;
  return (
    <div role="listbox" id={listboxId} aria-label="search results">
      <p className="px-3 pt-1 pb-1.5 text-[12.5px] text-pl" aria-hidden="true">
        Best matches
      </p>
      {hits.map((h, i) => (
        <HitRow
          key={h._id}
          id={hitOptionId(listboxId, i)}
          hit={h}
          query={query}
          active={i === active}
          now={now}
          go={go}
          prewarm={prewarm}
          activate={() => setActive(i)}
        />
      ))}
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="px-3 py-2.5 text-[14px] text-pl">
      {text}
    </p>
  );
}

function HitRow({
  id,
  hit,
  query,
  active,
  now,
  go,
  prewarm,
  activate,
}: {
  id: string;
  hit: Hit;
  query: string;
  active: boolean;
  now: number;
  go: (hit: Hit) => void;
  prewarm: (thoughtId: Id<"thoughts">) => void;
  activate: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      type="button"
      onClick={() => go(hit)}
      onPointerEnter={() => prewarm(hit._id)}
      onFocus={() => prewarm(hit._id)}
      onMouseMove={activate}
      className={`relative flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left transition-colors ${
        active
          ? "bg-line/45 ring-1 ring-line ring-inset [@media(hover:none)]:bg-transparent [@media(hover:none)]:ring-0"
          : ""
      }`}
    >
      <span
        className={`line-clamp-2 min-w-0 flex-1 text-[15px] leading-[1.4] ${active ? "text-ink" : "text-pt"}`}
      >
        {highlight(firstLine(hit.text), query)}
      </span>
      {hit.status === "resting" && (
        <Moon aria-label="set down" className="flex-none text-[13px] text-pl" />
      )}
      <span
        className="flex-none text-[12.5px] text-pl tabular-nums"
      >
        {ageLabel(hit.createdAt, now)}
      </span>
    </button>
  );
}
