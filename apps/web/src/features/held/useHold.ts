import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { clearHoldNotice, showHoldNotice } from "./holdNotice";

// Same cut the server makes for a card's notes excerpt.
const NOTES_EXCERPT_LIMIT = 400;

// A hold lands everywhere the thought is on screen the moment it's made:
// the collection's rows (rail and list), the thought's own view, and the
// Held page, where letting go takes the card off the table at once.
function applyHold(
  store: OptimisticLocalStore,
  thoughtId: Id<"thoughts">,
  heldAt: number | undefined,
) {
  for (const { args, value } of store.getAllQueries(api.thoughts.collection)) {
    if (!value) continue;
    store.setQuery(api.thoughts.collection, args, {
      ...value,
      thoughts: value.thoughts.map((t) =>
        t._id === thoughtId ? { ...t, heldAt } : t,
      ),
    });
  }

  const view = store.getQuery(api.thoughts.view, { thoughtId });
  if (view) store.setQuery(api.thoughts.view, { thoughtId }, { ...view, heldAt });

  const cards = store.getQuery(api.thoughts.held, {});
  if (!cards) return;
  const existing = cards.find((card) => card._id === thoughtId);
  let next = cards
    .filter((card) => card._id !== thoughtId)
    .map((card) => ({
      ...card,
      links: card.links.filter((link) => link.otherId !== thoughtId),
    }));
  if (heldAt !== undefined) {
    // Its links to the rest of the table arrive with the server's answer.
    const card =
      existing ??
      (view && {
        _id: view._id,
        text: view.text,
        createdAt: view.createdAt,
        heldAt,
        notes: view.notes.slice(0, NOTES_EXCERPT_LIMIT),
        links: [],
      });
    if (card)
      next = [...next, { ...card, heldAt }].sort((a, b) => b.heldAt - a.heldAt);
  }
  store.setQuery(api.thoughts.held, {}, next);
}

export type ToggleHold = (
  thoughtId: Id<"thoughts">,
  heldAt: number | undefined,
  options?: { notice?: boolean },
) => void;

// Hold or let go, from anywhere. With `notice`, a strip confirms it and
// offers the way back (undoing a let-go restores the original hold time,
// so the thought keeps its age and place). Failures always say so.
// The returned function is stable, so memoized rows can take it.
export function useHold(): ToggleHold {
  const hold = useMutation(api.thoughts.hold).withOptimisticUpdate(
    (store, { thoughtId, since }) =>
      applyHold(store, thoughtId, since ?? Date.now()),
  );
  const letGo = useMutation(api.thoughts.letGo).withOptimisticUpdate(
    (store, { thoughtId }) => applyHold(store, thoughtId, undefined),
  );
  const latest = useRef({ hold, letGo });
  useEffect(() => {
    latest.current = { hold, letGo };
  });

  return useCallback((thoughtId, heldAt, { notice = false } = {}) => {
    const { hold, letGo } = latest.current;
    const fail = (text: string) => showHoldNotice(text, { failed: true });
    if (heldAt === undefined) {
      void hold({ thoughtId }).catch(() => fail("Couldn't hold it. Try again."));
      if (notice)
        showHoldNotice("Held.", {
          undo: () => {
            clearHoldNotice();
            void latest.current
              .letGo({ thoughtId })
              .catch(() => fail("Couldn't let go of it. Try again."));
          },
        });
    } else {
      void letGo({ thoughtId }).catch(() =>
        fail("Couldn't let go of it. Try again."),
      );
      if (notice)
        showHoldNotice("Let go.", {
          undo: () => {
            clearHoldNotice();
            void latest.current
              .hold({ thoughtId, since: heldAt })
              .catch(() => fail("Couldn't hold it. Try again."));
          },
        });
    }
  }, []);
}
