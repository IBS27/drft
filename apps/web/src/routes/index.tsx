import { ArrowBendUpLeft, GearSix, MagnifyingGlass, Moon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { memo, useEffect, useMemo, useState } from "react";
import { openSearch } from "../features/search/openSearch";
import { CaptureField } from "../features/thoughts/CaptureField";
import { Rail } from "../features/thoughts/Rail";
import { ageLabel, localDate, orderRows, GROUP_LABEL } from "../features/thoughts/format";
import { useCachedQuery } from "../features/thoughts/useCachedQuery";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { Badge } from "../features/ui/Badge";
import { SkeletonRows } from "../features/ui/Skeleton";
import { Wordmark } from "../features/ui/Wordmark";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/")({ component: Collection });

const NO_ROWS: Row[] = [];

type Row = {
  _id: Id<"thoughts">;
  preview: string;
  createdAt: number;
};

// One room: on wide screens the collection lives in the edge rail and
// capture sits alone at the center; narrower, capture at the top with
// the collection stacked below: today's returned thought, then today /
// this week / earlier, first line verbatim.
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

  const count = thoughts.length;

  return (
    <main className="flex min-h-dvh flex-col">
      {/* Below lg the rail is gone, so the header carries the way to find
          and settings; on wide screens only the count stays up here, and
          the header lets clicks through to the rail it spans. */}
      <header className="relative z-10 flex h-14 items-center justify-between pr-3.5 pl-[22px] lg:pointer-events-none lg:h-[72px] lg:justify-end lg:pr-7">
        <span className="lg:hidden">
          <Wordmark />
        </span>
        <span className="flex items-center gap-0.5">
          {count > 0 && (
            <span className="mr-1.5 lg:mr-0">
              <Badge size="md">
                {count} {count === 1 ? "thought" : "thoughts"}
              </Badge>
            </span>
          )}
          <button
            type="button"
            onClick={openSearch}
            aria-label="Find a thought"
            className="flex size-9 items-center justify-center rounded-full text-[18px] text-pt transition-colors hover:bg-tint hover:text-ink lg:hidden"
          >
            <MagnifyingGlass aria-hidden="true" />
          </button>
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex size-9 items-center justify-center rounded-full text-[18px] text-pt transition-colors hover:bg-tint hover:text-ink lg:hidden"
          >
            <GearSix aria-hidden="true" />
          </Link>
        </span>
      </header>

      <Rail activeId={null} now={now} />

      <div className="flex flex-1 flex-col lg:pl-72 xl:pl-80">
        {/* Capture is the first thing on screen, before any query answers:
            the field is focused and typeable at 0ms. */}
        <section
          className={
            hasList
              ? "flex flex-col items-center px-6 pt-12 pb-6 lg:flex-1 lg:justify-center lg:pt-0 lg:pb-24"
              : "flex flex-1 flex-col items-center justify-center px-6 pb-24"
          }
        >
          <CaptureField now={now} />
        </section>

        {hasList && (
          <section className="mx-auto w-full max-w-2xl flex-1 px-3.5 pt-8 pb-10 lg:hidden">
            {loading ? (
              <SkeletonRows heading count={5} />
            ) : (
              <>
                {pinned && <BackToday t={pinned} prewarm={prewarm} />}
                {groups.map(({ group, rows }) => (
                  <div key={group}>
                    <h2 className="flex items-center gap-2 px-2.5 pt-[18px] pb-1 text-[13px] font-medium text-pt">
                      {GROUP_LABEL[group]}
                      <Badge>{rows.length}</Badge>
                    </h2>
                    {rows.map((t, i) => (
                      <ThoughtRow
                        key={t._id}
                        t={t}
                        now={now}
                        divided={i > 0}
                        prewarm={prewarm}
                      />
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
              className="inline-flex h-10 items-center gap-2 rounded-full px-[18px] text-[14.5px] font-medium text-pt ring-1 ring-line ring-inset transition-colors hover:bg-tint hover:text-ink"
            >
              <Moon aria-hidden="true" className="text-[16px]" />
              Resting thoughts
            </Link>
          </footer>
        )}
      </div>
    </main>
  );
}


// Today's returned thought, held apart above the groups.
function BackToday({
  t,
  prewarm,
}: {
  t: Row;
  prewarm: (thoughtId: Id<"thoughts">) => void;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      className="mb-1 flex flex-col gap-[5px] rounded-card bg-tint px-3.5 py-3 transition-colors hover:bg-tint-2"
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-dot-ink">
        <ArrowBendUpLeft aria-hidden="true" className="text-[14px]" />
        <span className="sr-only">returned today: </span>
        <span aria-hidden="true">Back today</span>
      </span>
      <span className="line-clamp-2 text-[15px] leading-[1.45] text-ink">{t.preview}</span>
    </Link>
  );
}

// Memoized so the tick redraws only what the clock actually moves: the
// age at the end of each row. Rows after the first in a group are parted
// by a hairline, which steps aside on either edge of a hovered row.
const ThoughtRow = memo(function ThoughtRow({
  t,
  now,
  divided,
  prewarm,
}: {
  t: Row;
  now: number;
  divided: boolean;
  prewarm: (thoughtId: Id<"thoughts">) => void;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      className={`flex items-baseline gap-3 rounded-card px-2.5 py-3.5 text-[16px] text-ink transition-colors hover:bg-tint ${
        divided ? "shadow-[0_-1px_0_var(--line)] hover:shadow-none! [a:hover+&]:shadow-none!" : ""
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{t.preview}</span>
      <span className="flex-none text-[13px] text-pl tabular-nums">
        {ageLabel(t.createdAt, now)}
      </span>
    </Link>
  );
});
