import { useAction } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";

export type Hit = {
  _id: Id<"thoughts">;
  text: string;
  status: "open" | "resting";
  createdAt: number;
};

// The find contract, shared by both surfaces (the rail and the narrow
// sheet): debounce the query, keep stale hits on screen while a newer
// search is in flight, and let a late response of an old query fall on
// the floor.
export function useThoughtSearch(query: string) {
  const search = useAction(api.search.thoughts);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    // Every query change — clearing included — outdates whatever is in
    // flight, so a late response can't repopulate a cleared field.
    const mine = ++seq.current;
    const trimmed = query.trim();
    setFailed(false);
    if (!trimmed) {
      setHits(null);
      return;
    }
    const id = window.setTimeout(() => {
      search({ query: trimmed })
        .then((rows) => {
          if (seq.current !== mine) return;
          setHits(rows);
          setActive(0);
        })
        .catch(() => {
          if (seq.current === mine) setFailed(true);
        });
    }, 250);
    return () => window.clearTimeout(id);
  }, [query, search]);

  return { hits, failed, active, setActive };
}
