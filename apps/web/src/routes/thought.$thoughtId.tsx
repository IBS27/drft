import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ageLabel, dateLine, firstLine, groupOf } from "../features/thoughts/format";
import { Rail } from "../features/thoughts/Rail";
import {
  CONVERSATION_PAGE_SIZE,
  conversationPageArgs,
  useThoughtPrewarm,
} from "../features/thoughts/useThoughtPrewarm";
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
type Message =
  FunctionReturnType<typeof api.thoughts.conversation>["page"][number];

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

// Your words sit large at the top, exactly as captured. Below, quietly,
// what accumulated while you were away. On wide screens the collection
// stays in the periphery as an edge rail.
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
  const conversation = usePaginatedQuery(
    api.thoughts.conversation,
    isAuthenticated ? { thoughtId: id } : "skip",
    { initialNumItems: CONVERSATION_PAGE_SIZE },
  );
  // The paginated hook's first page carries a per-hook id, so hovering can't
  // warm it — it always costs a round trip after arrival. The same page read
  // plainly *can* be warmed (useThoughtPrewarm), so it holds the margin for
  // the moment before the hook delivers, then steps aside: identical rows,
  // identical keys, no swap to see. Its subscription is dropped after.
  const paged = conversation.status !== "LoadingFirstPage";
  const preview = useQuery(
    api.thoughts.conversation,
    isAuthenticated && !paged ? conversationPageArgs(id) : "skip",
  );
  const markSeen = useMutation(api.thoughts.markQuestionsSeen);
  const prewarm = useThoughtPrewarm();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // What was waiting when you walked in keeps its dot for this visit —
  // the margin's way of saying which questions are new. Keyed by thought:
  // the router reuses this component when only the param changes.
  const arrivedUnseen = useRef<{ id: Id<"thoughts">; ids: Set<string> } | null>(
    null,
  );
  if (view && arrivedUnseen.current?.id !== id) {
    arrivedUnseen.current = {
      id,
      ids: new Set(view.questions.filter((q) => !q.seen).map((q) => q._id)),
    };
  }

  // Arriving is what sees the questions; the dot in the collection goes out.
  const hasUnseen = view?.questions.some((q) => !q.seen) ?? false;
  useEffect(() => {
    if (isAuthenticated && hasUnseen)
      void markSeen({ thoughtId: id }).catch(() => {});
  }, [isAuthenticated, hasUnseen, markSeen, id]);

  // While the partner's reply streams in, keep its words on screen — but
  // only if the reader is already at the bottom; scrolling up to reread
  // is never fought.
  const messages = useMemo(() => {
    const newestFirst: Message[] = paged
      ? conversation.results
      : (preview?.page ?? []);
    return newestFirst.toReversed();
  }, [paged, conversation.results, preview]);
  const tail = messages[messages.length - 1];
  const streamText = tail?.role === "partner" ? tail.text : null;
  // Only words arriving *during this visit* pull the page down — walking
  // into a thought whose last word is the partner's must not jump. The
  // ref remembers the last tail per thought; the first sight of a thought
  // (or of a finished reply) records without scrolling.
  const lastStream = useRef<{ id: Id<"thoughts">; text: string } | null>(null);
  useEffect(() => {
    if (streamText === null || streamText === undefined) return;
    const prev = lastStream.current;
    lastStream.current = { id, text: streamText };
    if (!prev || prev.id !== id || prev.text === streamText) return;
    const nearBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 240;
    if (nearBottom)
      window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [streamText, id]);

  // A dismissed link lingers for a moment as an undo — the one-click
  // path back, same as everything else here. The click takes it out of the
  // margin itself; the server only confirms. Where it sat is remembered so
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
  // The composer's words live above the composer. Setting the thought down
  // flips the status optimistically, which takes the composer off screen —
  // and if the rest then fails, the half-typed line has to be there when it
  // comes back. Only moving to another thought clears it.
  const [draft, setDraft] = useState("");

  useEffect(() => {
    // Moving to another thought (the component is reused) drops the undo.
    setAside(null);
    setAsideRow.current = null;
    setDraft("");
    window.clearTimeout(asideTimer.current);
  }, [id]);

  const hasMargin =
    view !== undefined &&
    view !== null &&
    (view.questions.length > 0 || messages.length > 0);

  return (
    <main className="flex min-h-dvh flex-col">
      <BackHeader
        label={view ? dateLine(view.createdAt, now) : undefined}
        loading={view === undefined}
        withRail
      />
      <Rail activeId={id} now={now} />

      <div className="flex-1 lg:pl-72 xl:pl-80">
        {view === undefined ? (
          <ThoughtSkeleton />
        ) : view === null ? (
          <section className="flex min-h-[70dvh] items-center justify-center pb-24">
            <span className="text-[10.5px] tracking-[0.34em] text-pl uppercase">
              this thought isn't here
            </span>
          </section>
        ) : (
          <section
            key={view._id}
            className="mx-auto flex w-full max-w-[64ch] flex-col items-center px-6 pt-16 pb-10"
          >
            <h1 className="max-w-[36ch] text-center text-[clamp(24px,2.6vw,28px)] leading-[1.6] font-light whitespace-pre-wrap">
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

          {hasMargin && <div className="mt-10 mb-1 h-7 w-px bg-line" />}

          <div className="w-full max-w-[52ch] text-center">
            {view.questions.map((q) => (
              <Fragment key={q._id}>
                <Who dot={arrivedUnseen.current?.ids.has(q._id)}>partner</Who>
                <Msg muted>{q.text}</Msg>
              </Fragment>
            ))}
            {(conversation.status === "CanLoadMore" ||
              conversation.status === "LoadingMore") && (
              <button
                type="button"
                disabled={conversation.status === "LoadingMore"}
                onClick={() => conversation.loadMore(CONVERSATION_PAGE_SIZE)}
                className="mt-8 text-[10px] tracking-[0.3em] text-pl uppercase transition-colors hover:text-ink disabled:opacity-50"
              >
                {conversation.status === "LoadingMore" ? "loading" : "earlier"}
              </button>
            )}
            {messages.map((m) => (
              <Fragment key={m._id}>
                <Who>{m.role}</Who>
                {/* A partner row streams in from empty; until the first words
                    land, a single quiet mark holds the space. */}
                {m.role === "partner" && m.text === "" ? (
                  <p className="animate-pulse text-[16px] leading-[1.7] text-pl">·</p>
                ) : (
                  <Msg muted={m.role === "partner"}>{m.text}</Msg>
                )}
              </Fragment>
            ))}
          </div>

          {view.connections.length > 0 && (
            <div className="mt-11 flex max-w-[52ch] flex-wrap items-center justify-center gap-x-2.5 gap-y-2">
              {view.connections.map((c, i) => (
                <span key={c._id} className="group flex items-center gap-2">
                  {i > 0 && <span className="text-[11.5px] text-pl">·</span>}
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
                    className="inline-block max-w-[26ch] truncate text-[11.5px] tracking-[0.22em] text-pl uppercase transition-colors hover:text-ink"
                  >
                    {c.otherStatus === "resting" && (
                      <span className="text-faint">set down · </span>
                    )}
                    {firstLine(c.otherText)}
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismiss(c, i)}
                    className="text-[13px] leading-none text-pl opacity-0 transition-opacity group-hover:opacity-100 hover:text-dot"
                    aria-label="dismiss connection"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {aside && (
            <div className="mt-5 flex items-center gap-5 text-[10px] tracking-[0.3em] uppercase">
              <span className="text-pl">
                {aside.failed ? "couldn't set the link aside" : "link set aside"}
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

          {/* Siblings, not branches: the status flips optimistically, and a
              ternary here would remount the footer under it — taking the
              half-typed note and the error line with it. */}
          {view.status === "open" && (
            <Composer thoughtId={view._id} text={draft} setText={setDraft} />
          )}
          <StatusFooter thoughtId={view._id} status={view.status} />
          </section>
        )}
      </div>
    </main>
  );
}

// The thought in its own proportions before its words arrive: the same
// column, the same line boxes, the same hairline into the margin — so
// nothing moves when it lands. Stillness has no spinners.
function ThoughtSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="loading thought"
      className="mx-auto flex w-full max-w-[64ch] flex-col items-center px-6 pt-16 pb-10"
    >
      {/* three line boxes of the thought's own type: 28px at 1.6 */}
      <div className="flex w-full max-w-[36ch] flex-col items-center gap-[28px]">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[88%]" />
        <Skeleton className="h-4 w-[52%]" />
      </div>

      <div className="mt-10 mb-1 h-7 w-px bg-line" />

      <div className="flex w-full max-w-[52ch] flex-col items-center">
        {[0, 1].map((row) => (
          <Fragment key={row}>
            <div className="mt-8 mb-2.5 flex h-4 items-center">
              <Skeleton className="h-[7px] w-14" />
            </div>
            {/* body lines: 16px at 1.7 */}
            <div className="flex w-full flex-col items-center gap-[15px]">
              <Skeleton className={`h-3 ${row === 0 ? "w-[93%]" : "w-[81%]"}`} />
              <Skeleton className={`h-3 ${row === 0 ? "w-[58%]" : "w-[36%]"}`} />
            </div>
          </Fragment>
        ))}
      </div>

      {/* the composer's hairline and the line it waits on — the dot stays
          grey here: vermilion is only ever now, and nothing is yet. */}
      <div className="mt-14 w-full max-w-[48ch] border-t border-line pt-5">
        <div className="flex items-start gap-3">
          <Skeleton className="mt-[9px] size-2 flex-none" />
          <Skeleton className="mt-[9px] h-[9px] w-[13ch]" />
        </div>
      </div>

      <Skeleton className="mt-16 h-[9px] w-20" />
    </section>
  );
}

function Who({ children, dot }: { children: string; dot?: boolean }) {
  return (
    <div className="mt-8 mb-2.5 flex items-center justify-center gap-2 text-[10.5px] tracking-[0.34em] text-pl uppercase">
      {dot && <span className="size-1.5 rounded-full bg-dot" />}
      {children}
    </div>
  );
}

function Msg({ muted, children }: { muted?: boolean; children: string }) {
  return (
    <p
      className={`text-[16px] leading-[1.7] font-normal whitespace-pre-wrap ${
        muted ? "text-mut" : "text-ink"
      }`}
    >
      {children}
    </p>
  );
}

// A single input: think out loud. Enter sends it, like capture; the
// partner's reply streams back through the same reactive view query. What
// is typed but unsent is held by the view above, so an optimistic rest
// that turns out to have failed doesn't cost the line.
function Composer({
  thoughtId,
  text,
  setText,
}: {
  thoughtId: Id<"thoughts">;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
}) {
  // Your own words never wait on a server: they go into the conversation the
  // instant you press enter. Every loaded newest-page of this thought's
  // conversation gets the line — the paginated hook's page and the plain
  // first page the view reads while that hook is still on its way — so it
  // lands wherever the margin is currently reading from. Convex drops this
  // when the mutation resolves, by which point the real row (same position,
  // same text) is already there.
  const say = useMutation(api.thoughts.say).withOptimisticUpdate(
    (localStore, args) => {
      const trimmed = args.text.trim();
      if (!trimmed) return;
      const said = {
        _id: crypto.randomUUID() as Id<"messages">,
        role: "you" as const,
        text: trimmed,
      };
      for (const { args: pageArgs, value } of localStore.getAllQueries(
        api.thoughts.conversation,
      )) {
        if (value === undefined) continue;
        if (pageArgs.thoughtId !== args.thoughtId) continue;
        if (pageArgs.paginationOpts.cursor !== null) continue;
        localStore.setQuery(api.thoughts.conversation, pageArgs, {
          ...value,
          page: [said, ...value.page],
        });
      }
    },
  );
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Height tracks content here (not in onChange) so it also follows
  // programmatic changes: clearing on send, restoring on failure.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    void say({ thoughtId, text: trimmed }).catch(() => {
      // The words are the product — never lose them to a failed send.
      setText((current) => (current ? `${trimmed}\n${current}` : trimmed));
    });
  };

  return (
    <div className="mt-14 w-full max-w-[48ch] border-t border-line pt-5">
      <div className="flex items-start gap-3">
        <span className="mt-[9px] size-2 flex-none rounded-full bg-dot" />
        <div className="relative flex-1">
          {/* Overlay instead of a native placeholder: the browser sizes a
              placeholder's line box from its own small font, so it won't
              center on the textarea's first line the way the dot does. */}
          {!text && (
            <span className="pointer-events-none absolute top-0 left-[3px] flex h-[26px] items-center text-[11.5px] tracking-[0.28em] text-pl uppercase">
              think out loud
            </span>
          )}
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent text-[16px] leading-[1.6] font-normal outline-none"
          />
        </div>
      </div>
    </div>
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
    <footer className="mt-16 flex flex-col items-center gap-4">
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
