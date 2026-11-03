import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { useEffect } from "react";
import { useHoldNotice } from "./holdNotice";
import { useHold } from "./useHold";

// Anything that can be held marks itself in the DOM:
//   data-hold-id      the thought
//   data-held-at      when it was held, or "" if it isn't
//   data-hold-notice  present when a change there should be confirmed
//   data-hold-default the page's own thought (its chip), when no row or
//                     card is focused or hovered
// so one key, h, works on whatever you're on: the row or card you reached
// with the keyboard, then the one under the pointer, then the open thought.
// Focus left behind by a click doesn't count — the rail stays mounted as
// you move between thoughts, and a row clicked earlier would otherwise
// keep taking the key.
function holdTarget(): HTMLElement | null {
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && active.matches(":focus-visible")
      ? active.closest<HTMLElement>("[data-hold-id]")
      : null;
  if (focused) return focused;
  const hovered = document.querySelectorAll<HTMLElement>("[data-hold-id]:hover");
  if (hovered.length > 0) return hovered[hovered.length - 1];
  return document.querySelector<HTMLElement>("[data-hold-default]");
}

function HoldShortcut() {
  const toggle = useHold();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "h" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (document.querySelector("[data-overlay]") !== null) return;
      const el = holdTarget();
      const id = el?.dataset.holdId;
      if (!el || !id) return;
      e.preventDefault();
      const heldAt = el.dataset.heldAt ? Number(el.dataset.heldAt) : undefined;
      toggle(id as Id<"thoughts">, heldAt, {
        notice: el.dataset.holdNotice !== undefined,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return null;
}

// The confirmation strip at the bottom edge: what happened, and Undo.
function HoldNotice() {
  const notice = useHoldNotice();
  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4">
      <span
        key={notice.id}
        role="status"
        className="pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-scr pr-1.5 pl-4 text-[13.5px] shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--ink)_35%,transparent)] ring-1 ring-line"
      >
        <span className={notice.failed ? "pr-2.5 text-dot-ink" : "text-pt"}>
          {notice.text}
        </span>
        {notice.undo && (
          <button
            type="button"
            onClick={notice.undo}
            className="rounded-full px-3 py-1.5 font-medium text-dot-ink transition-colors hover:bg-tint"
          >
            Undo
          </button>
        )}
      </span>
    </div>
  );
}

export function HoldLayer() {
  return (
    <>
      <HoldShortcut />
      <HoldNotice />
    </>
  );
}
