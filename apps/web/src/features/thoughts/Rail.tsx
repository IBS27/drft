import {
  ArrowBendUpLeft,
  BookmarkSimple,
  CaretDown,
  GearSix,
  Graph,
  MagnifyingGlass,
  Moon,
  PencilSimpleLine,
} from "@phosphor-icons/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useHold, type ToggleHold } from "../held/useHold";
import { FindResults } from "../search/FindResults";
import {
  hitOptionId,
  useThoughtSearch,
  type Hit,
} from "../search/useThoughtSearch";
import { Kbd } from "../ui/Kbd";
import { Skeleton } from "../ui/Skeleton";
import { Wordmark } from "../ui/Wordmark";
import { ageLabel, localDate, orderRows, type Group, GROUP_LABEL } from "./format";
import { useCachedQuery } from "./useCachedQuery";
import { useThoughtPrewarm } from "./useThoughtPrewarm";

// Carried on every move between thoughts while you came from the Held
// page, so Esc and the way back keep returning there.
type ThoughtSearch = { from?: "held" };
const FROM_HELD: ThoughtSearch = { from: "held" };
const FROM_HOME: ThoughtSearch = {};

type RailThought = {
  _id: Id<"thoughts">;
  preview: string;
  createdAt: number;
  heldAt?: number;
};

