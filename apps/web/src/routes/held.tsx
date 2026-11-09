import { BookmarkSimple } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { HeldCardView, type CardState } from "../features/held/HeldCardView";
import {
  groupTogether,
  type HeldCard,
  type HeldMode,
} from "../features/held/layout";
import { useHold } from "../features/held/useHold";
import { useCachedQuery } from "../features/thoughts/useCachedQuery";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { PageHeader } from "../features/ui/PageHeader";
import { Skeleton } from "../features/ui/Skeleton";

export const Route = createFileRoute("/held")({ component: Held });

const MODE_KEY = "drft:held:mode";

function readMode(): HeldMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "together" ? "together" : "recent";
  } catch {
    return "recent";
  }
}

// The thoughts you're holding close, laid out like index cards on a table
// (docs/held.html#layout): all of them at once, so you compare instead of
// opening them one by one. The rail stays beside it, as on every page.
function Held() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { isAuthenticated } = useConvexAuth();
  const cards = useCachedQuery(
    api.thoughts.held,
    isAuthenticated ? {} : "skip",
    "held",
  );
  const [mode, setModeState] = useState<HeldMode>(readMode);
  const setMode = (next: HeldMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // Remembering the view is a convenience; it can be denied.
    }
  };

  return (
    <main className="min-h-dvh">
      <div className="flex min-h-dvh flex-col lg:pl-72 xl:pl-80">
        <PageHeader
          title="Held"
          description="Thoughts you're keeping close."
          aside={cards && cards.length > 0 && <ModeSwitch mode={mode} setMode={setMode} />}
        />
        <section
          aria-busy={cards === undefined}
          className="mx-auto flex w-full max-w-[688px] flex-1 flex-col px-5 pt-1 pb-16 md:px-10 lg:pt-0"
        >
          {cards === undefined ? (
            <BoardSkeleton />
          ) : cards.length === 0 ? (
            <EmptyHeld />
          ) : (
            <Board cards={cards} mode={mode} now={now} />
          )}
        </section>
      </div>
    </main>
  );
}

// Nothing held yet: say what the page is for and how a thought gets here.
function EmptyHeld() {
  return (
    <div className="flex flex-col items-start pt-10 pb-24 text-left">
      <span className="flex size-12 items-center justify-center rounded-full bg-line/70 text-[22px] text-pt">
        <BookmarkSimple aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-[19px] font-medium tracking-[-0.01em] text-ink">
        Nothing held yet
      </h2>
      <p className="mt-2 max-w-[32ch] text-[15px] leading-relaxed text-balance text-pl">
        Hold a thought from its page<span className="[@media(hover:none)]:hidden"> (or press h)</span>{" "}
        to keep it close here.
      </p>
      <Link
        to="/"
        className="mt-5 text-[14px] font-medium text-pt underline decoration-line underline-offset-4 transition-colors hover:text-ink lg:hidden"
      >
        Back to thoughts
      </Link>
    </div>
  );
}

function ModeSwitch({
  mode,
  setMode,
}: {
  mode: HeldMode;
  setMode: (mode: HeldMode) => void;
}) {
  const option = (value: HeldMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={`relative h-7 rounded-full px-3 text-[13px] transition-colors before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] ${
        mode === value
          ? "bg-line/70 font-medium text-ink"
          : "text-pl hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
  return (
    <span
      role="group"
      aria-label="Order"
      className="inline-flex rounded-full p-[3px] ring-1 ring-line ring-inset"
    >
      {option("recent", "Recent")}
      {option("together", "By connection")}
    </span>
  );
}

function Board({
  cards,
  mode,
  now,
}: {
  cards: HeldCard[];
  mode: HeldMode;
  now: number;
}) {
  const toggle = useHold();
  const prewarm = useThoughtPrewarm();
  const [focusId, setFocusId] = useState<Id<"thoughts"> | null>(null);
  const onFocusCard = useCallback((id: Id<"thoughts"> | null) => setFocusId(id), []);

  // Links only count where both ends are on the table.
  const linkCount = useMemo(() => {
    const ids = new Set<string>(cards.map((card) => card._id));
    return new Map(
      cards.map((card) => [
        card._id,
        card.links.filter((link) => ids.has(link.otherId)).length,
      ]),
    );
  }, [cards]);

  const focused = focusId ? cards.find((card) => card._id === focusId) : undefined;
  const related = useMemo(
    () => new Set<string>(focused?.links.map((link) => link.otherId) ?? []),
    [focused],
  );
  const stateOf = (id: Id<"thoughts">): CardState => {
    if (!focused || (linkCount.get(focused._id) ?? 0) === 0) return "rest";
    if (id === focused._id) return "focus";
    return related.has(id) ? "related" : "dim";
  };

  const render = (card: HeldCard) => (
    <HeldCardView
      key={card._id}
      card={card}
      links={linkCount.get(card._id) ?? 0}
      now={now}
      state={stateOf(card._id)}
      onFocusCard={onFocusCard}
      toggle={toggle}
      prewarm={prewarm}
    />
  );

  // One column, like Resting and Related: each card is as tall as its
  // words, and nothing is left ragged beside it.
  return (
    <div className="flex w-full flex-col border-t border-line">
      {mode === "recent" ? cards.map(render) : <Together cards={cards} render={render} />}
    </div>
  );
}

function Together({
  cards,
  render,
}: {
  cards: HeldCard[];
  render: (card: HeldCard) => ReactNode;
}) {
  const { groups, loose } = useMemo(() => groupTogether(cards), [cards]);
  return (
    <div className="flex flex-col">
      {groups.map((group, i) => (
        <div
          key={group[0]._id}
          className={`flex flex-col ${i > 0 ? "mt-6 border-t border-line" : ""}`}
        >
          {group.map(render)}
        </div>
      ))}
      {loose.length > 0 && (
        <div className={groups.length > 0 ? "mt-6 border-t border-line pt-3" : ""}>
          <h2 className="pb-2.5 text-[13px] font-medium text-pl">
            {groups.length > 0 ? "Not near the others yet" : "None of these are related yet"}
          </h2>
          <div className="flex flex-col">
            {loose.map(render)}
          </div>
        </div>
      )}
    </div>
  );
}

// The table before its cards arrive: a few cards' worth of quiet lines.
function BoardSkeleton() {
  return (
    <div role="status" aria-label="loading held thoughts" className="flex flex-col gap-3">
      {["w-[82%]", "w-[64%]", "w-[74%]"].map((width) => (
        <div key={width} className="flex flex-col gap-3 rounded-card bg-scr px-4 py-4 ring-1 ring-line ring-inset">
          <Skeleton className={`h-[10px] ${width}`} />
          <Skeleton className="h-[10px] w-[46%]" />
          <Skeleton className="mt-3 h-[8px] w-12" />
        </div>
      ))}
    </div>
  );
}
