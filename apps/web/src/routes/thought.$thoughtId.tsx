import { ArrowBendUpLeft, Moon, Sun, X } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import { ageLabel, dateLine, groupOf } from "../features/thoughts/format";
import { NotesField } from "../features/thoughts/NotesField";
import { Rail } from "../features/thoughts/Rail";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { BackLink } from "../features/ui/BackLink";
import { Badge } from "../features/ui/Badge";
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
        <span className="text-[15px] text-pl">This thought isn't here.</span>
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
    // Spans the page over the fixed rail and notes columns, so only the way
    // back takes the pointer; the rest of the bar lets clicks through.
    <header className="pointer-events-none relative z-10 flex h-[72px] items-center px-4 md:px-5">
      {/* With the rail on screen, the way back starts where the page does,
          clear of the rail's own wordmark. */}
      <span className={`pointer-events-auto ${withRail ? "lg:ml-72 xl:ml-80" : ""}`}>
        <BackLink />
      </span>
      <span
        className={`absolute right-0 text-center text-[14px] font-medium text-pt ${
          withRail
            ? "left-0 lg:left-72 xl:right-80 xl:left-80"
            : "left-0"
        }`}
      >
        {loading ? <Skeleton className="mx-auto h-[9px] w-28" /> : (label ?? "")}
      </span>
    </header>
  );
}

