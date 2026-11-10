// Places the finished groups in the room. Light next to laying a group out,
// and it depends on the window, so it runs on the page: a resize only packs
// the groups again.
import { refine, type Cluster, type Group } from "./cluster";
import {
  at,
  bend,
  bendCrosses,
  CLEARANCE,
  EDGE_CLEAR,
  extent,
  grow,
  MIN_SCALE,
  nodeBox,
  overlaps,
  ownName,
  pos,
  type Box,
  type LayoutLink,
  type LayoutNode,
  type Pair,
  type ViewTransform,
} from "./geometry";

// The page's content column, which the title, the map and its legend share
// (the page header's wide column: its width, less its padding).
const COLUMN = 1040;
const GUTTER = 40;
// The map's room: just below the subtitle, as other pages' content sits
// below theirs, with room under it for the legend, LEGEND_GAP below the map.
// A map shorter than the room keeps to its top.
const FRAME = { top: 16, bottom: 76 };
export const LEGEND_GAP = 32;
// The most a clear gutter between side-by-side groups widens to span the
// column, so spreading never leaves a void.
const MAX_SPREAD = 96;
// The air between groups, widest first, narrowed only to fit the room.
const CLUSTER_GAPS = [104, 84, 68, 52, 40];
// A map drawn smaller than its groups were laid out is refined again as
// drawn, up to this many thoughts; past it, names wait for zooming in.
const REFINED_MAP = 80;

export type Layout = {
  nodes: LayoutNode[];
  links: LayoutLink[];
  // The view that frames the whole map: across the column, at its top.
  fit: ViewTransform;
  // Where the fitted map's dots and names end, down the frame.
  bottom: number;
};

// The page's content column across a frame `width` wide.
function columnOf(width: number): { x0: number; x1: number } {
  const x0 = (width - Math.min(width, COLUMN)) / 2 + GUTTER;
  return { x0, x1: width - x0 };
}

// Spans the groups across `width` by widening the clear gutters between
// groups that sit side by side, each by at most MAX_SPREAD.
function spread(placed: Placed[], width: number) {
  const runs: [number, number][] = [];
  for (const p of [...placed].sort((a, b) => a.x0 - b.x0)) {
    const last = runs[runs.length - 1];
    if (last && p.x0 < last[1]) last[1] = Math.max(last[1], p.x1);
    else runs.push([p.x0, p.x1]);
  }
  const extra = width - (runs[runs.length - 1][1] - runs[0][0]);
  if (runs.length < 2 || extra <= 0) return;
  const step = Math.min(MAX_SPREAD, extra / (runs.length - 1));
  for (const p of placed) {
    const shift = runs.findIndex(([x0, x1]) => p.x0 >= x0 && p.x1 <= x1) * step;
    p.x0 += shift;
    p.x1 += shift;
  }
}

type Placed = Box & { cluster: Cluster };

// How unevenly the groups fill the four quarters of the space they span:
// 0 when every quarter holds as much as the others.
function imbalance(boxes: Box[]): number {
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const y1 = Math.max(...boxes.map((b) => b.y1));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const quarters = [
    { x0, y0, x1: cx, y1: cy },
    { x0: cx, y0, x1, y1: cy },
    { x0, y0: cy, x1: cx, y1 },
    { x0: cx, y0: cy, x1, y1 },
  ].map((q) => {
    const covered = boxes.reduce(
      (sum, b) =>
        sum +
        Math.max(0, Math.min(b.x1, q.x1) - Math.max(b.x0, q.x0)) *
          Math.max(0, Math.min(b.y1, q.y1) - Math.max(b.y0, q.y0)),
      0,
    );
    return covered / Math.max(1, (q.x1 - q.x0) * (q.y1 - q.y0));
  });
  return Math.max(...quarters) - Math.min(...quarters);
}


