import { BookmarkSimple, Graph } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { Id } from "@drft/backend/convex/_generated/dataModel";
import { memo } from "react";
import { heldAge } from "../thoughts/format";
import type { HeldCard } from "./layout";
import type { ToggleHold } from "./useHold";

// While a card is hovered or focused, the cards it's related to are
// outlined and the rest step back.
export type CardState = "rest" | "focus" | "related" | "dim";

const STATE_CLASS: Record<CardState, string> = {
  rest: "bg-scr ring-1 ring-line",
  focus: "bg-tint ring-1 ring-dot-edge",
  related: "bg-scr ring-[1.5px] ring-dot-edge",
  dim: "bg-scr ring-1 ring-line opacity-40",
};

// One held thought on the table: your words in full (very long ones stop
// at ten lines; the thought page has the rest), the start of your notes
// behind the notebook's vermilion margin rule, how long it's been held,
// and how many of the other held thoughts it's related to. Its one
// control, letting go, waits in the corner until you're on the card.
export const HeldCardView = memo(function HeldCardView({
  card,
  links,
  now,
  state,
  onFocusCard,
  toggle,
  prewarm,
}: {
  card: HeldCard;
  links: number;
  now: number;
  state: CardState;
  onFocusCard: (id: Id<"thoughts"> | null) => void;
  toggle: ToggleHold;
  prewarm: (id: Id<"thoughts">) => void;
}) {
  const age = heldAge(card.heldAt, now);
  const notes = card.notes.trim();
  return (
    <article
      data-hold-id={card._id}
      data-held-at={card.heldAt}
      data-hold-notice=""
      onPointerEnter={() => {
        onFocusCard(card._id);
        prewarm(card._id);
      }}
      onPointerLeave={() => onFocusCard(null)}
      onFocus={() => {
        onFocusCard(card._id);
        prewarm(card._id);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocusCard(null);
      }}
      className={`group relative rounded-card ring-inset transition-[opacity,background-color,box-shadow] duration-200 motion-reduce:transition-none ${STATE_CLASS[state]}`}
    >
      {state === "related" && (
        <span className="absolute -top-2 left-3 rounded-full bg-pg px-1.5 text-[11.5px] leading-[17px] font-medium text-dot-ink ring-1 ring-dot-edge ring-inset">
          Related
        </span>
      )}
      <Link
        to="/thought/$thoughtId"
        params={{ thoughtId: card._id }}
        search={{ from: "held" }}
        className="block rounded-card px-4 pt-3.5 pb-3"
      >
        <p className="line-clamp-10 pr-7 text-[16px] leading-[1.5] whitespace-pre-wrap text-ink">
          {card.text}
        </p>
        {notes && (
          <p className="mt-2.5 line-clamp-3 pl-2.5 text-[14.5px] leading-[1.55] whitespace-pre-line text-pl shadow-[inset_2px_0_0_var(--line)]">
            {notes}
          </p>
        )}
        <span className="mt-2.5 flex items-center gap-2 text-[13px] text-pl">
          <span className="flex-1 whitespace-nowrap tabular-nums">Held {age.long}</span>
          {links > 0 && (
            <span title="Echoes another held thought" className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Graph aria-hidden="true" className="text-[13px]" />
              Echoes another
            </span>
          )}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => toggle(card._id, card.heldAt, { notice: true })}
        aria-label="Let go"
        title="Let go (h)"
        className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-line/70 text-[13px] text-pt opacity-0 hover:bg-tint hover:text-ink transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <BookmarkSimple aria-hidden="true" weight="fill" />
      </button>
    </article>
  );
});
