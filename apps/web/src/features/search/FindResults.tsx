import { useEffect, useRef } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { ageLabel, firstLine } from "../thoughts/format";
import { hitOptionId, type Hit } from "./useThoughtSearch";

// Hits wear the collection's own row clothes (first line, age, the same
// tinted highlight) so finding never looks like a different place, only
// the collection answering to fewer names. Resting thoughts carry a small
// "Set down" tag.
export function FindResults({
  hits,
  active,
  setActive,
  now,
  go,
  prewarm,
  listboxId,
}: {
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
      {hits.map((h, i) => (
        <HitRow
          key={h._id}
          id={hitOptionId(listboxId, i)}
          hit={h}
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
  active,
  now,
  go,
  prewarm,
  activate,
}: {
  id: string;
  hit: Hit;
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
      className={`flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left transition-colors ${
        active ? "bg-tint-2" : ""
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[15px] ${active ? "text-ink" : "text-pt"}`}
      >
        {firstLine(hit.text)}
      </span>
      {hit.status === "resting" && (
        <span className="inline-flex h-[22px] flex-none items-center rounded-full px-[9px] text-[12px] text-pt ring-1 ring-line ring-inset">
          Set down
        </span>
      )}
      <span
        className={`flex-none text-[12.5px] tabular-nums ${active ? "text-dot-ink" : "text-pl"}`}
      >
        {ageLabel(hit.createdAt, now)}
      </span>
    </button>
  );
}
