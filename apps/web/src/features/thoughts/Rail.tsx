import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { memo, useCallback, useEffect, useMemo } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { firstLine, localDate, orderRows } from "./format";
import { useThoughtPrewarm } from "./useThoughtPrewarm";

type RailThought = {
  _id: Id<"thoughts">;
  text: string;
  createdAt: number;
  waiting: boolean;
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
  now: Date;
}) {
  const data = useQuery(api.thoughts.collection, { date: localDate(now) });
  const navigate = useNavigate();
  const prewarm = useThoughtPrewarm();
  const prepareNavigation = useCallback(
    (thoughtId: Id<"thoughts">) => {
      if (activeId) prewarm(activeId);
      prewarm(thoughtId);
    },
    [activeId, prewarm],
  );

  const ordered = useMemo(() => {
    if (!data) return { pinned: null, groups: [] };
    return orderRows<RailThought>(data.thoughts, data.resurfacedId, now);
  }, [data, now]);

  const flat = useMemo(
    () => [
      ...(ordered.pinned ? [ordered.pinned._id] : []),
      ...ordered.groups.flatMap(({ rows }) => rows.map((t) => t._id)),
    ],
    [ordered],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.closest("[data-overlay]") !== null)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (activeId) void navigate({ to: "/" });
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
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
  }, [flat, activeId, navigate, prepareNavigation]);

  if (!data || data.thoughts.length === 0) return null;

  return (
    <nav
      aria-label="collection"
      className="fixed inset-y-0 left-0 hidden w-72 overflow-y-auto border-r border-line bg-scr pt-24 pr-5 pb-8 pl-8 [scrollbar-gutter:stable] lg:block xl:w-80"
    >
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
    </nav>
  );
});

function RailRow({
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
          active ? "text-ink" : t.waiting ? "text-pt" : "text-pl"
        }`}
      >
        {firstLine(t.text)}
      </span>
    </Link>
  );
}
