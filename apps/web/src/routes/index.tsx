import { SignOutButton } from "@clerk/clerk-react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({ component: Capture });

// The web capture input obeys the same rules as iOS: one field, keep,
// no questions asked. Verbatim in; a single vermilion dot acknowledges.
function Capture() {
  const capture = useMutation(api.thoughts.capture);
  const count = useQuery(api.thoughts.count);
  const [text, setText] = useState("");
  const [kept, setKept] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const keep = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    if (areaRef.current) areaRef.current.style.height = "auto";
    setKept(true);
    window.setTimeout(() => setKept(false), 1100);
    // Fire and forget: Convex queues the mutation if offline. Capture
    // must never fail visibly.
    void capture({ text: trimmed }).catch(() => {});
  };

  const time = now
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false })
    .toLowerCase();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="grid grid-cols-3 items-baseline px-8 pt-7">
        <SignOutButton>
          <button
            type="button"
            className="justify-self-start text-[10px] tracking-[0.26em] text-pl uppercase transition-colors hover:text-ink"
          >
            sign out
          </button>
        </SignOutButton>
        <span className="justify-self-center text-[11px] tracking-[0.5em] text-pt uppercase">
          drft
        </span>
        <span className="justify-self-end text-[11px] tracking-[0.1em] text-pl tabular-nums">
          {count || ""}
        </span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6">
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
              keep();
            }
          }}
          autoFocus
          rows={1}
          className="w-full max-w-[36ch] resize-none overflow-hidden bg-transparent text-center text-[19px] leading-[1.65] font-light outline-none"
        />
        <div className="mt-6 flex h-3 items-center justify-center">
          {kept ? (
            <span className="size-1.5 rounded-full bg-dot" />
          ) : (
            <span className="text-[10px] tracking-[0.3em] text-pl uppercase">
              {time} · unfiled
            </span>
          )}
        </div>
      </section>

      <footer className="flex items-center justify-center pb-12">
        <button
          type="button"
          onClick={keep}
          disabled={!text.trim()}
          className="flex items-center gap-2 text-[11px] tracking-[0.3em] text-ink uppercase transition-opacity disabled:opacity-45"
        >
          <span className="size-1.5 rounded-full bg-dot" />
          keep
        </button>
      </footer>
    </main>
  );
}
