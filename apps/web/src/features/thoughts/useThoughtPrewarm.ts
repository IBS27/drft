import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { useCallback, useRef } from "react";

const PREWARM_FOR_MS = 30_000;
const REPEAT_AFTER_MS = 5_000;

// Hover, focus, and keyboard intent should start the next thought's query
// before navigation. Convex deduplicates the temporary subscription with
// the real one if the user follows through.
export function useThoughtPrewarm() {
  const convex = useConvex();
  const lastPrewarm = useRef(new Map<Id<"thoughts">, number>());

  return useCallback(
    (thoughtId: Id<"thoughts">) => {
      const now = Date.now();
      const previous = lastPrewarm.current.get(thoughtId) ?? 0;
      if (now - previous < REPEAT_AFTER_MS) return;
      lastPrewarm.current.set(thoughtId, now);
      convex.prewarmQuery({
        query: api.thoughts.view,
        args: { thoughtId },
        extendSubscriptionFor: PREWARM_FOR_MS,
      });
    },
    [convex],
  );
}
