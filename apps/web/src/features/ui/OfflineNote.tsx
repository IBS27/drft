import { CloudSlash } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Capture must never fail visibly (Convex queues mutations while
// offline), but the user deserves to know the queue is holding. One small
// pill at the bottom edge, gone the moment the connection is back.
export function OfflineNote() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  if (online) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 flex justify-center">
      <span
        role="status"
        className="inline-flex h-9 items-center gap-2 rounded-full bg-scr px-4 text-[13px] text-pt shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--ink)_35%,transparent)] ring-1 ring-line"
      >
        <CloudSlash aria-hidden="true" className="text-[16px] text-pl" />
        Offline. Thoughts will keep.
      </span>
    </div>
  );
}
