import { Check } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";

const SAVE_DELAY_MS = 600;
// Mirrors NOTES_LIMIT in convex/thoughts.ts.
const NOTES_LIMIT = 20_000;

// Your own writing next to the thought: one field, no save button. What you
// type is the truth while you type it — the server is only told, a moment
// after you pause, and never talks back into a field you are in. On wide
// screens (xl) the field lives in the right margin opposite the rail, so
// the thought never moves however much is written; narrower, it folds in
// under the thought. Either way it is written onto ruled lines (`.ruled`
// in index.css), which grow with the field. A quiet status beside the label
// says "Saving…" while words wait to be sent and "Saved" once the latest
// ones are; it only reports, and never holds up a save.
export function NotesField({
  thoughtId,
  notes,
}: {
  thoughtId: Id<"thoughts">;
  notes: string;
}) {
  const setNotes = useMutation(api.thoughts.setNotes).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.thoughts.view, {
        thoughtId: args.thoughtId,
      });
      if (!current) return;
      localStore.setQuery(
        api.thoughts.view,
        { thoughtId: args.thoughtId },
        // The server keeps nothing for whitespace-only text.
        { ...current, notes: args.text.trim() === "" ? "" : args.text },
      );
    },
  );

  const [text, setText] = useState(notes);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const field = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  // The last text the server accepted (null after a failure: unknown, so
  // the next save must send) and the latest typed — refs, so blur and
  // unmount can flush without a stale closure.
  const saved = useRef<string | null>(notes);
  const latest = useRef(notes);
  const timer = useRef<number | undefined>(undefined);
  // Writes sent and not yet answered. The status only reads "Saved" once
  // none are out, nothing waits on the timer, and the field still holds
  // what was last sent. It follows the saves; it never steers them.
  const inFlight = useRef(0);
  const settle = () => {
    if (
      inFlight.current === 0 &&
      timer.current === undefined &&
      saved.current !== null &&
      saved.current === latest.current
    )
      setStatus("saved");
  };

  const save = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const value = latest.current;
    if (value === saved.current) {
      // Typed and then undone back to what was already sent: nothing new
      // to send, though an earlier write may still be on its way.
      setStatus((s) => (s === "saving" && inFlight.current === 0 ? "saved" : s));
      return;
    }
    saved.current = value;
    setFailed(false);
    setStatus("saving");
    inFlight.current += 1;
    void setNotes({ thoughtId, text: value })
      .then(() => {
        inFlight.current -= 1;
        settle();
      })
      .catch(() => {
        inFlight.current -= 1;
        // Only the newest write speaks for the field; an older one failing
        // after a newer one went through changes nothing.
        if (saved.current !== value) {
          settle();
          return;
        }
        saved.current = null;
        setFailed(true);
        setStatus("idle");
      });
  };

  const change = (value: string) => {
    setText(value);
    latest.current = value;
    setStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, SAVE_DELAY_MS);
  };

  // Another tab, another device: take the server's word only when this
  // field is idle with nothing unsaved — never over what is being typed,
  // waiting to send, or still unsent after a failure.
  useEffect(() => {
    if (focused.current || timer.current !== undefined) return;
    if (saved.current !== latest.current || notes === latest.current) return;
    saved.current = notes;
    latest.current = notes;
    setText(notes);
  }, [notes]);

  // Leaving — the thought (the parent remounts per id), the page, or the
  // tab — flushes whatever is still waiting.
  const flush = useRef(save);
  flush.current = save;
  useEffect(() => {
    const onLeave = () => flush.current();
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      flush.current();
    };
  }, []);

  // Grows with its content, and re-measures when its width changes (the
  // column is a different width on each side of xl); the page scrolls,
  // never the field. The measure includes the ruled padding below the
  // text, so there are always empty lines left to write on.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="group mt-9 flex w-full max-w-[36ch] flex-col gap-2.5 xl:fixed xl:inset-y-0 xl:right-0 xl:mt-0 xl:w-80 xl:max-w-none xl:overflow-y-auto xl:border-l xl:border-line xl:bg-scr xl:px-[22px] xl:pt-6 xl:pb-10">
      <div className="flex h-6 items-center justify-between gap-3 pl-[18px]">
        <label
          htmlFor="thought-notes"
          className="text-[14px] font-medium text-pt transition-colors group-focus-within:text-ink"
        >
          Notes
        </label>
        {/* Not a live region: announcing every pause would be noise. Only
            a failure speaks up (role="status" below). While one stands,
            it is the whole story, so the status steps aside. */}
        <span className="inline-flex items-center gap-1 text-[12.5px] text-pl">
          {failed ? null : status === "saving" ? (
            "Saving…"
          ) : status === "saved" ? (
            <>
              <Check aria-hidden="true" className="text-[13px]" />
              Saved
            </>
          ) : null}
        </span>
      </div>
      <textarea
        id="thought-notes"
        ref={field}
        value={text}
        rows={1}
        maxLength={NOTES_LIMIT}
        onChange={(e) => change(e.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          // Whitespace alone is nothing — the server keeps no row for it —
          // so once the field is left, it shows nothing too. Sent as its own
          // write, so a failure is still caught and offered for retry.
          if (latest.current.trim() === "") {
            latest.current = "";
            setText("");
          }
          save();
        }}
        className="ruled w-full resize-none overflow-hidden text-[15px] text-ink outline-none"
      />
      {failed && (
        <div
          role="status"
          className="flex items-center gap-2 pl-[18px] text-[13px]"
        >
          <span className="text-dot-ink">Couldn't save your notes.</span>
          <button
            type="button"
            onClick={() => {
              saved.current = null;
              save();
            }}
            className="rounded-full px-2.5 py-1 font-medium text-ink transition-colors hover:bg-tint"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
