import {
  ArrowBendUpLeft,
  CaretDown,
  GearSix,
  Graph,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { FindResults } from "../search/FindResults";
import {
  hitOptionId,
  useThoughtSearch,
  type Hit,
} from "../search/useThoughtSearch";
import { Badge } from "../ui/Badge";
import { Kbd } from "../ui/Kbd";
import { Skeleton } from "../ui/Skeleton";
import { Wordmark } from "../ui/Wordmark";
import { ageLabel, localDate, orderRows, type Group, GROUP_LABEL } from "./format";
import { useCachedQuery } from "./useCachedQuery";
import { useThoughtPrewarm } from "./useThoughtPrewarm";

type RailThought = {
  _id: Id<"thoughts">;
  preview: string;
  createdAt: number;
};

// The edge rail (docs/vivid.html#ember): the collection stays in the
// periphery while you sit with one thought, and at home too, where the
// main area holds only capture. Today's returned thought sits on top as a
// tinted "Back today" strip; the open thought is held by a deeper tint and
// a vermilion bar.
// Also owns the collection's keyboard: j/k move between thoughts (j enters
// the top from home), Esc returns to the door.
export const Rail = memo(function Rail({
  activeId,
  now,
}: {
  activeId: Id<"thoughts"> | null;
  now: number;
}) {
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
  const [restingOpen, setRestingOpen] = useState(false);
  const navigate = useNavigate();
  const prewarm = useThoughtPrewarm();

  // Find never leaves the rail: the button becomes the input in place,
  // and while a query stands the collection below answers with hits
  // instead of its groups. Esc (or ⌘K again) puts everything back.
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { hits, active, setActive, onResultsKey } = useThoughtSearch(query);
  const listboxId = useId();
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setQuery("");
  }, []);
  const prepareNavigation = useCallback(
    (thoughtId: Id<"thoughts">) => {
      if (activeId) prewarm(activeId);
      prewarm(thoughtId);
    },
    [activeId, prewarm],
  );
  const goHit = useCallback(
    (hit: Hit) => {
      prepareNavigation(hit._id);
      closeFind();
      void navigate({ to: "/thought/$thoughtId", params: { thoughtId: hit._id } });
    },
    [prepareNavigation, closeFind, navigate],
  );

  // ⌘K toggles find, "/" opens it from anywhere outside a field — only
  // while the rail is on screen; narrower, the sheet takes these keys
  // (features/search/FindSheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia("(min-width: 64rem)").matches) return;
      // A sheet left open across a resize owns the keys until it closes.
      if (document.querySelector("[data-overlay]") !== null) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setQuery("");
        setFindOpen((o) => !o);
      } else if (
        e.key === "/" &&
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ordered = useMemo(() => {
    if (!data) return { pinned: null, groups: [] };
    return orderRows<RailThought>(data.thoughts, data.resurfacedId, now);
  }, [data, now]);

  const flat = useMemo(
    () => [
      ...(ordered.pinned ? [ordered.pinned._id] : []),
      ...ordered.groups.flatMap(({ rows }) => rows.map((t) => t._id)),
      // Resting thoughts sit in the rail too, so the keyboard reaches
      // them: j walks off the collection's end into the resting list, and
      // k from a resting thought climbs back out. (Landing on one opens
      // the collapsed section — see activeResting below.)
      ...(resting?.map((t) => t._id) ?? []),
    ],
    [ordered, resting],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      // A sheet left open across a resize owns every key until it
      // closes, wherever focus sits.
      if (document.querySelector("[data-overlay]") !== null) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (findOpen) {
          closeFind();
          return;
        }
        if (activeId) void navigate({ to: "/" });
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      // While find stands open the collection is hidden behind the
      // hits, so j/k must not walk it — even with focus off the input.
      if (findOpen) return;
      // At home nothing is active: j steps into the top of the collection.
      const i = activeId ? flat.indexOf(activeId) : -1;
      if (activeId && i === -1) return;
      const next = flat[i + (e.key === "j" ? 1 : -1)];
      if (next) {
        prepareNavigation(next);
        void navigate({ to: "/thought/$thoughtId", params: { thoughtId: next } });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, activeId, navigate, prepareNavigation, findOpen, closeFind]);

  const activeResting =
    resting?.some((thought) => thought._id === activeId) ?? false;
  useEffect(() => {
    if (activeResting) setRestingOpen(true);
  }, [activeResting]);

  const loading = data === undefined;
  const finding = findOpen && query.trim() !== "";
  return (
    <nav
      aria-label="workspace"
      className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-line bg-scr lg:flex xl:w-80"
    >
      <div className="flex flex-none flex-col gap-[18px] px-5 pt-6 pb-4">
        <Link to="/" aria-label="drft, home" className="self-start rounded-card">
          <Wordmark />
        </Link>
        {findOpen ? (
          <div
            data-rail-find
            className="flex h-10 items-center gap-2.5 rounded-card bg-pg pr-2 pl-3 ring-1 ring-dot-edge ring-inset"
          >
            <MagnifyingGlass aria-hidden="true" className="flex-none text-[16px] text-pt" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeFind();
                else onResultsKey(e, goHit);
              }}
              autoFocus
              placeholder="Find a thought"
              aria-label="find a thought"
              role="combobox"
              aria-expanded={finding}
              aria-controls={listboxId}
              aria-activedescendant={
                finding && hits && hits[active]
                  ? hitOptionId(listboxId, active)
                  : undefined
              }
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-pl"
            />
            <button
              type="button"
              onClick={closeFind}
              aria-label="close find"
              className="flex-none"
            >
              <Kbd className="bg-scr text-pt ring-1 ring-line ring-inset transition-colors hover:text-ink">
                esc
              </Kbd>
            </button>
          </div>
        ) : (
          <button
            data-rail-find
            type="button"
            onClick={() => setFindOpen(true)}
            className="flex h-10 items-center gap-2.5 rounded-card bg-pg pr-2 pl-3 text-left text-[14px] text-pl ring-1 ring-line ring-inset transition-shadow hover:ring-dot-edge"
          >
            <MagnifyingGlass aria-hidden="true" className="flex-none text-[16px] text-pt" />
            <span className="flex-1">Find a thought</span>
            <Kbd className="bg-scr text-pt ring-1 ring-line ring-inset">⌘K</Kbd>
          </button>
        )}
      </div>

      <div
        role="region"
        aria-label="collection"
        aria-busy={loading}
        className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4 [scrollbar-gutter:stable]"
      >
        {finding ? (
          <FindResults
            hits={hits}
            active={active}
            setActive={setActive}
            now={now}
            go={goHit}
            prewarm={prepareNavigation}
            listboxId={listboxId}
          />
        ) : loading ? (
          <RailSkeleton />
        ) : (
          <>
            {ordered.pinned && (
              <BackToday
                t={ordered.pinned}
                active={ordered.pinned._id === activeId}
                prewarm={prepareNavigation}
              />
            )}
            {ordered.groups.map(({ group, rows }) => (
              <div key={group}>
                <GroupHeader group={group} count={rows.length} />
                {rows.map((t) => (
                  <RailRow
                    key={t._id}
                    t={t}
                    time={ageLabel(t.createdAt, now)}
                    active={t._id === activeId}
                    prewarm={prepareNavigation}
                  />
                ))}
              </div>
            ))}
            {resting && resting.length > 0 && (
              <div>
                <button
                  type="button"
                  aria-expanded={restingOpen}
                  aria-controls="rail-resting-thoughts"
                  onClick={() => setRestingOpen((open) => !open)}
                  className="mt-3 flex w-full items-center justify-between rounded-card px-3 py-2 text-left text-[13px] font-medium text-pt transition-colors hover:bg-tint hover:text-ink"
                >
                  <span>Resting thoughts</span>
                  <CaretDown
                    aria-hidden="true"
                    className={`text-[14px] transition-transform motion-reduce:transition-none ${restingOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {restingOpen && (
                  <div id="rail-resting-thoughts">
                    {resting.map((thought) => (
                      <RailRow
                        key={thought._id}
                        t={thought}
                        time={thought.restedAt ? ageLabel(thought.restedAt, now) : ""}
                        active={thought._id === activeId}
                        prewarm={prepareNavigation}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-none flex-col gap-0.5 border-t border-line px-3 pt-2.5 pb-3.5">
        <Link
          to="/connections"
          className="flex items-center gap-2.5 rounded-card px-3 py-2 text-[14px] text-pt transition-colors hover:bg-tint hover:text-ink"
        >
          <Graph aria-hidden="true" className="text-[17px]" />
          Connections
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-2.5 rounded-card px-3 py-2 text-[14px] text-pt transition-colors hover:bg-tint hover:text-ink"
        >
          <GearSix aria-hidden="true" className="text-[17px]" />
          Settings
        </Link>
      </div>
    </nav>
  );
});


function GroupHeader({ group, count }: { group: Group; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-[18px] pb-1.5 text-[13px] font-medium text-pt">
      {GROUP_LABEL[group]}
      <Badge>{count}</Badge>
    </div>
  );
}

// The open row: a deeper tint and a vermilion bar down its left edge.
const ACTIVE_BAR =
  "bg-tint-2 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-dot";

function RailSkeleton() {
  return (
    <div role="status" aria-label="loading collection">
      <div className="flex h-[42px] items-end px-3 pb-2" aria-hidden="true">
        <Skeleton className="h-[9px] w-14" />
      </div>
      {Array.from({ length: 10 }, (_, row) => (
        <RailSkeletonRow key={row} width={SKELETON_WIDTHS[row % SKELETON_WIDTHS.length]} />
      ))}
    </div>
  );
}

// Varied lengths so the placeholder reads as thoughts, not as a table.
const SKELETON_WIDTHS = ["w-[78%]", "w-[56%]", "w-[70%]", "w-[48%]", "w-[64%]"];

// One rail row to the pixel: a 14.5px line box inside py-2, time at right.
function RailSkeletonRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <span className="flex h-[21px] min-w-0 flex-1 items-center">
        <Skeleton className={`h-[9px] ${width}`} />
      </span>
      <Skeleton className="h-[9px] w-7" />
    </div>
  );
}

// Today's returned thought, held apart at the top of the rail.
const BackToday = memo(function BackToday({
  t,
  active,
  prewarm,
}: {
  t: RailThought;
  active: boolean;
  prewarm: (thoughtId: Id<"thoughts">) => void;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      aria-current={active ? "page" : undefined}
      className={`relative mb-1.5 flex flex-col gap-[5px] rounded-card px-3.5 py-3 transition-colors hover:bg-tint-2 ${
        active ? ACTIVE_BAR : "bg-tint"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-dot-ink">
        <ArrowBendUpLeft aria-hidden="true" className="text-[14px]" />
        <span className="sr-only">returned today: </span>
        <span aria-hidden="true">Back today</span>
      </span>
      <span className="line-clamp-2 text-[14.5px] leading-[1.45] text-ink">
        {t.preview}
      </span>
    </Link>
  );
});

// The time arrives as a string, so the 30s tick re-renders only the rows
// whose label actually changed; memo holds every other row still.
const RailRow = memo(function RailRow({
  t,
  time,
  active,
  prewarm,
}: {
  t: { _id: Id<"thoughts">; preview: string };
  time: string;
  active: boolean;
  prewarm: (thoughtId: Id<"thoughts">) => void;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-baseline gap-2.5 rounded-card px-3 py-2 transition-colors ${
        active ? ACTIVE_BAR : "hover:bg-tint"
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink">
        {t.preview}
      </span>
      {time && (
        <span
          className={`flex-none text-[12.5px] tabular-nums ${active ? "text-dot-ink" : "text-pl"}`}
        >
          {time}
        </span>
      )}
    </Link>
  );
});
