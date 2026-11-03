import { useSyncExternalStore } from "react";

// The one-line strip that confirms a hold made away from the thought's own
// chip (a rail row, a card, the h key), with the one-click way back.
export type HoldNoticeState = {
  id: number;
  text: string;
  failed: boolean;
  undo?: () => void;
};

const SHOW_FOR_MS = 6000;

let current: HoldNoticeState | null = null;
let nextId = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function showHoldNotice(
  text: string,
  { undo, failed = false }: { undo?: () => void; failed?: boolean } = {},
): void {
  current = { id: ++nextId, text, failed, undo };
  window.clearTimeout(timer);
  timer = window.setTimeout(clearHoldNotice, SHOW_FOR_MS);
  emit();
}

export function clearHoldNotice(): void {
  window.clearTimeout(timer);
  if (current === null) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHoldNotice(): HoldNoticeState | null {
  return useSyncExternalStore(subscribe, () => current);
}
