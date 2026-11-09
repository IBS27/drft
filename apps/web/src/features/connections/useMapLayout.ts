import { useEffect, useState } from "react";
import type { Group } from "./cluster";
import { packGroups } from "./layoutPool";
import type { Layout } from "./pack";
import type { GroupLayouts } from "./useGroupLayouts";

// A map as drawn: its groups packed into a room, with the thoughts they
// were laid out for.
export type MapLayout = { map: GroupLayouts; layout: Layout };

// The last map packed, so coming back to the page at the same size draws
// it at once.
let last: { groups: Group[]; width: number; height: number; layout: Layout } | undefined;

const sameGroups = (a: Group[], b: Group[]) =>
  a.length === b.length && a.every((group, i) => group === b[i]);

// Packs a map's groups into a room `width` by `height`, off the page's
// thread. Returns the last map packed, kept on screen while a newer one
// (new thoughts, or a new size) is on its way; null until the first.
export function useMapLayout(map: GroupLayouts | null, width: number, height: number): MapLayout | null {
  const [packed, setPacked] = useState<MapLayout | null>(null);
  useEffect(() => {
    if (map === null || width === 0) return;
    if (last && last.width === width && last.height === height && sameGroups(last.groups, map.groups)) {
      setPacked({ map, layout: last.layout });
      return;
    }
    return packGroups({ groups: map.groups, links: map.links, width, height }, (layout) => {
      last = { groups: map.groups, width, height, layout };
      setPacked({ map, layout });
    });
  }, [map, width, height]);
  return packed;
}
