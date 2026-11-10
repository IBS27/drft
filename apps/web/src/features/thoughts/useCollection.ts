import { api } from "@drft/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo } from "react";
import { readCached, useCacheOwner, writeCached } from "./useCachedQuery";

type Collection = FunctionReturnType<typeof api.thoughts.collection>;

// The collection is asked for by day (the day decides which thought is back
// today), but it is remembered under one name: the rows are the same rows
// tomorrow, and the first visit of a day — the one the morning email
// brings — should open on them rather than on placeholders.
const NAME = "collection";
type Kept = { date: string; answer: Collection };

// Earlier builds kept a copy per day and never let go of any. Reclaim them;
// this can go once those browsers have all been back.
try {
  const stale: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && /^drft:query:v1:.*:collection:\d{4}-\d{2}-\d{2}$/.test(key))
      stale.push(key);
  }
  for (const key of stale) window.localStorage.removeItem(key);
} catch {
  // Nothing stored, nothing to reclaim.
}

// The open thoughts and which of them is back today, with the last answer
// while the live one is on its way (see useCachedQuery). An answer kept on
// another day still paints its rows; only what belonged to that day, the
// returned thought, waits for the live answer.
export function useCollection(date: string): Collection | undefined {
  const { isAuthenticated } = useConvexAuth();
  const { readAs, writeAs } = useCacheOwner();
  const live = useQuery(
    api.thoughts.collection,
    isAuthenticated ? { date } : "skip",
  );
  const cached = useMemo(() => {
    const kept = readAs ? readCached<Kept>(readAs, NAME) : undefined;
    if (!kept) return undefined;
    return kept.date === date
      ? kept.answer
      : { ...kept.answer, resurfacedId: null };
  }, [readAs, date]);
  useEffect(() => {
    if (live !== undefined && writeAs)
      writeCached(writeAs, NAME, { date, answer: live } satisfies Kept);
  }, [live, date, writeAs]);
  return live !== undefined ? live : cached;
}
