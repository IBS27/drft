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
import { Skeleton } from "../ui/Skeleton";
import { localDate, orderRows } from "./format";
import { useCachedQuery } from "./useCachedQuery";
import { useThoughtPrewarm } from "./useThoughtPrewarm";

type RailThought = {
  _id: Id<"thoughts">;
  preview: string;
  createdAt: number;
};

// The design mockup's edge rail: the collection stays in the periphery —
// while you sit with one thought, and at home too, where the main area
// holds only capture. Faint until hovered; the vermilion dot marks where
// you are (null at home). Also owns the collection's keyboard: j/k move
// between thoughts (j enters the top from home), Esc returns to the door.
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
      className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-line bg-scr pt-24 lg:flex xl:w-80"
    >
      {findOpen ? (
        <div
          data-rail-find
          className="mx-5 flex flex-none items-center gap-3 rounded-sm bg-pg px-3 py-2.5"
        >
          <div className="relative min-w-0 flex-1">
            {!query && (
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[10.5px] tracking-[0.3em] text-pl uppercase">
                find a thought
              </span>
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeFind();
                else onResultsKey(e, goHit);
              }}
              autoFocus
              aria-label="find a thought"
              role="combobox"
              aria-expanded={finding}
              aria-controls={listboxId}
              aria-activedescendant={
                finding && hits && hits[active]
                  ? hitOptionId(listboxId, active)
                  : undefined
              }
              className="w-full bg-transparent text-[15px] font-normal text-ink outline-none"
            />
          </div>
          <button
            type="button"
            onClick={closeFind}
            className="flex-none text-[9.5px] tracking-[0.16em] text-pl uppercase transition-colors hover:text-ink"
          >
            esc
          </button>
        </div>
      ) : (
        <button
          data-rail-find
          type="button"
          onClick={() => setFindOpen(true)}
          className="mx-5 flex flex-none items-center justify-between rounded-sm px-3 py-2.5 text-left text-[10.5px] tracking-[0.3em] text-pl uppercase transition-colors hover:bg-pg hover:text-ink"
        >
          <span>find</span>
          <span className="text-[9.5px] tracking-[0.16em]">⌘K</span>
        </button>
      )}

      <div
        role="region"
        aria-label="collection"
        aria-busy={loading}
        className="min-h-0 flex-1 overflow-y-auto pt-4 pr-5 pl-8 [scrollbar-gutter:stable]"
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
              <div className="mb-7">
                <RailRow
                  t={ordered.pinned}
                  active={ordered.pinned._id === activeId}
                  prewarm={prepareNavigation}
                />
              </div>
            )}
            {ordered.groups.map(({ group, rows }) => (
              <div key={group}>
                <div className="pt-7 pb-2 text-[10.5px] tracking-[0.34em] text-pl uppercase first:pt-0">
                  {group}
                </div>
                {rows.map((t) => (
                  <RailRow
                    key={t._id}
                    t={t}
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
                  className="flex w-full items-center justify-between pt-7 pb-2 text-left text-[10.5px] tracking-[0.34em] text-pl uppercase transition-colors hover:text-ink"
                >
                  <span>resting thoughts</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 10 6"
                    className={`h-1.5 w-2.5 transition-transform ${restingOpen ? "rotate-180" : ""}`}
                  >
                    <path
                      d="M1 1l4 4 4-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                </button>

                {restingOpen && (
                  <div id="rail-resting-thoughts">
                    {resting.map((thought) => (
                      <RestingRailRow
                        key={thought._id}
                        thought={thought}
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

      <div className="flex flex-none flex-col border-t border-line pt-5 pb-7 text-[10.5px] tracking-[0.3em] text-pl uppercase">
        <Link
          to="/settings"
          className="mx-8 transition-colors hover:text-ink"
        >
          settings
        </Link>
      </div>
    </nav>
  );
});

function RailSkeleton() {
  return (
    <div role="status" aria-label="loading collection">
      <div className="h-6" aria-hidden="true" />
      {Array.from({ length: 10 }, (_, row) => (
        <RailSkeletonRow key={row} />
      ))}
    </div>
  );
}

function RailSkeletonRow() {
  return (
    <div className="-mx-3 flex items-center gap-3 rounded-sm px-3 py-2.5">
      <span className="size-1.5 flex-none rounded-full" />
      <span className="flex h-[22.5px] min-w-0 flex-1 items-center">
        <Skeleton className="h-[10px] w-full" />
      </span>
    </div>
  );
}

const RestingRailRow = memo(function RestingRailRow({
  thought,
  active,
  prewarm,
}: {
  thought: { _id: Id<"thoughts">; preview: string };
  active: boolean;
  prewarm: (thoughtId: Id<"thoughts">) => void;
}) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: thought._id }}
      onPointerEnter={() => prewarm(thought._id)}
      onPointerDown={() => prewarm(thought._id)}
      onFocus={() => prewarm(thought._id)}
      aria-current={active ? "page" : undefined}
      className={`group -mx-3 flex items-center gap-3 rounded-sm px-3 py-2.5 transition-colors hover:bg-pg ${
        active ? "bg-pg" : ""
      }`}
    >
      <span
        className={`size-1.5 flex-none rounded-full ${active ? "bg-dot" : "bg-transparent"}`}
      />
      <span
        className={`truncate text-[15px] font-normal transition-colors group-hover:text-ink ${
          active ? "text-ink" : "text-pl"
        }`}
      >
        {thought.preview}
      </span>
    </Link>
  );
});

// Nothing here is relative to the clock, so the 30s tick must not reach
// it: memo holds every row still while only the page's ages redraw.
const RailRow = memo(function RailRow({
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
      className={`group -mx-3 flex items-center gap-3 rounded-sm px-3 py-2.5 transition-colors hover:bg-pg ${
        active ? "bg-pg" : ""
      }`}
    >
      <span
        className={`size-1.5 flex-none rounded-full ${active ? "bg-dot" : "bg-transparent"}`}
      />
      <span
        className={`truncate text-[15px] font-normal transition-colors group-hover:text-ink ${
          active ? "text-ink" : "text-pl"
        }`}
      >
        {t.preview}
      </span>
    </Link>
  );
});
