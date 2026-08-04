import { useEffect, useRef } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { ageLabel, firstLine } from "../thoughts/format";
import { hitOptionId, type Hit } from "./useThoughtSearch";

// Hits wear the collection's own row clothes — dot, first line, age —
// so finding never looks like a different place, only the collection
// answering to fewer names. Resting thoughts say so, quietly.
export function FindResults({
  hits,
  failed,
  active,
  setActive,
  now,
  go,
  prewarm,
  listboxId,
}: {
  hits: Hit[] | null;
  failed: boolean;
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
  if (failed) return <Note text="couldn't search — try again" />;
  if (hits && hits.length === 0) return <Note text="nothing found" />;
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
    <p className="py-2.5 text-[10.5px] tracking-[0.3em] text-pl uppercase">
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
      className={`-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors ${
        active ? "bg-pg" : ""
      }`}
    >
      <span
        className={`size-1.5 flex-none rounded-full ${active ? "bg-dot" : "bg-transparent"}`}
      />
      <span
        className={`min-w-0 flex-1 truncate text-[15px] font-normal ${
          active ? "text-ink" : "text-pt"
        }`}
      >
        {hit.status === "resting" && <span className="text-pl">set down · </span>}
        {firstLine(hit.text)}
      </span>
      <span className="flex-none text-[11px] tracking-[0.08em] text-pl tabular-nums">
        {ageLabel(hit.createdAt, now)}
      </span>
    </button>
  );
}
