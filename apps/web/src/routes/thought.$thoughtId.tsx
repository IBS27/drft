import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ageLabel, dateLine, firstLine, groupOf } from "../features/thoughts/format";
import { Rail } from "../features/thoughts/Rail";
import { useThoughtPrewarm } from "../features/thoughts/useThoughtPrewarm";
import { BackLink } from "../features/ui/BackLink";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/thought/$thoughtId")({
  component: ThoughtView,
  errorComponent: NotHere,
});

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
  withRail = false,
}: {
  label?: string;
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
        {label ?? ""}
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
  const view = useQuery(api.thoughts.view, { thoughtId: id });
  const conversation = usePaginatedQuery(
    api.thoughts.conversation,
    { thoughtId: id },
    { initialNumItems: 40 },
  );
  const markSeen = useMutation(api.thoughts.markQuestionsSeen);
  const dismissConn = useMutation(api.thoughts.dismissConnection);
  const undismissConn = useMutation(api.thoughts.undismissConnection);
  const prewarm = useThoughtPrewarm();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
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
    if (hasUnseen) void markSeen({ thoughtId: id }).catch(() => {});
  }, [hasUnseen, markSeen, id]);

  // While the partner's reply streams in, keep its words on screen — but
  // only if the reader is already at the bottom; scrolling up to reread
  // is never fought.
  const messages = useMemo(
    () => conversation.results.toReversed(),
    [conversation.results],
  );
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
  // path back, same as everything else here.
  const [aside, setAside] = useState<
    { id: Id<"connections">; failed: boolean } | null
  >(null);
  const asideTimer = useRef<number | undefined>(undefined);
  const dismiss = (connectionId: Id<"connections">) => {
    window.clearTimeout(asideTimer.current);
    void dismissConn({ connectionId })
      .then(() => setAside({ id: connectionId, failed: false }))
      .catch(() => setAside({ id: connectionId, failed: true }));
    asideTimer.current = window.setTimeout(() => setAside(null), 8000);
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
        withRail
      />
      <Rail activeId={id} now={now} />

      <div className="flex-1 lg:pl-72 xl:pl-80">
        {view === undefined ? (
          <section
            aria-busy="true"
            aria-label="loading thought"
            className="flex min-h-[70dvh] items-center justify-center"
          >
            <span className="caret h-5 w-px bg-faint" />
          </section>
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
            {messages.length > 0 &&
              conversation.status !== "Exhausted" && (
                <button
                  type="button"
                  disabled={conversation.status === "LoadingMore"}
                  onClick={() => conversation.loadMore(40)}
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
                    onClick={() => dismiss(c._id)}
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

          {view.status === "open" ? (
            <>
              <Composer thoughtId={view._id} />
              <RestControl thoughtId={view._id} />
            </>
          ) : (
            <WakeControl thoughtId={view._id} />
          )}
          </section>
        )}
      </div>
    </main>
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
// partner's reply streams back through the same reactive view query.
function Composer({ thoughtId }: { thoughtId: Id<"thoughts"> }) {
  const say = useMutation(api.thoughts.say);
  const [text, setText] = useState("");
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

// One quiet action. Optional single line about where it landed.
function RestControl({ thoughtId }: { thoughtId: Id<"thoughts"> }) {
  const rest = useMutation(api.thoughts.rest);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  const setDown = () => {
    setFailed(false);
    void rest({ thoughtId, note: note.trim() || undefined })
      .then(() => navigate({ to: "/" }))
      .catch(() => setFailed(true));
  };

  return (
    <footer className="mt-16 flex flex-col items-center gap-4">
      {asking ? (
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
          couldn't set it down — try again
        </span>
      )}
    </footer>
  );
}

// Rest is reversible with one click; some thoughts wake up.
function WakeControl({ thoughtId }: { thoughtId: Id<"thoughts"> }) {
  const wake = useMutation(api.thoughts.wake);
  const [failed, setFailed] = useState(false);
  return (
    <footer className="mt-16 flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          void wake({ thoughtId }).catch(() => setFailed(true));
        }}
        className="text-[11px] tracking-[0.3em] text-pl uppercase transition-colors hover:text-ink"
      >
        wake
      </button>
      {failed && (
        <span className="text-[10px] tracking-[0.3em] text-pl uppercase">
          couldn't wake it — try again
        </span>
      )}
    </footer>
  );
}
