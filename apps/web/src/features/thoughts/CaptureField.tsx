import { useAuth } from "@clerk/clerk-react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { readSeenUser } from "../auth/seenUser";
import { localDate, previewOf } from "./format";

// Desktop autofocus invites typing; on touch the same attribute pops the
// keyboard over the collection on every visit.
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

// Kept, but not yet sent. The window is small — the room opens before
// Convex has the session — but a thought that has been acknowledged is
// already the user's, so the queue outlives this screen: leaving for
// /settings, a reload, or the handshake coming back signed-out all used
// to drop it. It is flushed on the next load that has a session.
// Each entry names its owner (the user this browser was signed in as when
// it was kept), and draining takes only the signed-in user's entries — on
// a shared browser one account's words never flush into another's.
const PENDING_KEY = "drft:pending-captures";

type PendingCapture = { text: string; owner: string | null };

function readPending(): PendingCapture[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(PENDING_KEY) ?? "[]",
    );
    if (!Array.isArray(raw)) return [];
    const items: unknown[] = raw;
    return items.filter((p): p is PendingCapture => {
      if (typeof p !== "object" || p === null) return false;
      const entry = p as Record<string, unknown>;
      return (
        typeof entry.text === "string" &&
        (typeof entry.owner === "string" || entry.owner === null)
      );
    });
  } catch {
    return [];
  }
}

function writePending(pending: PendingCapture[]): void {
  try {
    if (pending.length === 0) window.localStorage.removeItem(PENDING_KEY);
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage can be denied (private mode); the send below still happens.
  }
}

function queue(trimmed: string, owner: string | null): void {
  writePending([...readPending(), { text: trimmed, owner }]);
}

// Ownerless entries are a should-not-happen (the queue is only reachable
// once this browser has a remembered user); flushing them to whoever is
// here keeps capture's promise that nothing kept is ever dropped.
function drain(userId: string): string[] {
  const pending = readPending();
  const mine = pending.filter((p) => p.owner === userId || p.owner === null);
  if (mine.length > 0)
    writePending(pending.filter((p) => !mine.includes(p)));
  return mine.map((p) => p.text);
}

// The web capture input obeys the same rules as iOS: one field, keep,
// no questions asked. Verbatim in; a single vermilion dot acknowledges.
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

  const clock = new Date(now)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();

  return (
    <div className="flex w-full flex-col items-center">
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
