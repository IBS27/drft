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
// under the thought.
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
  const field = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  // The last text the server accepted (null after a failure: unknown, so
  // the next save must send) and the latest typed — refs, so blur and
  // unmount can flush without a stale closure.
  const saved = useRef<string | null>(notes);
  const latest = useRef(notes);
  const timer = useRef<number | undefined>(undefined);

  const save = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const value = latest.current;
    if (value === saved.current) return;
    saved.current = value;
    setFailed(false);
    void setNotes({ thoughtId, text: value }).catch(() => {
      // Only the newest write speaks for the field; an older one failing
      // after a newer one went through changes nothing.
      if (saved.current !== value) return;
      saved.current = null;
      setFailed(true);
    });
  };

  const change = (value: string) => {
    setText(value);
    latest.current = value;
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
  // never the field.
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
    <div className="group mt-9 flex w-full max-w-[36ch] flex-col items-center gap-2.5 xl:fixed xl:inset-y-0 xl:right-0 xl:mt-0 xl:w-80 xl:max-w-none xl:items-stretch xl:overflow-y-auto xl:px-8 xl:pt-24 xl:pb-10">
      <label
        htmlFor="thought-notes"
        className="text-[10.5px] tracking-[0.34em] text-faint uppercase transition-colors group-focus-within:text-pt"
      >
        notes
      </label>
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
        className="w-full resize-none overflow-hidden bg-transparent text-center text-[15px] leading-[1.7] font-normal text-mut outline-none focus:text-pt xl:text-left"
      />
      {failed && (
        <div
          role="status"
          className="flex items-center gap-5 text-[10px] tracking-[0.3em] uppercase xl:pt-2"
        >
          <span className="text-pl">couldn't save your notes</span>
          <button
            type="button"
            onClick={() => {
              saved.current = null;
              save();
            }}
            className="text-pt transition-colors hover:text-ink"
          >
            retry
          </button>
        </div>
      )}
    </div>
  );
}
