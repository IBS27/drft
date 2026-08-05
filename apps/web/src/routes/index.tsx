import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { memo, useEffect, useMemo, useState } from "react";
import { openSearch } from "../features/search/openSearch";
import { CaptureField } from "../features/thoughts/CaptureField";
import { Rail } from "../features/thoughts/Rail";
import { ageLabel, localDate, orderRows } from "../features/thoughts/format";
import { useCachedQuery } from "../features/thoughts/useCachedQuery";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { SkeletonRows } from "../features/ui/Skeleton";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/")({ component: Collection });

const NO_ROWS: Row[] = [];

type Row = {
  _id: Id<"thoughts">;
  preview: string;
  createdAt: number;
  waiting: boolean;
};

// One room: on wide screens the collection lives in the edge rail and
// capture sits alone at the center; narrower, capture at the top with
// the collection stacked below — today / this week / earlier, first
// line verbatim, nothing more.
function Collection() {
  // Epoch milliseconds, not a Date: a primitive keeps the every-30s tick
  // from invalidating the memo of every row it passes through.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const { isAuthenticated } = useConvexAuth();
  const date = useMemo(() => localDate(now), [now]);
  const data = useCachedQuery(
    api.thoughts.collection,
    isAuthenticated ? { date } : "skip",
    `collection:${date}`,
  );
  const resting = useCachedQuery(
    api.thoughts.resting,
    isAuthenticated ? {} : "skip",
    "resting",
  );

  // One prewarm cache for the whole list, not one per row.
  const prewarm = useThoughtPrewarm();

  const loading = data === undefined;
  const thoughts: Row[] = data?.thoughts ?? NO_ROWS;
  const { pinned, groups } = useMemo(
    () => orderRows(thoughts, data?.resurfacedId ?? null, now),
    [thoughts, data?.resurfacedId, now],
  );

  // While the collection is on its way, assume it has rows: capture keeps
  // its place at the top and the skeletons hold the list's, so the page
  // settles without moving under you.
  const hasList = loading || thoughts.length > 0;

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="relative z-10 flex items-baseline justify-between px-8 pt-7">
        <Link
          to="/settings"
          className="text-[11px] tracking-[0.26em] text-pl uppercase transition-colors hover:text-ink lg:hidden"
        >
          settings
        </Link>
        <span className="hidden lg:block" aria-hidden="true" />
        <span className="pointer-events-none absolute right-0 left-0 text-center text-[12px] tracking-[0.5em] text-pt uppercase lg:left-72 xl:left-80">
          drft
        </span>
        <span className="flex items-baseline gap-6">
          <button
            type="button"
            onClick={openSearch}
            className="text-[11px] tracking-[0.26em] text-pl uppercase transition-colors hover:text-ink lg:hidden"
          >
            find
          </button>
          <span className="text-[12px] tracking-[0.1em] text-pl tabular-nums">
            {thoughts.length || ""}
          </span>
        </span>
      </header>

      <Rail activeId={null} now={now} />

      <div className="flex flex-1 flex-col lg:pl-72 xl:pl-80">
        {/* Capture is the first thing on screen, before any query answers:
            the field is focused and typeable at 0ms. */}
        <section
          className={
            hasList
              ? "flex flex-col items-center px-6 pt-20 pb-6 lg:flex-1 lg:justify-center lg:pt-0 lg:pb-24"
              : "flex flex-1 flex-col items-center justify-center px-6 pb-24"
          }
        >
          <CaptureField now={now} />
        </section>

        {hasList && (
          <section className="mx-auto w-full max-w-2xl flex-1 px-6 pt-12 pb-10 lg:hidden">
            {loading ? (
              <SkeletonRows heading count={5} />
            ) : (
              <>
                {pinned && (
                  <div className="mb-12">
                    <ThoughtRow t={pinned} now={now} prewarm={prewarm} />
                  </div>
                )}
                {groups.map(({ group, rows }, i) => (
                  <div key={group}>
                    <h2
                      className={`${i === 0 ? "pt-0" : "pt-10"} pb-2 text-[10.5px] tracking-[0.34em] text-pl uppercase`}
                    >
                      {group}
                    </h2>
                    {rows.map((t) => (
                      <ThoughtRow key={t._id} t={t} now={now} prewarm={prewarm} />
                    ))}
                  </div>
                ))}
              </>
            )}
          </section>
        )}

        {resting && resting.length > 0 && (
          <footer className="flex items-center justify-center pb-10 lg:hidden">
            <Link
              to="/resting"
              className="text-[10.5px] tracking-[0.34em] text-pl uppercase transition-colors hover:text-ink"
            >
              resting
            </Link>
          </footer>
        )}
      </div>
    </main>
  );
}

// Memoized so the tick redraws only what the clock actually moves: the
// age at the end of each row.
const ThoughtRow = memo(function ThoughtRow({
  t,
  now,
  prewarm,
}: {
  t: Row;
  now: number;
  prewarm: (thoughtId: Id<"thoughts">) => void;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      className="group flex items-center gap-3.5 border-b border-line py-4"
    >
      {t.waiting && <span className="size-2 flex-none rounded-full bg-dot" />}
      <span
        className={`flex-1 truncate text-[16px] font-normal transition-colors group-hover:text-ink ${
          t.waiting ? "text-ink" : "text-pt"
        }`}
      >
        {t.preview}
      </span>
      <span className="flex-none text-[12px] tracking-[0.08em] text-pl tabular-nums">
        {ageLabel(t.createdAt, now)}
      </span>
    </Link>
  );
});