// Packs the groups around the largest, each set, in whichever of its shapes
// suits best, beside one already placed with `gap` between them. The best
// spot keeps the whole map within the room and of the room's shape, leaves
// the fewest empty corners, and sits nearest the middle.
function pack(groups: Group[], gap: number, room: { w: number; h: number }, lead: number): Placed[] {
  const area = (c: Cluster) => c.w * c.h;
  const order = [...groups].sort((a, b) => b.size - a.size || area(b.forms[0]) - area(a.forms[0]));
  const placed: Placed[] = [];
  const bound = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let filled = 0;
  for (const group of order) {
    if (placed.length === 0) {
      const cluster = group.forms[Math.min(lead, group.forms.length - 1)];
      const { w, h } = cluster;
      placed.push({ x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, cluster });
      Object.assign(bound, placed[0]);
      filled = area(cluster);
      continue;
    }
    let best: { box: Box; cluster: Cluster; score: number } | undefined;
    for (const cluster of group.forms) {
      const { w, h } = cluster;
      for (const p of placed) {
        const xs = [p.x0, (p.x0 + p.x1 - w) / 2, p.x1 - w];
        const ys = [p.y0, (p.y0 + p.y1 - h) / 2, p.y1 - h];
        const spots = [
          ...ys.flatMap((y) => [
            { x: p.x1 + gap, y },
            { x: p.x0 - gap - w, y },
          ]),
          ...xs.flatMap((x) => [
            { x, y: p.y1 + gap },
            { x, y: p.y0 - gap - h },
          ]),
        ];
        for (const spot of spots) {
          const box = { x0: spot.x, y0: spot.y, x1: spot.x + w, y1: spot.y + h };
          if (placed.some((other) => overlaps(grow(box, gap - 0.5), other))) continue;
          const bw = Math.max(bound.x1, box.x1) - Math.min(bound.x0, box.x0);
          const bh = Math.max(bound.y1, box.y1) - Math.min(bound.y0, box.y0);
          const across = bw / room.w;
          const down = bh / room.h;
          // Past the room the map must shrink, which costs most; within it,
          // a map the room's shape that its groups fill reads calmest.
          const over = Math.max(1, across, down);
          const empty = 1 - (filled + area(cluster)) / (bw * bh);
          const middle = Math.hypot((box.x0 + box.x1) / 2 / room.w, (box.y0 + box.y1) / 2 / room.h);
          const shapeMiss = Math.abs(Math.log(bw / bh / (room.w / room.h)));
          const score = over * 20 + shapeMiss * 4 + empty * 6 + imbalance([...placed, box]) * 6 + middle;
          if (!best || score < best.score) best = { box, cluster, score };
        }
      }
    }
    if (!best) continue;
    placed.push({ ...best.box, cluster: best.cluster });
    filled += area(best.cluster);
    bound.x0 = Math.min(bound.x0, best.box.x0);
    bound.y0 = Math.min(bound.y0, best.box.y0);
    bound.x1 = Math.max(bound.x1, best.box.x1);
    bound.y1 = Math.max(bound.y1, best.box.y1);
  }
  // Each group then drifts toward the map's middle as far as its
  // neighbours allow, so no corner of the map sits empty while another
  // is crowded.
  const middle = { x: (bound.x0 + bound.x1) / 2, y: (bound.y0 + bound.y1) / 2 };
  for (let round = 0; round < 3; round += 1)
    for (const p of placed)
      for (const axis of ["y", "x"] as const) {
        const target = axis === "x" ? middle.x - (p.x0 + p.x1) / 2 : middle.y - (p.y0 + p.y1) / 2;
        for (let step = target; Math.abs(step) >= 1; step /= 2) {
          const moved = axis === "x" ? { ...p, x0: p.x0 + step, x1: p.x1 + step } : { ...p, y0: p.y0 + step, y1: p.y1 + step };
          if (placed.some((other) => other !== p && overlaps(grow(moved, gap - 0.5), other))) continue;
          Object.assign(p, moved);
          break;
        }
      }
  return placed;
}

// Every flaw a finished map shows: lines under a name or through a dot,
// and dots-and-names crowding.
function flawCount(nodes: LayoutNode[], pairs: Pair[]): number {
  const wholes = nodes.map((n) => at(grow(nodeBox(n), EDGE_CLEAR), n.x ?? 0, n.y ?? 0));
  const airs = nodes.map((n) => at(grow(nodeBox(n), CLEARANCE / 2), n.x ?? 0, n.y ?? 0));
  let count = 0;
  for (const [s, t] of pairs) {
    const line = bend(pos(s), ownName(s), pos(t), ownName(t));
    if (!line.clear) count += 1;
    nodes.forEach((n, j) => {
      if (n !== s && n !== t && bendCrosses(line, wholes[j])) count += 1;
    });
  }
  airs.forEach((a, i) => {
    for (let j = i + 1; j < airs.length; j += 1) if (overlaps(a, airs[j])) count += 1;
  });
  return count;
}

