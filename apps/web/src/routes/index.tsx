import {
  ArrowBendUpLeft,
  BookmarkSimple,
  CaretRight,
  GearSix,
  MagnifyingGlass,
} from "@phosphor-icons/react";
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
import { SkeletonRows } from "../features/ui/Skeleton";
import { Wordmark } from "../features/ui/Wordmark";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/")({ component: Collection });

const NO_ROWS: Row[] = [];

// Header places on phones: quiet ghost controls with full 44px targets, so
// capture is the only framed thing at the top of the screen.
const HEADER_PILL =
  "inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[14.5px] font-medium text-ink transition-colors hover:bg-tint lg:hidden";

const HEADER_ICON =
  "flex size-11 items-center justify-center rounded-full text-pt transition-colors hover:bg-tint hover:text-ink lg:hidden [&>svg]:size-[19px]";

type Row = {
  _id: Id<"thoughts">;
  preview: string;
  createdAt: number;
  heldAt?: number;
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
      {/* Below lg the rail is gone, so the header carries the way to find
          and settings; on wide screens only the count stays up here, and
          the header lets clicks through to the rail it spans. */}
      <header className="relative z-10 flex h-14 items-center justify-between pr-2 pl-5 lg:pointer-events-none lg:h-8 lg:justify-end lg:pr-7">
        <span className="lg:hidden">
          <Wordmark />
        </span>
        <span className="flex items-center gap-0.5">
          {/* Held and Resting share the header on phones, by name, so
              capture sits right under it. */}
          <Link to="/held" className={HEADER_PILL}>
            Held
          </Link>
          <Link to="/resting" className={HEADER_PILL}>
            Resting
          </Link>
          <button
            type="button"
            onClick={openSearch}
            aria-label="Find a thought"
            className={HEADER_ICON}
          >
            <MagnifyingGlass aria-hidden="true" />
          </button>
          <Link to="/settings" aria-label="Settings" className={HEADER_ICON}>
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
              ? "flex flex-col items-center px-5 pt-3 pb-2 sm:px-6 sm:pt-8 lg:flex-1 lg:justify-start lg:px-10 lg:pt-0 lg:pb-24"
              : "flex flex-1 flex-col items-center justify-center px-4 pb-24 sm:px-6"
          }
        >
          <CaptureField now={now} />
          {pinned && (
            <div data-capture className="mt-6 hidden w-full max-w-[608px] lg:block">
              <BackToday t={pinned} prewarm={prewarm} wide />
            </div>
          )}
        </section>

        {hasList && (
          <section className="mx-auto w-full max-w-2xl flex-1 px-1 pt-4 pb-10 sm:px-6 lg:hidden">
            {loading ? (
              <SkeletonRows heading count={5} />
            ) : (
              <>
                {pinned && <BackToday t={pinned} prewarm={prewarm} />}
                {groups.map(({ group, rows }) => (
                  <div key={group}>
                    <h2 className="px-4 pt-7 pb-0.5 text-[13px] font-medium text-pl">
                      {GROUP_LABEL[group]}
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

      </div>
    </main>
  );
}


// Today's returned thought, held apart above the groups.
function BackToday({
  t,
  prewarm,
  wide = false,
}: {
  t: Row;
  prewarm: (thoughtId: Id<"thoughts">) => void;
  wide?: boolean;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      className={`group/back flex items-center rounded-[14px] bg-(--back-wash) ring-1 ring-(--back-edge) ring-inset transition-colors hover:bg-tint ${
        wide ? "gap-4 px-10 py-4" : "mx-4 mb-1 gap-3 px-4 py-3.5 sm:mx-0"
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-dot-ink">
          <ArrowBendUpLeft aria-hidden="true" className="text-[14px]" />
          <span className="sr-only">returned today: </span>
          <span aria-hidden="true">Back today</span>
        </span>
        <span
          className={`line-clamp-2 text-ink ${wide ? "text-[17px] leading-[1.45] tracking-[-0.005em]" : "text-[15px] leading-[1.45]"}`}
        >
          {t.preview}
        </span>
      </span>
      <CaretRight
        aria-hidden="true"
        className="flex-none text-[15px] text-dot-ink/60 transition-transform group-hover/back:translate-x-0.5"
      />
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
      className={`flex items-baseline gap-5 rounded-card px-4 py-3.5 text-[16px] text-ink transition-colors hover:bg-tint [--inset:16px] ${
        divided ? "divided" : ""
      }`}
    >
      <span className="line-clamp-2 min-w-0 flex-1 leading-[1.4] text-pretty">{t.preview}</span>
      <span className="inline-flex min-w-[4.5rem] flex-none items-baseline justify-end gap-1 text-[13px] text-pl tabular-nums">
        {t.heldAt !== undefined && (
          <BookmarkSimple weight="fill" aria-label="held" className="translate-y-[1px] text-[10px] text-faint" />
        )}
        {ageLabel(t.createdAt, now)}
      </span>
    </Link>
  );
});
