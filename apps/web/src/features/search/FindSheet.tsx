import { useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useThoughtPrewarm } from "../thoughts/useThoughtPrewarm";
import { FindResults } from "./FindResults";
import { OPEN_SEARCH_EVENT } from "./openSearch";
import { hitOptionId, useThoughtSearch, type Hit } from "./useThoughtSearch";

// Where the rail is off screen — narrow windows, and pages without one —
// find drops in as a slim bar under the top edge instead of taking the
// room over; everything beneath stays where it was. When the rail is
// visible it owns find (see Rail) and this surface stays dormant.
export function FindSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const railHandlesFind = () =>
      window.matchMedia("(min-width: 64rem)").matches &&
      document.querySelector("[data-rail-find]") !== null;
    const onOpen = () => {
      if (!railHandlesFind()) setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      // An open sheet owns its keys wherever focus sits — it may have
      // been opened before a resize handed the breakpoint to the rail,
      // or focus may have tabbed out of it.
      if (open) {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
          setOpen(false);
        } else if (e.key === "Escape") {
          setOpen(false);
        }
        return;
      }
      if (railHandlesFind()) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;
  return <Sheet close={() => setOpen(false)} />;
}

function Sheet({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const prewarm = useThoughtPrewarm();
  const [query, setQuery] = useState("");
  const { hits, active, setActive, onResultsKey } = useThoughtSearch(query);
  const listboxId = useId();
  const [now] = useState(() => Date.now());
  const sheetRef = useRef<HTMLDivElement>(null);

  const go = (hit: Hit) => {
    prewarm(hit._id);
    close();
    void navigate({ to: "/thought/$thoughtId", params: { thoughtId: hit._id } });
  };

  // aria-modal promises focus stays inside, so Tab wraps at the
  // sheet's edges instead of wandering to the page beneath.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab") return;
    const nodes = sheetRef.current?.querySelectorAll<HTMLElement>(
      "input, button",
    );
    if (!nodes || nodes.length === 0) return;
    const edge = e.shiftKey ? nodes[0] : nodes[nodes.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    (e.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus();
  };

  return (
    <div
      ref={sheetRef}
      data-overlay
      role="dialog"
      aria-modal="true"
      aria-label="find a thought"
      className="fixed inset-0 z-50"
      onKeyDown={trapTab}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="border-b border-line bg-scr">
        <div className="mx-auto w-full max-w-xl px-6">
          <div className="relative flex items-center gap-3 py-4">
            {!query && (
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[10.5px] tracking-[0.3em] text-pl uppercase">
                find a thought
              </span>
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => onResultsKey(e, go)}
              autoFocus
              aria-label="find a thought"
              role="combobox"
              aria-expanded={query.trim() !== ""}
              aria-controls={listboxId}
              aria-activedescendant={
                hits && hits[active]
                  ? hitOptionId(listboxId, active)
                  : undefined
              }
              className="min-w-0 flex-1 bg-transparent text-[16px] font-normal outline-none"
            />
            <button
              type="button"
              onClick={close}
              className="flex-none text-[9.5px] tracking-[0.16em] text-pl uppercase transition-colors hover:text-ink"
            >
              esc
            </button>
          </div>
          {query.trim() !== "" && (
            <div className="-mx-3 max-h-[60dvh] overflow-y-auto px-3 pb-3">
              <FindResults
                hits={hits}
                active={active}
                setActive={setActive}
                now={now}
                go={go}
                prewarm={prewarm}
                listboxId={listboxId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
