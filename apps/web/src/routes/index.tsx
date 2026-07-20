import { SignOutButton } from "@clerk/clerk-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { CaptureField } from "../features/thoughts/CaptureField";
import {
  GROUPS,
  ageLabel,
  firstLine,
  groupOf,
  localDate,
} from "../features/thoughts/format";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/")({ component: Collection });

type Row = {
  _id: Id<"thoughts">;
  text: string;
  createdAt: number;
  waiting: boolean;
};

// One room: capture sits quietly at the top, the collection below —
// today / this week / earlier, first line verbatim, nothing more.
function Collection() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const count = useQuery(api.thoughts.count);
  const data = useQuery(api.thoughts.collection, { date: localDate(now) });
  const resting = useQuery(api.thoughts.resting);

  const loading = data === undefined;
  const thoughts = data?.thoughts ?? [];
  const resurfaced = thoughts.find((t) => t._id === data?.resurfacedId);
  const rest = thoughts.filter((t) => t._id !== data?.resurfacedId);
  const groups = GROUPS.map((group) => ({
    group,
    rows: rest.filter((t) => groupOf(t.createdAt, now) === group),
  })).filter(({ rows }) => rows.length > 0);

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="grid grid-cols-3 items-baseline px-8 pt-7">
        <SignOutButton>
          <button
            type="button"
            className="justify-self-start text-[11px] tracking-[0.26em] text-pl uppercase transition-colors hover:text-ink"
          >
            sign out
          </button>
        </SignOutButton>
        <span className="justify-self-center text-[12px] tracking-[0.5em] text-pt uppercase">
          drft
        </span>
        <span className="justify-self-end text-[12px] tracking-[0.1em] text-pl tabular-nums">
          {count || ""}
        </span>
      </header>

      {loading ? null : thoughts.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
          <CaptureField now={now} />
        </section>
      ) : (
        <>
          <section className="flex flex-col items-center px-6 pt-20 pb-6">
            <CaptureField now={now} />
          </section>

          <section className="mx-auto w-full max-w-2xl flex-1 px-6 pt-12 pb-10">
            {resurfaced && (
              <div className="mb-12">
                <ThoughtRow t={resurfaced} now={now} />
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
                  <ThoughtRow key={t._id} t={t} now={now} />
                ))}
              </div>
            ))}
          </section>
        </>
      )}

      {!loading && resting && resting.length > 0 && (
        <footer className="flex items-center justify-center pb-10">
          <Link
            to="/resting"
            className="text-[10.5px] tracking-[0.34em] text-pl uppercase transition-colors hover:text-ink"
          >
            resting
          </Link>
        </footer>
      )}
    </main>
  );
}

function ThoughtRow({ t, now }: { t: Row; now: Date }) {
  return (
    <Link
      to="/thought/$thoughtId"
      params={{ thoughtId: t._id }}
      className="group flex items-center gap-3.5 border-b border-line py-4"
    >
      {t.waiting && <span className="size-2 flex-none rounded-full bg-dot" />}
      <span
        className={`flex-1 truncate text-[16px] font-normal transition-colors group-hover:text-ink ${
          t.waiting ? "text-ink" : "text-pt"
        }`}
      >
        {firstLine(t.text)}
      </span>
      <span className="flex-none text-[12px] tracking-[0.08em] text-pl tabular-nums">
        {ageLabel(t.createdAt, now)}
      </span>
    </Link>
  );
}