// Your words hold the center of the page, exactly as captured (left-aligned
// on phones). Gathered around them as small chips, where the thought has
// been: set down, returned to. Below, your notes on their ruled lines, then
// what it turned out to be near, and one action waiting at the bottom edge.
// On wide screens the collection stays in the periphery as an edge rail.
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

      <div className="flex flex-1 flex-col lg:pl-72 xl:pr-80 xl:pl-80">
        {view === undefined ? (
          <ThoughtSkeleton />
        ) : view === null ? (
          <section className="flex flex-1 items-center justify-center pb-24">
            <span className="text-[15px] text-pl">This thought isn't here.</span>
          </section>
        ) : (
          <section
            key={view._id}
            className="mx-auto flex w-full max-w-[64ch] flex-1 flex-col px-6 md:items-center"
          >
            <div className="flex w-full flex-1 flex-col justify-center py-10 md:items-center">
              <h1 className="max-w-[26ch] text-[25px] leading-[1.38] font-[450] tracking-[-0.02em] whitespace-pre-wrap text-ink md:text-center md:text-[32px]">
                {view.text}
              </h1>

              {(view.lastReturnedAt || view.status === "resting") && (
                <div className="mt-[18px] flex flex-wrap gap-2 md:justify-center">
                  {view.lastReturnedAt && (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-tint px-3 text-[13px] font-medium text-dot-ink">
                      <ArrowBendUpLeft aria-hidden="true" className="text-[14px]" />
                      Returned{" "}
                      {groupOf(view.lastReturnedAt, now) === "today"
                        ? "today"
                        : ageLabel(view.lastReturnedAt, now)}
                    </span>
                  )}
                  {view.status === "resting" && (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-scr px-3 text-[13px] font-medium text-pt ring-1 ring-line ring-inset">
                      <Moon aria-hidden="true" className="text-[14px]" />
                      Set down
                      {view.restedAt && (
                        <span className="font-normal text-pl tabular-nums">
                          {ageLabel(view.restedAt, now)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}

              {view.status === "resting" && view.restingNote && (
                <p className="mt-3 max-w-[44ch] text-[15px] leading-[1.6] text-pl md:text-center">
                  {view.restingNote}
                </p>
              )}

              {/* Your own writing, nearest the thought; the machine's
                  connections one step further out. */}
              <NotesField thoughtId={view._id} notes={view.notes} />

              {/* Related thoughts are destinations, not tags: their words
                  keep their natural case and wrap for as long as they need.
                  Rows are parted by hairlines that give way to the hover
                  tint, the row's own and the one beneath it. */}
              {view.connections.length > 0 && (
                <div className="mt-10 w-full max-w-[520px]">
                  <h2 className="flex items-center gap-2 px-3 pb-2.5 text-[15px] font-medium text-ink">
                    Related thoughts
                    <Badge>{view.connections.length}</Badge>
                  </h2>
                  <ul>
                    {view.connections.map((c, i) => (
                      <li
                        key={c._id}
                        className="group relative rounded-card transition-colors hover:bg-tint [li+&]:shadow-[0_-1px_0_var(--line)] hover:shadow-none! [&:hover+li]:shadow-none!"
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
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-card py-[13px] pr-12 pl-3 text-left"
                        >
                          <span className="text-[15px] leading-[1.45] whitespace-pre-wrap text-ink">
                            {c.otherText}
                          </span>
                          {c.otherStatus === "resting" ? (
                            <span className="inline-flex h-[22px] items-center rounded-full px-[9px] text-[12px] text-pt ring-1 ring-line ring-inset">
                              Set down
                            </span>
                          ) : (
                            <span className="text-right text-[13px] text-pl tabular-nums">
                              {ageLabel(c.otherCreatedAt, now)}
                            </span>
                          )}
                        </Link>
                        <button
                          type="button"
                          onClick={() => dismiss(c, i)}
                          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[16px] text-pl opacity-0 transition-[color,background-color,opacity] group-hover:opacity-100 hover:bg-tint-2 hover:text-dot-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label="set related thought aside"
                        >
                          <X aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {aside && (
                <div
                  role="status"
                  className="mt-4 flex items-center gap-2 px-3 text-[13px]"
                >
                  <span className={aside.failed ? "text-dot-ink" : "text-pl"}>
                    {aside.failed
                      ? "Couldn't set the related thought aside."
                      : "Related thought set aside."}
                  </span>
                  {!aside.failed && (
                    <button
                      type="button"
                      onClick={undo}
                      className="rounded-full px-2.5 py-1 font-medium text-dot-ink transition-colors hover:bg-tint"
                    >
                      Undo
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
// column, two line boxes of the thought's own type (centered from md, left
// on phones, as the thought will be), and the pill waiting at the bottom
// edge, so nothing moves when it lands. No spinners. (The header draws its
// own date bar.)
//
// Only what every thought has is drawn. Where it landed, when it was
// returned to, what it sits near are all conditional, and a skeleton that
// guesses them wrong moves the page more than one that leaves them out.
function ThoughtSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="loading thought"
      className="mx-auto flex w-full max-w-[64ch] flex-1 flex-col px-6 md:items-center"
    >
      <div className="flex w-full flex-1 flex-col justify-center py-10 md:items-center">
        <div className="flex w-full max-w-[26ch] flex-col gap-[17px] text-[25px] md:items-center md:gap-[26px] md:text-[32px]">
          <Skeleton className="h-[18px] w-full" />
          <Skeleton className="h-[18px] w-[62%]" />
        </div>
      </div>

      <div className="flex w-full justify-center pt-6 pb-10">
        <Skeleton className="h-10 w-[124px]" />
      </div>

      {/* the notes column's own panel (NotesField at xl), already standing */}
      <div
        aria-hidden="true"
        className="fixed inset-y-0 right-0 hidden w-80 border-l border-line bg-scr xl:block"
      />
    </section>
  );
}

// One quiet action, and the way back from it: "Let it rest" as an outlined
// vermilion pill, an optional single line about where it landed, and
// "Wake" to reverse it, since some thoughts wake up.
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

  // The outlined vermilion pill both resting actions wear.
  const outline =
    "inline-flex h-10 items-center gap-2 rounded-full px-[18px] text-[14.5px] font-medium text-dot-ink ring-[1.5px] ring-dot-edge ring-inset transition-[background-color,scale] hover:bg-tint active:scale-[0.98]";

  return (
    <footer className="flex w-full max-w-[48ch] flex-col items-center gap-3 pt-6 pb-10">
      {leaving ? null : status === "resting" ? (
        <button
          type="button"
          onClick={() => {
            setFailed(null);
            void wake({ thoughtId }).catch(() => setFailed("wake"));
          }}
          className={outline}
        >
          <Sun aria-hidden="true" className="text-[16px]" />
          Wake
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
            aria-label="Where it landed (optional)"
            placeholder="Where it landed (optional)"
            className="h-11 w-full max-w-[40ch] rounded-card bg-scr px-4 text-[15px] text-ink ring-1 ring-line ring-inset outline-none transition-shadow placeholder:text-pl focus:ring-dot-edge"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={setDown}
              className="inline-flex h-10 items-center rounded-full bg-dot px-[18px] text-[14.5px] font-semibold text-on-dot transition-[filter,scale] hover:brightness-105 active:scale-[0.98]"
            >
              Set it down
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="inline-flex h-10 items-center rounded-full px-4 text-[14.5px] font-medium text-pt transition-colors hover:bg-tint hover:text-ink"
            >
              Not yet
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={outline}>
          <Moon aria-hidden="true" className="text-[16px]" />
          Let it rest
        </button>
      )}
      {failed && (
        <span role="status" className="text-[13px] text-dot-ink">
          {failed === "rest"
            ? "Couldn't set it down. Try again."
            : "Couldn't wake it. Try again."}
        </span>
      )}
    </footer>
  );
}
