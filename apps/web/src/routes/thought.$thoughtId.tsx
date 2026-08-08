import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import { ageLabel, dateLine, groupOf } from "../features/thoughts/format";
import { Rail } from "../features/thoughts/Rail";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { BackLink } from "../features/ui/BackLink";
import { Skeleton } from "../features/ui/Skeleton";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/thought/$thoughtId")({
  component: ThoughtView,
  errorComponent: NotHere,
});

type ThoughtData = NonNullable<FunctionReturnType<typeof api.thoughts.view>>;
type Connection = ThoughtData["connections"][number];

function NotHere() {
  return (
    <main className="flex min-h-dvh flex-col">
      <BackHeader />
      <div className="flex flex-1 items-center justify-center pb-24">
        <span className="text-[10.5px] tracking-[0.34em] text-pl uppercase">
          this thought isn't here
        </span>
      </div>
    </main>
  );
}

function BackHeader({
  label,
  loading = false,
  withRail = false,
}: {
  label?: string;
  loading?: boolean;
  withRail?: boolean;
}) {
  return (
    <header className="relative z-10 flex items-center px-5 pt-4 md:px-8">
      <BackLink />
      <span
        className={`pointer-events-none absolute right-0 text-center text-[11.5px] tracking-[0.4em] text-pl uppercase ${
          withRail ? "left-0 lg:left-72 xl:left-80" : "left-0"
        }`}
      >
        {loading ? <Skeleton className="mx-auto h-[7px] w-24" /> : (label ?? "")}
      </span>
    </header>
  );
}

