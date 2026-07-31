import { useUser } from "@clerk/clerk-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useState } from "react";
import { CaptureField } from "../features/thoughts/CaptureField";
import { Rail } from "../features/thoughts/Rail";
import { ageLabel, firstLine, localDate, orderRows } from "../features/thoughts/format";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/")({ component: Collection });

type Row = {
  _id: Id<"thoughts">;
  text: string;
  createdAt: number;
  waiting: boolean;
};

// One room: on wide screens the collection lives in the edge rail and
// capture sits alone at the center; narrower, capture at the top with
// the collection stacked below — today / this week / earlier, first
// line verbatim, nothing more.
function Collection() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const data = useQuery(api.thoughts.collection, { date: localDate(now) });
  const resting = useQuery(api.thoughts.resting);

  // The daily email starts without a settings visit: first signed-in load
  // creates the row (default 8:00, this browser's timezone), and later
  // loads keep the timezone current. Idempotent, so StrictMode's double
  // effect is harmless.
  const ensure = useMutation(api.settings.ensure);
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  useEffect(() => {
    if (!user) return;
    void ensure({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      email,
    });
  }, [ensure, user, email]);

  const loading = data === undefined;
  const thoughts = data?.thoughts ?? [];
  const { pinned, groups } = orderRows(thoughts, data?.resurfacedId ?? null, now);

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="relative z-10 flex items-baseline justify-between px-8 pt-7">
        <Link
          to="/settings"
          className="text-[11px] tracking-[0.26em] text-pl uppercase transition-colors hover:text-ink"
        >
          settings
        </Link>
        <span className="pointer-events-none absolute right-0 left-0 text-center text-[12px] tracking-[0.5em] text-pt uppercase lg:left-72 xl:left-80">
          drft
        </span>
        <span className="text-[12px] tracking-[0.1em] text-pl tabular-nums">
          {thoughts.length || ""}
        </span>
      </header>

      <Rail activeId={null} now={now} />

      <div className="flex flex-1 flex-col lg:pl-72 xl:pl-80">
        {loading ? (
          <section className="flex flex-1 items-center justify-center pb-24">
            <span className="caret h-5 w-px bg-faint" />
          </section>
        ) : thoughts.length === 0 ? (
          <section className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
            <CaptureField now={now} />
          </section>
        ) : (
          <>
            <section className="flex flex-col items-center px-6 pt-20 pb-6 lg:flex-1 lg:justify-center lg:pt-0 lg:pb-24">
              <CaptureField now={now} />
            </section>

            <section className="mx-auto w-full max-w-2xl flex-1 px-6 pt-12 pb-10 lg:hidden">
              {pinned && (
                <div className="mb-12">
                  <ThoughtRow t={pinned} now={now} />
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
      </div>
    </main>
  );
}

function ThoughtRow({ t, now }: { t: Row; now: Date }) {
  const prewarm = useThoughtPrewarm();

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
        {firstLine(t.text)}
      </span>
      <span className="flex-none text-[12px] tracking-[0.08em] text-pl tabular-nums">
        {ageLabel(t.createdAt, now)}
      </span>
    </Link>
  );
}
