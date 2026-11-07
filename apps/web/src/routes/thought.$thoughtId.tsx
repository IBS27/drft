import { ArrowBendUpLeft, BookmarkSimple, CaretRight, Moon, Sun, X } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHold } from "../features/held/useHold";
import { ageLabel, dateLine, heldAge, returnedLabel } from "../features/thoughts/format";
import { NotesField } from "../features/thoughts/NotesField";
import { Rail } from "../features/thoughts/Rail";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { BackLink } from "../features/ui/BackLink";
import { Skeleton } from "../features/ui/Skeleton";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

// `from=held` when opened from the Held page, so the way back (and Esc)
// returns to the table rather than home.
type ThoughtSearch = { from?: "held" };

export const Route = createFileRoute("/thought/$thoughtId")({
  component: ThoughtView,
  errorComponent: NotHere,
  validateSearch: (search: Record<string, unknown>): ThoughtSearch =>
    search.from === "held" ? { from: "held" } : {},
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
  backTo = "/",
}: {
  label?: string;
  loading?: boolean;
  backTo?: "/" | "/held";
}) {
  // On the thought's own column: the way back, then when it was written.
  return (
    <header className="mx-auto flex h-[72px] w-full max-w-[688px] items-center gap-1.5 px-1.5 md:px-[30px]">
      <BackLink to={backTo} />
      <span className="text-[14px] text-pl">
        {loading ? <Skeleton className="h-[9px] w-28" /> : (label ?? "")}
      </span>
    </header>
  );
}

