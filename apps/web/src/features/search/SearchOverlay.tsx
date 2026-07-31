import { useNavigate } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { ageLabel, firstLine } from "../thoughts/format";

type Hit = {
  _id: Id<"thoughts">;
  text: string;
  status: "open" | "resting";
  createdAt: number;
};

// Find a thought the way you remember it. ⌘K (or "/" outside a field)
// opens the room's one search surface; Esc closes it. Results are the
// collection's own rows — no snippets, no highlighting, no ranking UI.
export function SearchOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return <Panel close={() => setOpen(false)} />;
}

function Panel({ close }: { close: () => void }) {
  const search = useAction(api.search.thoughts);
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [now] = useState(() => new Date());
  const seq = useRef(0);

  useEffect(() => {
    const trimmed = text.trim();
    setFailed(false);
    if (!trimmed) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    const id = window.setTimeout(() => {
      search({ query: trimmed })
        .then((rows) => {
          if (seq.current !== mine) return;
          setHits(rows);
          setActive(0);
        })
        .catch(() => {
          if (seq.current === mine) setFailed(true);
        });
    }, 250);
    return () => window.clearTimeout(id);
  }, [text, search]);

  const go = (hit: Hit) => {
    close();
    void navigate({ to: "/thought/$thoughtId", params: { thoughtId: hit._id } });
  };

  return (
    <div
      data-overlay
      className="fixed inset-0 z-50 overflow-y-auto bg-pg"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        // Esc closes from anywhere inside, not only the input.
        if (e.key === "Escape") close();
      }}
    >
      <div className="mx-auto w-full max-w-[52ch] px-6 pt-[16vh] pb-16">
        <div className="relative">
          {!text && (
            <span className="pointer-events-none absolute top-0 left-0 flex h-[32px] items-center text-[11.5px] tracking-[0.28em] text-pl uppercase">
              find a thought
            </span>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, (hits?.length ?? 1) - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && hits && hits[active]) go(hits[active]);
            }}
            autoFocus
            className="w-full bg-transparent text-[19px] leading-[1.65] font-light outline-none"
          />
        </div>

        <div className="mt-8">
          {failed ? (
            <p className="text-[10.5px] tracking-[0.3em] text-pl uppercase">
              couldn't search — try again
            </p>
          ) : hits && hits.length === 0 ? (
            <p className="text-[10.5px] tracking-[0.3em] text-pl uppercase">
              nothing found
            </p>
          ) : (
            hits?.map((h, i) => (
              <button
                key={h._id}
                type="button"
                onClick={() => go(h)}
                onMouseMove={() => setActive(i)}
                className="flex w-full items-center gap-3.5 border-b border-line py-4 text-left"
              >
                {i === active ? (
                  <span className="size-1.5 flex-none rounded-full bg-dot" />
                ) : (
                  <span className="size-1.5 flex-none" />
                )}
                <span
                  className={`flex-1 truncate text-[15px] font-normal ${
                    i === active ? "text-ink" : "text-pt"
                  }`}
                >
                  {h.status === "resting" && (
                    <span className="text-pl">set down · </span>
                  )}
                  {firstLine(h.text)}
                </span>
                <span className="flex-none text-[12px] tracking-[0.08em] text-pl tabular-nums">
                  {ageLabel(h.createdAt, now)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