// Your words hold the center of the page, exactly as captured. Gathered
// quietly around them, where the thought has been — set down, returned to,
// what it turned out to be near — and one action waiting at the bottom
// edge. On wide screens the collection stays in the periphery as an edge
// rail.
function ThoughtView() {
  const { thoughtId } = Route.useParams();
  const id = thoughtId as Id<"thoughts">;
  // The route can render before Convex has the user's token; asking then
  // would only be answered "not signed in", and the answer would stick.
  const { isAuthenticated } = useConvexAuth();
  const view = useQuery(
    api.thoughts.view,
    isAuthenticated ? { thoughtId: id } : "skip",
  );
  const prewarm = useThoughtPrewarm();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // A dismissed link lingers for a moment as an undo — the one-click
  // path back, same as everything else here. The click takes it off the
  // page itself; the server only confirms. Where it sat is remembered so
  // undo can put it back in the same place, just as immediately.
  const [aside, setAside] = useState<
    { id: Id<"connections">; failed: boolean } | null
  >(null);
  const asideTimer = useRef<number | undefined>(undefined);
  const setAsideRow = useRef<{ index: number; connection: Connection } | null>(
    null,
  );
  const dismissConn = useMutation(
    api.thoughts.dismissConnection,
  ).withOptimisticUpdate((localStore, { connectionId }) => {
    const current = localStore.getQuery(api.thoughts.view, { thoughtId: id });
    if (!current) return;
    localStore.setQuery(
      api.thoughts.view,
      { thoughtId: id },
      {
        ...current,
        connections: current.connections.filter((c) => c._id !== connectionId),
      },
    );
  });
  const undismissConn = useMutation(
    api.thoughts.undismissConnection,
  ).withOptimisticUpdate((localStore, { connectionId }) => {
    const current = localStore.getQuery(api.thoughts.view, { thoughtId: id });
    const row = setAsideRow.current;
    if (!current || !row || row.connection._id !== connectionId) return;
    if (current.connections.some((c) => c._id === connectionId)) return;
    const connections = [...current.connections];
    connections.splice(
      Math.min(row.index, connections.length),
      0,
      row.connection,
    );
    localStore.setQuery(
      api.thoughts.view,
      { thoughtId: id },
      { ...current, connections },
    );
  });
  const dismiss = (connection: Connection, index: number) => {
    window.clearTimeout(asideTimer.current);
    setAsideRow.current = { index, connection };
    setAside({ id: connection._id, failed: false });
    asideTimer.current = window.setTimeout(() => setAside(null), 8000);
    void dismissConn({ connectionId: connection._id }).catch(() =>
      setAside({ id: connection._id, failed: true }),
    );
  };
  const undo = () => {
    if (!aside) return;
    window.clearTimeout(asideTimer.current);
    const connectionId = aside.id;
    setAside(null);
    void undismissConn({ connectionId }).catch(() => {});
  };

  useEffect(() => {
    // Moving to another thought (the component is reused) drops the undo.
    setAside(null);
    setAsideRow.current = null;
    window.clearTimeout(asideTimer.current);
  }, [id]);

  return (
    <main className="flex min-h-dvh flex-col">
      <BackHeader
        label={view ? dateLine(view.createdAt, now) : undefined}
        loading={view === undefined}
        withRail
      />
      <Rail activeId={id} now={now} />

      <div className="flex flex-1 flex-col lg:pl-72 xl:pl-80">
        {view === undefined ? (
          <ThoughtSkeleton />
        ) : view === null ? (
          <section className="flex flex-1 items-center justify-center pb-24">
            <span className="text-[10.5px] tracking-[0.34em] text-pl uppercase">
              this thought isn't here
            </span>
          </section>
        ) : (
          <section
            key={view._id}
            className="mx-auto flex w-full max-w-[64ch] flex-1 flex-col items-center px-6"
          >
            <div className="flex w-full flex-1 flex-col items-center justify-center py-12">
              <h1 className="max-w-[36ch] text-center text-[clamp(26px,3vw,34px)] leading-[1.55] font-light whitespace-pre-wrap">
                {view.text}
              </h1>

              {view.status === "resting" && (
                <div className="mt-7 flex flex-col items-center gap-2.5">
                  <span className="text-[10.5px] tracking-[0.34em] text-pl uppercase">
                    set down{view.restedAt ? ` · ${ageLabel(view.restedAt, now)}` : ""}
                  </span>
                  {view.restingNote && (
                    <p className="max-w-[44ch] text-center text-[15px] leading-[1.7] font-normal text-mut">
                      {view.restingNote}
                    </p>
                  )}
                </div>
              )}

              {view.lastReturnedAt && (
                <span className="mt-6 text-[10px] tracking-[0.3em] text-faint uppercase">
                  returned ·{" "}
                  {groupOf(view.lastReturnedAt, now) === "today"
                    ? "today"
                    : ageLabel(view.lastReturnedAt, now)}
                </span>
              )}

              {/* Related thoughts are destinations, not tags: their words
                  keep their natural case and wrap for as long as they need. */}
              {view.connections.length > 0 && (
                <div className="mt-12 w-full max-w-[52ch]">
                  <div className="flex items-baseline justify-between pb-3">
                    <span className="text-[10px] tracking-[0.28em] text-pl uppercase">
                      related thoughts
                    </span>
                    <span className="text-[10px] font-normal text-faint">
                      {view.connections.length}
                    </span>
                  </div>
                  <div className="border-t border-line">
                    {view.connections.map((c, i) => (
                      <div
                        key={c._id}
                        className="group relative border-b border-line"
                      >
                        <Link
                          to="/thought/$thoughtId"
                          params={{ thoughtId: c.otherId }}
                          onPointerEnter={() => {
                            prewarm(id);
                            prewarm(c.otherId);
                          }}
                          onPointerDown={() => {
                            prewarm(id);
                            prewarm(c.otherId);
                          }}
                          onFocus={() => {
                            prewarm(id);
                            prewarm(c.otherId);
                          }}
                          className="grid min-h-17 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-5 py-4 pr-11 text-left"
                        >
                          <span className="whitespace-pre-wrap text-[14.5px] leading-[1.55] font-normal text-pt transition-colors group-hover:text-ink">
                            {c.otherText}
                          </span>
                          <span className="text-right text-[9px] leading-[1.4] font-normal tracking-[0.18em] text-faint uppercase">
                            {c.otherStatus === "resting"
                              ? "set down"
                              : ageLabel(c.otherCreatedAt, now)}
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => dismiss(c, i)}
                          className="absolute top-1/2 right-0 flex size-10 -translate-y-1/2 items-center justify-center text-[15px] leading-none text-pl opacity-0 transition-[color,opacity] group-hover:opacity-100 hover:text-dot focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label="set related thought aside"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aside && (
                <div
                  role="status"
                  className="mt-5 flex items-center gap-5 text-[10px] tracking-[0.3em] uppercase"
                >
                  <span className="text-pl">
                    {aside.failed
                      ? "couldn't set the related thought aside"
                      : "related thought set aside"}
                  </span>
                  {!aside.failed && (
                    <button
                      type="button"
                      onClick={undo}
                      className="text-pt transition-colors hover:text-ink"
                    >
                      undo
                    </button>
                  )}
                </div>
              )}

            </div>

            <StatusFooter thoughtId={view._id} status={view.status} />
          </section>
        )}
      </div>
    </main>
  );
}

// The thought in its own proportions before its words arrive: the same
// centered column, the same line boxes, the same word waiting at the
// bottom edge — so nothing moves when it lands. Stillness has no spinners.
//
// Only what every thought has is drawn. Where it landed, when it was
// returned to, what it sits near are all conditional, and a skeleton that
// guesses them wrong moves the page more than one that leaves them out.
function ThoughtSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="loading thought"
      className="mx-auto flex w-full max-w-[64ch] flex-1 flex-col items-center px-6"
    >
      {/* two line boxes of the thought's own type, held at the center the
          way the thought itself will be */}
      <div className="flex w-full flex-1 flex-col items-center justify-center py-12">
        <div className="flex w-full max-w-[36ch] flex-col items-center gap-[30px]">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[62%]" />
        </div>
      </div>

      {/* the one word waiting at the bottom edge */}
      <div className="flex w-full max-w-[48ch] justify-center pb-14">
        <span className="flex h-4 items-center">
          <Skeleton className="h-[9px] w-20" />
        </span>
      </div>
    </section>
  );
}

