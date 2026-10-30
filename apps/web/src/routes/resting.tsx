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

      <section className="mx-auto w-full max-w-2xl flex-1 px-4 pt-8 pb-16 md:px-6">
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
              className="block rounded-card px-2.5 py-3.5 transition-colors hover:bg-tint [a+&]:shadow-[0_-1px_0_var(--line)] hover:shadow-none! [a:hover+&]:shadow-none!"
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
          ))
        )}
      </section>
    </main>
  );
}
