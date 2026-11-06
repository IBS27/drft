import { createFileRoute, Link } from "@tanstack/react-router";
import { Moon, Sun } from "@phosphor-icons/react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useState } from "react";
import { ageLabel } from "../features/thoughts/format";
import { useCachedQuery } from "../features/thoughts/useCachedQuery";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { PageHeader } from "../features/ui/PageHeader";
import { Rail } from "../features/thoughts/Rail";
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
  // Waking from the list leaves it at once; Convex confirms behind it.
  const wake = useMutation(api.thoughts.wake).withOptimisticUpdate(
    (localStore, { thoughtId }) => {
      const current = localStore.getQuery(api.thoughts.resting, {});
      if (current)
        localStore.setQuery(
          api.thoughts.resting,
          {},
          current.filter((row) => row._id !== thoughtId),
        );
    },
  );

  return (
    <main className="min-h-dvh">
      <Rail activeId={null} now={now} />
      <div className="flex min-h-dvh flex-col lg:pl-72 xl:pl-80">
      <PageHeader title="Resting" />

      <section className="mx-auto w-full max-w-[688px] flex-1 px-4 pt-4 pb-16 md:px-10">
        <p className="px-5 pb-5 text-[15px] leading-relaxed text-pretty text-pl">
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
          <div className="rounded-[14px] bg-scr p-1.5 ring-1 ring-line ring-inset">
          {rows.map((t, i) => (
            <div
              key={t._id}
              className={`flex items-center gap-2 rounded-card pr-2.5 transition-colors hover:bg-tint ${i > 0 ? "divided" : ""}`}
            >
              <Link
                to="/thought/$thoughtId"
                params={{ thoughtId: t._id }}
                onPointerEnter={() => prewarm(t._id)}
                onPointerDown={() => prewarm(t._id)}
                onFocus={() => prewarm(t._id)}
                className="block min-w-0 flex-1 rounded-card py-3.5 pl-3.5"
              >
                <span className="line-clamp-2 text-[16px] leading-[1.4] text-ink">
                  {t.preview}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-[13px] text-pl">
                  {t.restedAt && (
                    <span className="inline-flex flex-none items-center gap-1 tabular-nums">
                      <Moon aria-hidden="true" className="text-[12px]" />
                      Set down {ageLabel(t.restedAt, now)}
                    </span>
                  )}
                  {t.restingNote && (
                    <span className="min-w-0 truncate">· {t.restingNote}</span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void wake({ thoughtId: t._id }).catch(() => {})}
                className="inline-flex h-8 flex-none items-center gap-1.5 rounded-full bg-scr px-3 text-[13px] font-medium text-pt ring-1 ring-line ring-inset transition-[color,box-shadow] hover:text-ink hover:ring-dot-edge [@media(hover:none)]:h-9"
              >
                <Sun aria-hidden="true" className="text-[14px]" />
                Wake
              </button>
            </div>
          ))}
          </div>
        )}
      </section>
      </div>
    </main>
  );
}
