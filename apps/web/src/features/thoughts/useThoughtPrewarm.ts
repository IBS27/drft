import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useConvex } from "convex/react";
import { useCallback, useRef } from "react";

const PREWARM_FOR_MS = 30_000;
const REPEAT_AFTER_MS = 5_000;

// How much of the conversation the thought view holds at once.
export const CONVERSATION_PAGE_SIZE = 40;

// The newest page of a conversation, addressed by fixed arguments.
// `usePaginatedQuery` stamps a per-hook counter into `paginationOpts.id`, so
// its own first page is a subscription nothing can share — a prewarm can
// never hit it. This plain read of the same page can be prewarmed, so the
// words are already in the client when the route mounts; the view uses it
// until the paginated hook takes over (see routes/thought.$thoughtId.tsx).
export const conversationPageArgs = (thoughtId: Id<"thoughts">) => ({
  thoughtId,
  paginationOpts: { numItems: CONVERSATION_PAGE_SIZE, cursor: null },
});

// Hover, focus, and keyboard intent should start the next thought's queries
// before navigation. Convex deduplicates these temporary subscriptions with
// the real ones if the user follows through.
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
      // The margin is half the thought: warm the words that were said too,
      // or they arrive a round trip after the page does.
      convex.prewarmQuery({
        query: api.thoughts.conversation,
        args: conversationPageArgs(thoughtId),
        extendSubscriptionFor: PREWARM_FOR_MS,
      });
    },
    [convex],
  );
}
