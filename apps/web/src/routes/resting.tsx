import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useState } from "react";
import { ageLabel } from "../features/thoughts/format";
import { useCachedQuery } from "../features/thoughts/useCachedQuery";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { PageHeader } from "../features/ui/PageHeader";
import { SkeletonRows } from "../features/ui/Skeleton";

export const Route = createFileRoute("/resting")({ component: Resting });

// Thoughts that were set down. Out of the collection and the rotation;
// still part of your thinking's history, still one click from waking.
function Resting() {
  const { isAuthenticated } = useConvexAuth();
  const rows = useCachedQuery(
    api.thoughts.resting,
    isAuthenticated ? {} : "skip",
    "resting",
  );
  const [now] = useState(() => Date.now());
  const prewarm = useThoughtPrewarm();

  return (
    <main className="flex min-h-dvh flex-col">
      <PageHeader title="Resting" />

      <section className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-16 md:px-6">
        <p className="px-1 pb-5 text-[15px] leading-relaxed text-pl">
          Thoughts you've set down. They stay out of the daily return, and any
          of them can wake.
        </p>
        {rows === undefined ? (
          <SkeletonRows count={4} />
        ) : rows.length === 0 ? (
          <p className="rounded-[14px] bg-scr px-5 py-8 text-center text-[15px] text-pl ring-1 ring-line ring-inset">
            Nothing is resting.
          </p>
        ) : (
          <div className="rounded-[14px] bg-scr p-1.5 shadow-lift ring-1 ring-line ring-inset">
          {rows.map((t, i) => (
            <Link
              key={t._id}
              to="/thought/$thoughtId"
              params={{ thoughtId: t._id }}
              onPointerEnter={() => prewarm(t._id)}
              onPointerDown={() => prewarm(t._id)}
              onFocus={() => prewarm(t._id)}
              className={`block rounded-card px-3.5 py-3.5 transition-colors hover:bg-tint ${i > 0 ? "divided" : ""}`}
            >
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate text-[16px] text-ink">
                  {t.preview}
                </span>
                <span className="flex-none text-[13px] text-pl tabular-nums">
                  {t.restedAt ? ageLabel(t.restedAt, now) : ""}
                </span>
              </div>
              {t.restingNote && (
                <div className="mt-1 truncate text-[13.5px] text-pl">
                  {t.restingNote}
                </div>
              )}
            </Link>
          ))}
          </div>
        )}
      </section>
    </main>
  );
}
