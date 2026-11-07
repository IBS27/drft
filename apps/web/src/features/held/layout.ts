import type { api } from "@drft/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type HeldCard = FunctionReturnType<typeof api.thoughts.held>[number];

export type HeldMode = "recent" | "together";

const GAP = 12;
const MIN_CARD = 280;
const MAX_COLUMNS = 4;

// As many columns as fit cards at least MIN_CARD wide: two beside the rail
// on a laptop, three on most desktops, four on very wide screens.
export function columnCount(width: number): number {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + GAP) / (MIN_CARD + GAP))));
}

// A card's height, estimated from its text, so columns balance without
// measuring the DOM (and without cards jumping once measured). Only the
// balance depends on it; nothing is cut to fit.
function estimate(card: HeldCard, columnWidth: number): number {
  const perLine = Math.max(18, Math.floor((columnWidth - 32) / 7.4));
  const lines = (text: string, cap: number) =>
    Math.min(
      cap,
      text
        .split("\n")
        .reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / perLine)), 0),
    );
  const notes = card.notes.trim()
    ? 10 + lines(card.notes, 2) * 21
    : 0;
  return 60 + lines(card.text, 10) * 22.5 + notes;
}

// Recent: newest hold first, read left to right. Each card goes to the
// shortest column so far, which keeps the reading order across the top
// rows while the columns stay level.
export function placeInColumns(
  cards: HeldCard[],
  columns: number,
  width: number,
): HeldCard[][] {
  const columnWidth = (width - GAP * (columns - 1)) / columns;
  const placed: HeldCard[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  for (const card of cards) {
    let shortest = 0;
    for (let i = 1; i < columns; i++) if (heights[i] < heights[shortest] - 1) shortest = i;
    placed[shortest].push(card);
    heights[shortest] += estimate(card, columnWidth) + GAP;
  }
  return placed;
}

// Together: held thoughts that are linked, directly or through each other,
// sit together. Groups come in the order of their most recent hold; inside
// one, each next card is the one most strongly linked to those already
// placed, so the closest echoes sit side by side. Thoughts linked to no
// other held thought share the last row. Groups have no names: a name
// would be generated text, and drft puts none on the page.
export function groupTogether(cards: HeldCard[]): {
  groups: HeldCard[][];
  loose: HeldCard[];
} {
  const byId = new Map(cards.map((card) => [card._id, card]));
  const linksOf = (card: HeldCard) =>
    card.links.filter((link) => byId.has(link.otherId));
  const seen = new Set<string>();
  const groups: HeldCard[][] = [];
  const loose: HeldCard[] = [];

  for (const start of cards) {
    if (seen.has(start._id)) continue;
    const members: HeldCard[] = [];
    const queue = [start];
    seen.add(start._id);
    while (queue.length > 0) {
      const card = queue.shift();
      if (!card) break;
      members.push(card);
      for (const link of linksOf(card)) {
        const other = byId.get(link.otherId);
        if (other && !seen.has(other._id)) {
          seen.add(other._id);
          queue.push(other);
        }
      }
    }
    if (members.length === 1) {
      loose.push(start);
      continue;
    }

    members.sort((a, b) => b.heldAt - a.heldAt);
    const ordered = [start];
    const placed = new Set<string>([start._id]);
    while (ordered.length < members.length) {
      let best: HeldCard | null = null;
      let bestScore = -1;
      for (const card of members) {
        if (placed.has(card._id)) continue;
        const score = Math.max(
          0,
          ...linksOf(card)
            .filter((link) => placed.has(link.otherId))
            .map((link) => link.score),
        );
        // `members` is in hold order, so a tie keeps the newer hold first.
        if (score > bestScore) {
          best = card;
          bestScore = score;
        }
      }
      if (!best) break;
      ordered.push(best);
      placed.add(best._id);
    }
    groups.push(ordered);
  }
  return { groups, loose };
}