// Spreads the dots (not their names) across, from the leftmost, until the
// map spans `width`, or as near as it can without a new flaw.
function stretch(nodes: LayoutNode[], pairs: Pair[], width: number) {
  const box = extent(nodes);
  if (box.x1 - box.x0 >= width - 0.5) return;
  const left = Math.min(...nodes.map((n) => n.x ?? 0));
  const xs = nodes.map((n) => n.x ?? 0);
  const apply = (k: number) => nodes.forEach((n, i) => (n.x = left + (xs[i] - left) * k));
  // The stretch that spans the width exactly, found by halving.
  let [lo, hi] = [1, 1.3];
  for (let step = 0; step < 24; step += 1) {
    const k = (lo + hi) / 2;
    apply(k);
    const spanned = extent(nodes);
    if (spanned.x1 - spanned.x0 > width) hi = k;
    else lo = k;
  }
  const before = (apply(1), flawCount(nodes, pairs));
  for (let k = lo; k > 1.001; k = 1 + (k - 1) / 2) {
    apply(k);
    if (flawCount(nodes, pairs) <= before) return;
  }
  apply(1);
}

// Places the groups in the room: as far apart as the room allows, then
// framed and centred. A map too large for the room starts zoomed out (and
// names wait for zooming in).
export function computeLayout(groups: Group[], links: LayoutLink[], width: number, height: number): Layout {
  if (groups.length === 0) return { nodes: [], links, fit: { x: 0, y: 0, scale: 1 }, bottom: 0 };
  const column = columnOf(width);
  const room = {
    w: Math.max(200, column.x1 - column.x0),
    h: Math.max(200, height - FRAME.top - FRAME.bottom),
  };
  // The largest group leads in each of its shapes, and the rest pack around
  // it as far apart as the room allows. The calmest whole wins: one that
  // needn't shrink, then one of the room's shape that its groups fill evenly
  // and that uses the room.
  const leads = groups.reduce((a, b) => (b.size > a.size ? b : a)).forms.length;
  let best: { placed: Placed[]; scale: number; score: number } | undefined;
  for (let lead = 0; lead < leads; lead += 1) {
    let widest: { placed: Placed[]; scale: number; bw: number; bh: number } | undefined;
    for (const gap of CLUSTER_GAPS) {
      const placed = pack(groups, gap, room, lead);
      const bw = Math.max(...placed.map((p) => p.x1)) - Math.min(...placed.map((p) => p.x0));
      const bh = Math.max(...placed.map((p) => p.y1)) - Math.min(...placed.map((p) => p.y0));
      const scale = Math.max(MIN_SCALE, Math.min(1, room.w / bw, room.h / bh));
      if (!widest || scale > widest.scale + 0.001) widest = { placed, scale, bw, bh };
      if (scale >= 1) break;
    }
    if (!widest) continue;
    const { placed, scale, bw, bh } = widest;
    const filled = placed.reduce((sum, p) => sum + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
    const score =
      (1 - scale) * 60 +
      Math.abs(Math.log(bw / bh / (room.w / room.h))) * 4 +
      (1 - filled / (bw * bh)) * 6 +
      imbalance(placed) * 6 +
      (1 - Math.min(1, (bw * bh) / (room.w * room.h))) * 3 +
      (1 - Math.min(1, (bw * scale) / room.w)) * 6;
    if (!best || score < best.score) best = { placed, scale, score };
  }
  const { placed, scale } = best as { placed: Placed[]; scale: number };
  spread(placed, room.w / scale);
  // Each group comes clear of its lines at full size; a map drawn smaller
  // is refined again as drawn.
  const nodes = placed.flatMap((p) =>
    p.cluster.nodes.map((n) => ({ ...n, x: (p.x0 + (n.x ?? 0)) * scale, y: (p.y0 + (n.y ?? 0)) * scale })),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pairs = links.flatMap<Pair>((link) => {
    const s = byId.get(link.sourceId);
    const t = byId.get(link.targetId);
    return s && t ? [[s, t]] : [];
  });
  if (scale < 1 && nodes.length <= REFINED_MAP) {
    const box = extent(nodes);
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    refine(nodes, pairs, {
      ideal: Math.sqrt((room.w * room.h) / nodes.length) * 0.45,
      seed: nodes.length,
      room: { x0: cx - room.w / 2, y0: cy - room.h / 2, x1: cx + room.w / 2, y1: cy + room.h / 2 },
      hold: 40,
      heat: 0.5,
    });
  }
  stretch(nodes, pairs, room.w);
  for (const n of nodes) {
    n.x = (n.x ?? 0) / scale;
    n.y = (n.y ?? 0) / scale;
  }
  // Names keep their size on screen, so the frame is measured as drawn. The
  // map starts on the column's left edge, as the title does.
  const box = extent(nodes.map((n) => ({ ...n, x: (n.x ?? 0) * scale, y: (n.y ?? 0) * scale })));
  return {
    nodes,
    links,
    fit: {
      scale,
      x: column.x0 - box.x0,
      y: FRAME.top - box.y0,
    },
    bottom: FRAME.top + box.y1 - box.y0,
  };
}
