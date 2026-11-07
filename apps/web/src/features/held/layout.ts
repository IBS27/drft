import type { api } from "@drft/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type HeldCard = FunctionReturnType<typeof api.thoughts.held>[number];

export type HeldMode = "recent" | "together";

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
