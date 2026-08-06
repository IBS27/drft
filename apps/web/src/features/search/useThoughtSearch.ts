import { useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useEffect, useState, type KeyboardEvent } from "react";

export type Hit = {
  _id: Id<"thoughts">;
  text: string;
  status: "open" | "resting";
  createdAt: number;
};

// The steering input keeps focus, so it points at the active row by
// id: FindResults gives each option this name under the caller's
// listbox id, and the input's aria-activedescendant repeats it.
export function hitOptionId(listboxId: string, index: number) {
  return `${listboxId}-${index}`;
}

// The find contract, shared by both surfaces (the rail and the narrow
// sheet): every keystroke re-subscribes the reactive query — the search
// index answers fast enough that no debounce is needed — and the last
// hits stay on screen for the beat until the new ones land, so the list
// never blinks empty mid-word.
export function useThoughtSearch(query: string) {
  const trimmed = query.trim();
  const result = useQuery(
    api.search.thoughts,
    trimmed ? { query: trimmed } : "skip",
  );
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);

  // The highlight restarts only when the *query* changes; a reactive
  // push for the same query (a capture landing from another device)
  // must not yank it off the row the arrows chose — just keep it in
  // range if the list shrank.
  useEffect(() => {
    setActive(0);
  }, [trimmed]);

  useEffect(() => {
    if (!trimmed) {
      setHits(null);
    } else if (result !== undefined) {
      setHits(result);
      setActive((i) => Math.max(0, Math.min(i, result.length - 1)));
    }
  }, [trimmed, result]);

  // Both surfaces steer the hits identically, so the input's list keys
  // live here too: arrows clamp inside the list (staying at 0 while it
  // is empty) and Enter hands the active hit to the caller. An Enter
  // that commits IME composition isn't a choice.
  const onResultsKey = (e: KeyboardEvent, go: (hit: Hit) => void) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const last = (hits?.length ?? 0) - 1;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(i + step, last)));
    } else if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      hits &&
      hits[active]
    ) {
      go(hits[active]);
    }
  };

  return { hits, active, setActive, onResultsKey };
}
