import type { ReactNode } from "react";

// A key hint (⌘K, ↵). Keyboard-only affordances; hidden where there is no
// keyboard to press them with is the caller's call.
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded-[6px] px-[5px] font-mono text-[11.5px] ${className}`}
    >
      {children}
    </kbd>
  );
}
