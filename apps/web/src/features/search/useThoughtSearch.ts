import { useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

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

// A cheap local approximation of the index's word/prefix matching, for
// narrowing already-fetched hits while the authoritative answer is on
// the wire: every typed word must appear somewhere in the hit.
function localMatch(text: string, query: string) {
  const t = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => t.includes(word));
}

// The find contract, shared by both surfaces (the rail and the narrow
// sheet): every keystroke re-subscribes the reactive query, and while
// the new answer is in flight the previous one — tagged with the query
// it answered — is narrowed locally, so the list tightens at typing
// speed and the round trip only refines it. An interim list that
// narrows to nothing renders as null (blank), never as "nothing found":
// that verdict belongs to the server.
export function useThoughtSearch(query: string) {
  const trimmed = query.trim();
  const result = useQuery(
    api.search.thoughts,
    trimmed ? { query: trimmed } : "skip",
  );
  const [held, setHeld] = useState<{ query: string; hits: Hit[] } | null>(
    null,
  );
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
      setHeld(null);
    } else if (result !== undefined) {
      setHeld({ query: trimmed, hits: result });
      setActive((i) => Math.max(0, Math.min(i, result.length - 1)));
    }
  }, [trimmed, result]);

  const hits = useMemo(() => {
    if (!trimmed || !held) return null;
    if (held.query === trimmed) return held.hits;
    const interim = held.hits.filter((h) => localMatch(h.text, trimmed));
    return interim.length > 0 ? interim : null;
  }, [held, trimmed]);

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
