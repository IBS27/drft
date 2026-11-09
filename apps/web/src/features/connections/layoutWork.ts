import { layoutGroup, type Group, type GroupJob } from "./cluster";
import type { LayoutLink } from "./geometry";
import { computeLayout, type Layout } from "./pack";

// The two pieces of work a map takes: laying one group out, and packing the
// finished groups into a room.
export type Packing = { groups: Group[]; links: LayoutLink[]; width: number; height: number };
export type Work = { group: GroupJob } | { pack: Packing };

// The same code on the page and on a worker (layoutPool), so a map comes
// out the same wherever it was laid out.
export function perform(work: Work): Group | Layout {
  if ("group" in work) return layoutGroup(work.group);
  const { groups, links, width, height } = work.pack;
  return computeLayout(groups, links, width, height);
}
