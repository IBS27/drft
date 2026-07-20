import { useMutation } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useRef, useState } from "react";

// The web capture input obeys the same rules as iOS: one field, keep,
// no questions asked. Verbatim in; a single vermilion dot acknowledges.
export function CaptureField({ now }: { now: Date }) {
  const capture = useMutation(api.thoughts.capture);
  const [text, setText] = useState("");
  const [kept, setKept] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

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

  const clock = now
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false })
    .toLowerCase();

  return (
    <div className="flex w-full flex-col items-center">
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
        className="w-full max-w-[36ch] resize-none overflow-hidden bg-transparent text-center text-[22px] leading-[1.65] font-light outline-none"
      />
      <div className="mt-5 flex h-5 items-center justify-center">
        {kept ? (
          <span className="size-2 rounded-full bg-dot" />
        ) : text.trim() ? (
          <button
            type="button"
            onClick={keep}
            className="flex items-center gap-2.5 text-[12px] tracking-[0.3em] text-ink uppercase"
          >
            <span className="size-2 rounded-full bg-dot" />
            keep
          </button>
        ) : (
          <span className="text-[11px] tracking-[0.3em] text-pl uppercase">
            {clock} · unfiled
          </span>
        )}
      </div>
    </div>
  );
}
