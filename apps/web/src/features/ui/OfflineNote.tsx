import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Capture must never fail visibly — Convex queues mutations while
// offline — but the user deserves to know the queue is holding. One
// quiet line, gone the moment the connection is back.
export function OfflineNote() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  if (online) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center">
      <span className="text-[10px] tracking-[0.32em] text-pl uppercase">
        offline · thoughts will keep
      </span>
    </div>
  );
}
