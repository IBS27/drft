import { useAuth } from "@clerk/clerk-react";
import { Check } from "@phosphor-icons/react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { readSeenUser } from "../auth/seenUser";
import { drain, queue } from "./pendingCaptures";
import { localDate, previewOf } from "./format";

// Desktop autofocus invites typing; on touch the same attribute pops the
// keyboard over the collection on every visit.
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

// The web capture input obeys the same rules as iOS: one field, keep,
// no questions asked. Verbatim in; Keep is a vermilion button you can see
// from across the room, and a brief "Kept" acknowledges.
export function CaptureField({ now }: { now: number }) {
  const { isAuthenticated } = useConvexAuth();
  const { userId } = useAuth();
  // Who a queued thought belongs to: the signed-in user once Clerk has
  // one, else whoever this browser last belonged to — the only person the
  // fast-open shell (and so this field) opens for. A ref, so callbacks
  // that outlive their render read the current answer.
  const ownerRef = useRef<string | null>(userId ?? readSeenUser());
  useEffect(() => {
    if (userId) ownerRef.current = userId;
  }, [userId]);
  const capture = useMutation(api.thoughts.capture).withOptimisticUpdate(
    (localStore, args) => {
      // The kept thought appears in the collection the instant the dot
      // does, not a round-trip later. Convex swaps in the real row.
      const date = localDate(now);
      const current = localStore.getQuery(api.thoughts.collection, { date });
      if (!current) return;
      localStore.setQuery(api.thoughts.collection, { date }, {
        ...current,
        thoughts: [
          {
            _id: crypto.randomUUID() as Id<"thoughts">,
            preview: previewOf(args.text),
            createdAt: Date.now(),
            heldAt: undefined,
          },
          ...current.thoughts,
        ],
      });
    },
  );
  const [text, setText] = useState("");
  const [kept, setKept] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  });

  // What the field holds right now, readable from a callback that resolves
  // long after the render it was made in.
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // A failed send must never eat what you have started typing since — and
  // must never quietly drop its own words either. Back into the field if
  // it is free (claimed synchronously, so two failures can't both take
  // it); otherwise back onto the queue, which outlives this screen.
  const recover = useCallback((trimmed: string) => {
    if (textRef.current !== "") {
      queue(trimmed, ownerRef.current);
      return;
    }
    textRef.current = trimmed;
    setText(trimmed);
  }, []);

  const send = useCallback(
    (trimmed: string) => {
      // Fire and forget: Convex queues the mutation if offline. Capture
      // must never fail visibly.
      void captureRef.current({ text: trimmed }).catch(() => recover(trimmed));
    },
    [recover],
  );

  // The session has landed (or was already here, and something is waiting
  // from a previous visit): everything this user kept in the meantime
  // goes now.
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    for (const trimmed of drain(userId)) send(trimmed);
  }, [isAuthenticated, userId, send]);

  // The field grows with the thought, and shrinks back when it leaves.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (text) el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const keep = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    textRef.current = "";
    setText("");
    setKept(true);
    window.setTimeout(() => setKept(false), 1100);
    if (isAuthenticated) send(trimmed);
    else queue(trimmed, ownerRef.current);
  };

  const date = new Date(now);
  const clock = date
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  const day = date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const typed = text.trim() !== "";

  // A sheet of paper at the center of the room: today on top, your words
  // in the middle, and the one action at its foot. The sheet is there
  // before you type, so it is always clear where words go.
  return (
    <div className="flex w-full max-w-[640px] flex-col rounded-[18px] bg-scr px-6 pt-6 pb-5 shadow-lift ring-1 ring-line ring-inset sm:px-10 sm:pt-9 sm:pb-7">
      <div className="flex items-baseline justify-between gap-4 text-[14px]">
        <span className="font-medium text-pt">{day}</span>
        <span className="text-pl tabular-nums">{clock}, unfiled</span>
      </div>
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            keep();
          }
        }}
        autoFocus={!coarsePointer}
        rows={1}
        aria-label="A thought"
        placeholder="Write a thought…"
        className="mt-5 min-h-[88px] w-full resize-none overflow-hidden bg-transparent text-[24px] leading-[1.42] tracking-[-0.014em] text-ink caret-dot outline-none placeholder:text-faint sm:mt-7 sm:min-h-[124px] sm:text-[30px]"
      />
      <div className="mt-4 flex h-[42px] items-center justify-between gap-4">
        {kept ? (
          <span
            role="status"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-tint px-3.5 text-[13.5px] font-medium text-dot-ink"
          >
            <Check aria-hidden="true" weight="bold" className="text-[14px]" />
            Kept
          </span>
        ) : (
          <span className="text-[13px] text-pl">
            {coarsePointer ? "" : typed ? "Shift ↵ for a new line" : "Unfinished is fine"}
          </span>
        )}
        <button
          type="button"
          onClick={keep}
          disabled={!typed}
          className="inline-flex h-[42px] items-center gap-2.5 rounded-full bg-dot pr-2 pl-5 text-[15px] font-semibold text-on-dot shadow-[0_10px_24px_-12px_color-mix(in_oklab,var(--dot)_70%,transparent)] transition-[scale,filter,opacity,box-shadow] duration-200 hover:brightness-105 active:scale-[0.98] disabled:opacity-35 disabled:shadow-none disabled:hover:brightness-100 disabled:active:scale-100 motion-reduce:transition-none"
        >
          Keep
          <kbd className="inline-flex size-[26px] items-center justify-center rounded-full bg-on-dot/20 font-mono text-[13px]">
            ↵
          </kbd>
        </button>
      </div>
    </div>
  );
}
