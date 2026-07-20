import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { Fragment, useEffect, useRef, useState } from "react";
import { ageLabel, dateLine, firstLine } from "../features/thoughts/format";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

export const Route = createFileRoute("/thought/$thoughtId")({
  component: ThoughtView,
  errorComponent: NotHere,
});

function NotHere() {
  return (
    <main className="flex min-h-dvh flex-col">
      <BackHeader />
    </main>
  );
}

function BackHeader({ label }: { label?: string }) {
  return (
    <header className="grid grid-cols-3 items-baseline px-8 pt-7">
      <Link
        to="/"
        className="justify-self-start text-[18px] leading-none text-pl transition-colors hover:text-ink"
      >
        ‹
      </Link>
      <span className="justify-self-center text-[11.5px] tracking-[0.4em] text-pl uppercase">
        {label ?? ""}
      </span>
      <span />
    </header>
  );
}

// Your words sit large at the top, exactly as captured. Below, quietly,
// what accumulated while you were away.
function ThoughtView() {
  const { thoughtId } = Route.useParams();
  const id = thoughtId as Id<"thoughts">;
  const view = useQuery(api.thoughts.view, { thoughtId: id });
  const markSeen = useMutation(api.thoughts.markQuestionsSeen);
  const [now] = useState(() => new Date());

  // Arriving is what sees the questions; the dot in the collection goes out.
  const hasUnseen = view?.questions.some((q) => !q.seen) ?? false;
  useEffect(() => {
    if (hasUnseen) void markSeen({ thoughtId: id }).catch(() => {});
  }, [hasUnseen, markSeen, id]);

  if (view === undefined) return <main className="min-h-dvh" />;
  if (view === null) return <NotHere />;

  const hasMargin = view.questions.length > 0 || view.messages.length > 0;

  return (
    <main className="flex min-h-dvh flex-col">
      <BackHeader label={dateLine(view.createdAt, now)} />

      <section className="mx-auto flex w-full max-w-[64ch] flex-1 flex-col items-center px-6 pt-16 pb-10">
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

        {hasMargin && <div className="mt-10 mb-1 h-7 w-px bg-line" />}

        <div className="w-full max-w-[52ch] text-center">
          {view.questions.map((q) => (
            <Fragment key={q._id}>
              <Who>partner</Who>
              <Msg muted>{q.text}</Msg>
            </Fragment>
          ))}
          {view.messages.map((m) => (
            <Fragment key={m._id}>
              <Who>{m.role}</Who>
              <Msg muted={m.role === "partner"}>{m.text}</Msg>
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
                  className="inline-block max-w-[26ch] truncate text-[11.5px] tracking-[0.22em] text-pl uppercase transition-colors hover:text-ink"
                >
                  {firstLine(c.otherText)}
                </Link>
                <DismissConnection connectionId={c._id} />
              </span>
            ))}
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
    </main>
  );
}

function Who({ children }: { children: string }) {
  return (
    <div className="mt-8 mb-2.5 text-[10.5px] tracking-[0.34em] text-pl uppercase">
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

function DismissConnection({ connectionId }: { connectionId: Id<"connections"> }) {
  const dismiss = useMutation(api.thoughts.dismissConnection);
  return (
    <button
      type="button"
      onClick={() => void dismiss({ connectionId }).catch(() => {})}
      className="text-[13px] leading-none text-pl opacity-0 transition-opacity group-hover:opacity-100 hover:text-dot"
      aria-label="dismiss connection"
    >
      ×
    </button>
  );
}

// A single input: think out loud. Enter keeps it, like capture; the
// partner stays silent until phase 3.
function Composer({ thoughtId }: { thoughtId: Id<"thoughts"> }) {
  const say = useMutation(api.thoughts.say);
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    if (areaRef.current) areaRef.current.style.height = "auto";
    void say({ thoughtId, text: trimmed }).catch(() => {});
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
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
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

  const setDown = () => {
    void rest({ thoughtId, note: note.trim() || undefined })
      .then(() => navigate({ to: "/" }))
      .catch(() => {});
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
    </footer>
  );
}

// Rest is reversible with one click; some thoughts wake up.
function WakeControl({ thoughtId }: { thoughtId: Id<"thoughts"> }) {
  const wake = useMutation(api.thoughts.wake);
  return (
    <footer className="mt-16 flex justify-center">
      <button
        type="button"
        onClick={() => void wake({ thoughtId }).catch(() => {})}
        className="text-[11px] tracking-[0.3em] text-pl uppercase transition-colors hover:text-ink"
      >
        wake
      </button>
    </footer>
  );
}