// One column, read top to bottom: your words exactly as captured (smaller
// the longer they run), where the thought has been (returned to, set down),
// what you can do with it (hold, let rest), your notes on their ruled
// lines, and what it turned out to be near. On wide screens the collection
// stays in the periphery as an edge rail.
function ThoughtView() {
  const { thoughtId } = Route.useParams();
  const { from } = Route.useSearch();
  const backTo = from === "held" ? "/held" : "/";
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
      <Rail activeId={id} now={now} backTo={backTo} />

      <div className="flex flex-1 flex-col lg:pl-72 xl:pl-80">
        <BackHeader
          label={view ? dateLine(view.createdAt, now) : undefined}
          loading={view === undefined}
          backTo={backTo}
        />
        {view === undefined ? (
          <ThoughtSkeleton />
        ) : view === null ? (
          <section className="flex flex-1 items-center justify-center pb-24">
            <span className="text-[15px] text-pl">This thought isn't here.</span>
          </section>
        ) : (
          <section
            key={view._id}
            className="mx-auto flex w-full max-w-[688px] flex-1 flex-col px-4 md:px-10"
          >
            <div className="group/thought flex w-full flex-col pt-4 pb-2 md:pt-[6vh]">
              <h1
                className={`font-normal text-pretty whitespace-pre-wrap text-ink ${
                  view.text.length > 240
                    ? "text-[19px] leading-[1.55] tracking-[-0.008em] md:text-[21px]"
                    : view.text.length > 90
                      ? "text-[23px] leading-[1.4] tracking-[-0.016em] md:text-[28px]"
                      : "max-w-[24ch] text-[27px] leading-[1.32] tracking-[-0.024em] md:text-[38px]"
                }`}
              >
                {view.text}
              </h1>

              <div className="mt-[18px] flex flex-wrap items-center gap-x-4 gap-y-2">
                {view.lastReturnedAt && (
                  <span
                    className={`inline-flex h-7 items-center gap-1.5 text-[13px] ${
                      returnedLabel(view.lastReturnedAt, now) === "today" ? "text-dot-ink" : "text-pl"
                    }`}
                  >
                    <ArrowBendUpLeft aria-hidden="true" className="text-[14px]" />
                    Returned {returnedLabel(view.lastReturnedAt, now)}
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

              {/* What you can do with it, together: hold it close, or let
                  it rest (wake it, once it has). */}
              <StatusFooter
                thoughtId={view._id}
                status={view.status}
                hold={
                  view.status === "open" ? (
                    <HoldChip thoughtId={view._id} heldAt={view.heldAt} now={now} />
                  ) : null
                }
              />

              {view.status === "resting" && view.restingNote && (
                <p className="mt-3 max-w-[44ch] text-[15px] leading-[1.6] text-pl">
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
                <div className="mt-8 flex w-full flex-col gap-3">
                  <h2 className="text-[14px] font-medium text-pt">Related thoughts</h2>
                  <ul className="rounded-[14px] bg-scr p-1.5 ring-1 ring-line ring-inset">
                    {view.connections.map((c, i) => (
                      <li
                        key={c._id}
                        className={`group relative rounded-card transition-colors hover:bg-tint ${i > 0 ? "divided" : ""}`}
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
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-card py-[13px] pr-2.5 pl-3 text-left"
                        >
                          <span className="text-[15px] leading-[1.45] whitespace-pre-wrap text-ink">
                            {c.otherText}
                          </span>
                          {c.otherStatus === "resting" ? (
                            <span className="inline-flex items-center gap-1 text-[13px] text-pl transition-opacity group-hover:opacity-0 [@media(hover:none)]:group-hover:opacity-100">
                              <Moon aria-hidden="true" className="text-[13px]" />
                              Set down
                            </span>
                          ) : (
                            <span className="text-right text-[13px] text-pl tabular-nums transition-opacity group-hover:opacity-0 [@media(hover:none)]:group-hover:opacity-100">
                              {ageLabel(c.otherCreatedAt, now)}
                            </span>
                          )}
                          <CaretRight
                            aria-hidden="true"
                            className="text-[13px] text-pl transition-opacity group-hover:opacity-0 [@media(hover:none)]:group-hover:opacity-100"
                          />
                        </Link>
                        <button
                          type="button"
                          onClick={() => dismiss(c, i)}
                          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[16px] text-pl opacity-0 transition-[color,background-color,opacity] group-hover:opacity-100 hover:bg-tint-2 hover:text-dot-ink focus-visible:opacity-100 [@media(hover:none)]:hidden"
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

            <div className="pb-16" />
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
      className="mx-auto flex w-full max-w-[688px] flex-1 flex-col px-4 md:px-10"
    >
      <div className="flex w-full flex-col pt-4 pb-2 md:pt-[6vh]">
        <div className="flex w-full max-w-[24ch] flex-col gap-[19px] text-[27px] md:gap-[31px] md:text-[38px]">
          <Skeleton className="h-[18px] w-full" />
          <Skeleton className="h-[18px] w-[62%]" />
        </div>
      </div>

      <div className="flex w-full justify-start pt-10 pb-16">
        <Skeleton className="h-10 w-[124px]" />
      </div>


    </section>
  );
}

// The thought's actions, in one row under it: Hold (passed in) and "Let it
// rest" as quiet pills, an optional single line about where it landed, and
// "Wake" to reverse it, since some thoughts wake up.
//
// Both transitions land in the view the moment they're clicked, which is why
// they share a component: the flip decides which control shows, and if that
// swap unmounted anything it would take the typed note, and the line that
// says the attempt failed, with it.
function StatusFooter({
  thoughtId,
  status,
  hold,
}: {
  hold: ReactNode;
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
          heldAt: undefined,
        },
      );
      // Setting a thought down lets go of it.
      const held = localStore.getQuery(api.thoughts.held, {});
      if (held)
        localStore.setQuery(
          api.thoughts.held,
          {},
          held.filter((card) => card._id !== args.thoughtId),
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
    "inline-flex h-9 items-center gap-2 rounded-full bg-scr px-4 text-[14px] font-medium text-pt ring-1 ring-line ring-inset transition-[background-color,color,box-shadow,scale] hover:bg-tint hover:text-ink hover:ring-dot-edge active:scale-[0.98]";

  return (
    <div className="mt-5 flex w-full flex-col items-start gap-3">
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
          {hold}
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
        <div className="flex flex-wrap items-center gap-2">
          {hold}
          <button type="button" onClick={() => setAsking(true)} className={outline}>
            <Moon aria-hidden="true" className="text-[15px]" />
            Let it rest
          </button>
        </div>
      )}
      {failed && (
        <span role="status" className="text-[13px] text-dot-ink">
          {failed === "rest"
            ? "Couldn't set it down. Try again."
            : "Couldn't wake it. Try again."}
        </span>
      )}
    </div>
  );
}

// Hold, beside the thought's other chips. Until it's held it's a dashed
// "Hold" that shows while you're on the thought (always, on touch); held,
// a solid chip that says since when. Clicking it again lets go. h does
// the same from anywhere on the page.
function HoldChip({
  thoughtId,
  heldAt,
  now,
}: {
  thoughtId: Id<"thoughts">;
  heldAt: number | undefined;
  now: number;
}) {
  const toggle = useHold();
  const held = heldAt !== undefined;
  const age = held ? heldAge(heldAt, now).long : "";
  return (
    <button
      type="button"
      data-hold-id={thoughtId}
      data-held-at={heldAt ?? ""}
      data-hold-default=""
      onClick={() => toggle(thoughtId, heldAt)}
      aria-pressed={held}
      aria-label={held ? `Held ${age}. Let go` : "Hold this thought"}
      title={held ? "Let go (h)" : "Hold (h)"}
      className={
        held
          ? // Pressed: a soft fill, no edge, so it reads as a state you can undo.
            "inline-flex h-9 items-center gap-2 rounded-full bg-line/60 px-4 text-[14px] font-medium text-ink transition-colors hover:bg-line"
          : "inline-flex h-9 items-center gap-2 rounded-full bg-scr px-4 text-[14px] font-medium text-pt ring-1 ring-line ring-inset transition-[color,box-shadow,background-color] hover:bg-tint hover:text-ink hover:ring-dot-edge"
      }
    >
      <BookmarkSimple
        aria-hidden="true"
        weight={held ? "fill" : "regular"}
        className="text-[14px]"
      />
      {held ? "Held" : "Hold"}
      {held && <span className="font-normal text-pl tabular-nums">· {age}</span>}
    </button>
  );
}
