import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useMemo } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { firstLine, localDate, orderRows } from "./format";

type RailThought = {
  _id: Id<"thoughts">;
  text: string;
  createdAt: number;
  waiting: boolean;
};

// The design mockup's edge rail: the collection stays in the periphery
// while you sit with one thought. Faint until hovered; the vermilion
// dot marks where you are. Also owns the collection's keyboard: j/k
// move between thoughts, Esc returns to the room's door.
export function Rail({ activeId, now }: { activeId: Id<"thoughts">; now: Date }) {
  const data = useQuery(api.thoughts.collection, { date: localDate(now) });
  const navigate = useNavigate();

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
        void navigate({ to: "/" });
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const i = flat.indexOf(activeId);
      if (i === -1) return;
      const next = flat[i + (e.key === "j" ? 1 : -1)];
      if (next)
        void navigate({ to: "/thought/$thoughtId", params: { thoughtId: next } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, activeId, navigate]);

  if (!data || data.thoughts.length === 0) return null;

  return (
    <nav
      aria-label="collection"
      className="fixed top-24 bottom-8 left-0 hidden w-72 overflow-y-auto pr-5 pl-8 lg:block xl:w-80"
    >
      {ordered.pinned && (
        <div className="mb-7">
          <RailRow t={ordered.pinned} active={ordered.pinned._id === activeId} />
        </div>
      )}
      {ordered.groups.map(({ group, rows }) => (
        <div key={group}>
          <div className="pt-7 pb-2 text-[10.5px] tracking-[0.34em] text-pl uppercase first:pt-0">
            {group}
          </div>
          {rows.map((t) => (
            <RailRow key={t._id} t={t} active={t._id === activeId} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function RailRow({ t, active }: { t: RailThought; active: boolean }) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      className="group flex items-center gap-3 py-2"
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