// The edge rail (docs/vivid.html#ember): the collection stays in the
// periphery while you sit with one thought, and at home too, where the
// main area holds only capture. Today's returned thought sits on top as a
// tinted "Back today" strip; the open thought is held by a deeper tint and
// a vermilion bar.
// Held thoughts carry a small bookmark; hovering a row offers to hold it
// or let go without opening it. Held, Resting and Connections sit under
// New thought; Settings is the gear beside the wordmark.
// Also owns the collection's keyboard: j/k move between thoughts (j enters
// the top from home), Esc returns to the door — home, or the Held page
// when the thought was opened from there.
export const Rail = memo(function Rail({
  activeId,
  now,
  backTo = "/",
}: {
  activeId: Id<"thoughts"> | null;
  now: number;
  backTo?: "/" | "/held";
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
  const toggleHold = useHold();
  // On home the day's thought has the main column; the rail doesn't repeat it.
  const onHome = useRouterState({ select: (s) => s.location.pathname === "/" });
  const search = backTo === "/held" ? FROM_HELD : FROM_HOME;
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
      void navigate({
        to: "/thought/$thoughtId",
        params: { thoughtId: hit._id },
        search,
      });
    },
    [prepareNavigation, closeFind, navigate, search],
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
        if (activeId) void navigate({ to: backTo });
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
        void navigate({
          to: "/thought/$thoughtId",
          params: { thoughtId: next },
          search,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, activeId, backTo, search, navigate, prepareNavigation, findOpen, closeFind]);

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
      data-finding={finding || undefined}
      className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-line bg-scr lg:flex xl:w-80"
    >
      <div className="flex flex-none flex-col gap-[18px] px-3 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="drft, home" className="rounded-card px-3">
            <Wordmark />
          </Link>
          <Link
            to="/settings"
            aria-label="Settings"
            className="-my-1.5 flex size-8 items-center justify-center rounded-full text-[17px] text-pl transition-colors hover:bg-tint hover:text-ink aria-[current=page]:bg-line/55 aria-[current=page]:text-ink"
          >
            <GearSix aria-hidden="true" />
          </Link>
        </div>
        {findOpen ? (
          <div
            data-rail-find
            className="flex h-10 items-center gap-2.5 rounded-card bg-pg pr-2 pl-3 ring-1 ring-pl/50 ring-inset"
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
            className="flex h-10 items-center gap-2.5 rounded-card bg-pg pr-2 pl-3 text-left text-[14px] text-pl ring-1 ring-line ring-inset transition-shadow hover:ring-pl/50"
          >
            <MagnifyingGlass aria-hidden="true" className="flex-none text-[16px] text-pt" />
            <span className="flex-1">Find a thought</span>
            <Kbd className="bg-scr text-pt ring-1 ring-line ring-inset">⌘K</Kbd>
          </button>
        )}
        {/* The places sit with the controls, so the collection runs on to
            the bottom edge like any list that keeps going. */}
        <div className="-mt-2.5 flex flex-col">
          <Link to="/" activeOptions={{ exact: true }} className={PLACE_BASE}>
            <PencilSimpleLine aria-hidden="true" className="text-[16px]" />
            New thought
          </Link>
          <Link to="/held" className={PLACE}>
            <BookmarkSimple aria-hidden="true" className="text-[16px]" />
            Held
          </Link>
          <Link to="/resting" className={PLACE}>
            <Moon aria-hidden="true" className="text-[16px]" />
            Resting
          </Link>
          <Link to="/connections" className={PLACE}>
            <Graph aria-hidden="true" className="text-[16px]" />
            Connections
          </Link>
        </div>
      </div>

      <div
        role="region"
        aria-label="collection"
        aria-busy={loading}
        className="min-h-0 flex-1 overflow-y-auto border-t border-line px-3 pt-1 pb-10 [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,#000_calc(100%-40px),transparent)]"
      >
        {finding ? (
          <FindResults
            query={query}
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
            {ordered.pinned && !onHome && (
              <BackToday
                t={ordered.pinned}
                active={ordered.pinned._id === activeId}
                prewarm={prepareNavigation}
                search={search}
              />
            )}
            {ordered.groups.map(({ group, rows }, gi) => (
              <div key={group}>
                <GroupHeader group={group} first={gi === 0 && !(ordered.pinned && !onHome)} />
                {rows.map((t, i) => (
                  <RailRow
                    key={t._id}
                    divided={i > 0}
                    t={t}
                    time={ageLabel(t.createdAt, now)}
                    active={t._id === activeId}
                    prewarm={prepareNavigation}
                    search={search}
                    heldAt={t.heldAt}
                    toggleHold={toggleHold}
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
                        search={search}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

    </nav>
  );
});


// The first heading sits close under the controls, so the list starts at
// the same height whether or not the day's thought is above it.
function GroupHeader({ group, first }: { group: Group; first: boolean }) {
  return (
    <div className={`px-3 pb-1.5 text-[13px] font-medium text-pl ${first ? "pt-2" : "pt-6"}`}>
      {GROUP_LABEL[group]}
    </div>
  );
}

// A place in the rail (New thought, Held, Resting, Connections).
// New thought is home itself, so it never wears the "you are here" wash.
const PLACE_BASE =
  "flex h-9 items-center gap-2.5 rounded-card px-3 text-[14px] text-pt transition-colors hover:bg-tint hover:text-ink";
const PLACE = `${PLACE_BASE} aria-[current=page]:bg-line/55 aria-[current=page]:font-medium aria-[current=page]:text-ink`;

// The open row: a neutral wash and a vermilion bar down its left edge.
const ACTIVE_BAR =
  "bg-line/55 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-pt/45";

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

// One rail row to the pixel: a 15px line box inside py-[9px], time at right.
function RailSkeletonRow({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-[9px]">
      <span className="flex h-[22px] min-w-0 flex-1 items-center">
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
  search,
}: {
  t: RailThought;
  active: boolean;
  prewarm: (thoughtId: Id<"thoughts">) => void;
  search: ThoughtSearch;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      search={search}
      data-hold-id={t._id}
      data-held-at={t.heldAt ?? ""}
      data-hold-notice=""
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      aria-current={active ? "page" : undefined}
      className={`relative mb-1 flex flex-col rounded-card px-3 py-2.5 ring-1 ring-(--back-edge) ring-inset transition-colors ${
        active ? ACTIVE_BAR : "bg-(--back-wash) hover:bg-tint"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-dot-ink">
        <ArrowBendUpLeft aria-hidden="true" className="text-[13px]" />
        <span className="sr-only">returned today: </span>
        <span aria-hidden="true">Back today</span>
      </span>
      <span className="mt-1 line-clamp-2 text-[15px] leading-[1.4] text-ink">{t.preview}</span>
    </Link>
  );
});

// The time arrives as a string, so the 30s tick re-renders only the rows
// whose label actually changed; memo holds every other row still.
// Collection rows can be held (`toggleHold`): a held row carries a small
// bookmark, and on hover the time gives way to a button that holds or
// lets go (h does the same on the focused or hovered row). Resting rows
// can't be held.
const RailRow = memo(function RailRow({
  divided = false,
  t,
  time,
  active,
  prewarm,
  search,
  heldAt,
  toggleHold,
}: {
  divided?: boolean;
  t: { _id: Id<"thoughts">; preview: string };
  time: string;
  active: boolean;
  prewarm: (thoughtId: Id<"thoughts">) => void;
  search: ThoughtSearch;
  heldAt?: number;
  toggleHold?: ToggleHold;
}) {
  const held = heldAt !== undefined;
  const link = (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      search={search}
      onPointerEnter={() => prewarm(t._id)}
      onPointerDown={() => prewarm(t._id)}
      onFocus={() => prewarm(t._id)}
      aria-current={active ? "page" : undefined}
      className={`group/row relative flex items-baseline gap-4 rounded-card px-3 py-[9px] transition-colors ${
        active ? ACTIVE_BAR : "hover:bg-tint"
      }`}
    >
      {/* A step quieter than the page it sits beside; full ink when in hand. */}
      <span
        className={`line-clamp-2 min-w-0 flex-1 text-[15px] leading-[1.4] ${active ? "text-ink" : "text-pt group-hover/row:text-ink"}`}
      >
        {t.preview}
      </span>
      {(time || held) && (
        <span
          className={`inline-flex flex-none items-baseline gap-1 text-[13px] tabular-nums text-pl ${
            toggleHold ? "group-hover:invisible [@media(hover:none)]:visible" : ""
          }`}
        >
          {held && (
            <BookmarkSimple weight="fill" aria-label="held" className="translate-y-[1px] text-[11px] text-pt" />
          )}
          {time}
        </span>
      )}
    </Link>
  );
  if (!toggleHold) return link;
  return (
    <div
      className={`group relative [--inset:12px] ${divided ? "divided" : ""}`}
      data-hold-id={t._id}
      data-held-at={heldAt ?? ""}
      data-hold-notice=""
    >
      {link}
      {/* Out of the tab order: the row's link already takes focus, and h
          acts on it. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => toggleHold(t._id, heldAt, { notice: true })}
        aria-label={held ? "Let go" : "Hold"}
        title={held ? "Let go (h)" : "Hold (h)"}
        className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-tint-2 text-[13px] text-pt opacity-0 transition-[opacity,color] group-hover:opacity-100 hover:text-ink [@media(hover:none)]:hidden"
      >
        <BookmarkSimple aria-hidden="true" weight={held ? "fill" : "regular"} />
      </button>
    </div>
  );
});