// One quiet action, and the way back from it. Optional single line about
// where it landed; reversible — some thoughts wake up.
//
// Both transitions land in the view the moment they're clicked, which is why
// they share a component: the flip decides which control shows, and if that
// swap unmounted anything it would take the typed note, and the line that
// says the attempt failed, with it.
function StatusFooter({
  thoughtId,
  status,
}: {
  thoughtId: Id<"thoughts">;
  status: "open" | "resting";
}) {
  const rest = useMutation(api.thoughts.rest).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.thoughts.view, {
        thoughtId: args.thoughtId,
      });
      if (!current) return;
      localStore.setQuery(
        api.thoughts.view,
        { thoughtId: args.thoughtId },
        {
          ...current,
          status: "resting",
          restedAt: Date.now(),
          restingNote: args.note?.trim() || undefined,
        },
      );
    },
  );
  const wake = useMutation(api.thoughts.wake).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.thoughts.view, {
        thoughtId: args.thoughtId,
      });
      if (!current) return;
      localStore.setQuery(
        api.thoughts.view,
        { thoughtId: args.thoughtId },
        {
          ...current,
          status: "open",
          restedAt: undefined,
          restingNote: undefined,
        },
      );
    },
  );
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<"rest" | "wake" | null>(null);
  // Between the click and the door: the thought already reads as set down,
  // so the controls step out rather than offer to undo a leave in progress.
  const [leaving, setLeaving] = useState(false);

  const setDown = () => {
    setFailed(null);
    setLeaving(true);
    void rest({ thoughtId, note: note.trim() || undefined })
      .then(() => navigate({ to: "/" }))
      .catch(() => {
        setLeaving(false);
        setFailed("rest");
      });
  };

  return (
    <footer className="flex w-full max-w-[48ch] flex-col items-center gap-4 pb-14">
      {leaving ? null : status === "resting" ? (
        <button
          type="button"
          onClick={() => {
            setFailed(null);
            void wake({ thoughtId }).catch(() => setFailed("wake"));
          }}
          className="text-[11px] tracking-[0.3em] text-pl uppercase transition-colors hover:text-ink"
        >
          wake
        </button>
      ) : asking ? (
        <>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setDown();
              if (e.key === "Escape") setAsking(false);
            }}
            autoFocus
            placeholder="where it landed — optional"
            className="w-full max-w-[40ch] bg-transparent text-center text-[15px] font-normal outline-none placeholder:text-pl"
          />
          <div className="flex items-center gap-7 text-[11px] tracking-[0.3em] uppercase">
            <button
              type="button"
              onClick={setDown}
              className="text-ink transition-opacity hover:opacity-70"
            >
              set it down
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="text-pl transition-colors hover:text-ink"
            >
              not yet
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="text-[11px] tracking-[0.3em] text-pl uppercase transition-colors hover:text-ink"
        >
          let it rest
        </button>
      )}
      {failed && (
        <span className="text-[10px] tracking-[0.3em] text-pl uppercase">
          {failed === "rest"
            ? "couldn't set it down — try again"
            : "couldn't wake it — try again"}
        </span>
      )}
    </footer>
  );
}
