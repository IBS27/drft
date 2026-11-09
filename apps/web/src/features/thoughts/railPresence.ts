import { useLayoutEffect, useSyncExternalStore } from "react";

// The rail stands outside the pages (routes/__root), so a page that must
// stand alone says so from inside: a thought's error page has no rail.
let standingAlone = 0;
const listeners = new Set<() => void>();

function change(by: number) {
  standingAlone += by;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Takes the rail away for as long as the calling page is on screen.
export function useWithoutRail(): void {
  useLayoutEffect(() => {
    change(1);
    return () => change(-1);
  }, []);
}

export function useRailAllowed(): boolean {
  return useSyncExternalStore(subscribe, () => standingAlone === 0);
}
