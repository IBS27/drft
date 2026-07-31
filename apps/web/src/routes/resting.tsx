import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useState } from "react";
import { ageLabel } from "../features/thoughts/format";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { BackLink } from "../features/ui/BackLink";
import { SkeletonRows } from "../features/ui/Skeleton";

export const Route = createFileRoute("/resting")({ component: Resting });

// Thoughts that were set down. Out of the collection and the rotation;
// still part of your thinking's history, still one click from waking.
function Resting() {
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.thoughts.resting, isAuthenticated ? {} : "skip");
  const [now] = useState(() => Date.now());
  const prewarm = useThoughtPrewarm();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="grid grid-cols-3 items-center px-5 pt-4 md:px-8">
        <BackLink />
        <span className="justify-self-center text-[11.5px] tracking-[0.4em] text-pl uppercase">
          resting
        </span>
        <span />
      </header>

      <section className="mx-auto w-full max-w-2xl flex-1 px-6 pt-16 pb-16">
        {rows === undefined ? (
          <SkeletonRows count={4} />
        ) : (
          rows.map((t) => (
            <Link
              key={t._id}
              to="/thought/$thoughtId"
              params={{ thoughtId: t._id }}
              onPointerEnter={() => prewarm(t._id)}
              onPointerDown={() => prewarm(t._id)}
              onFocus={() => prewarm(t._id)}
              className="group block border-b border-line py-4"
            >
              <div className="flex items-center gap-3.5">
                <span className="flex-1 truncate text-[16px] font-normal text-pt transition-colors group-hover:text-ink">
                  {t.preview}
                </span>
                <span className="flex-none text-[12px] tracking-[0.08em] text-pl tabular-nums">
                  {t.restedAt ? ageLabel(t.restedAt, now) : ""}
                </span>
              </div>
              {t.restingNote && (
                <div className="mt-1 truncate text-[13.5px] font-normal text-mut">
                  {t.restingNote}
                </div>
              )}
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
