import { CloudArrowUp, CloudSlash } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSession } from "../auth/useSession";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// A handshake is over well inside this; past it, what is on screen is the
// remembered room, not the live one.
const STALLED_AFTER = 10_000;

function useStalled(): boolean {
  const waiting = useSession() !== "ready";
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setStalled(true), STALLED_AFTER);
    return () => {
      window.clearTimeout(timer);
      setStalled(false);
    };
  }, [waiting]);
  return stalled;
}

// Capture must never fail visibly (thoughts kept without a connection wait
// on this device), but the user deserves to know the room is holding. One
// small pill at the bottom edge, gone the moment the connection is back.
export function ConnectionNote() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  const stalled = useStalled();
  if (online && !stalled) return null;
  const Icon = online ? CloudArrowUp : CloudSlash;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 flex justify-center">
      <span
        role="status"
        className="inline-flex h-9 items-center gap-2 rounded-full bg-scr px-4 text-[13px] text-pt shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--ink)_35%,transparent)] ring-1 ring-line"
      >
        <Icon aria-hidden="true" className="text-[16px] text-pl" />
        {online ? "Reconnecting" : "Offline"}. Thoughts will keep.
      </span>
    </div>
  );
}
