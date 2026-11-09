// The shapes the connections map is drawn in, and the plain geometry every
// part of its layout shares. Nothing here touches the DOM, so the layout can
// run on a worker (layout.worker.ts) as well as on the page.
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Point = { x: number; y: number };
export type ViewTransform = { x: number; y: number; scale: number };

// How a name is set. Every name is set alike; only the thought back today
// is named a little firmer, as the legend's first entry says.
export type Voice = { size: number; weight: number; leading: number };

// A dot and its name, as they sit on screen. Names always read to the
// right of their dot, so a glance down any column reads one way.
export type Shape = { r: number; lines: string[]; w: number; h: number; voice: Voice };

// A thought as the layout moves it: its dot and name, and where it sits.
export type LayoutNode = SimulationNodeDatum & Shape & { id: string };

export type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  id: string;
  sourceId: string;
  targetId: string;
};

export type Pair = [LayoutNode, LayoutNode];

export const MIN_SCALE = 0.36;
export const MAX_SCALE = 3.2;

// Names and dots keep their size on screen; zoom changes only the spacing.
export const LABEL_GAP = 7;
// The paper-coloured outline drawn behind each letter (its stroke width).
export const HALO = 4;
// The air a line keeps from a stranger's dot and name, and from its own
// end's name.
export const EDGE_CLEAR = 8;
const OWN_CLEAR = 5;
// The least air between one dot-and-name and the next.
export const CLEARANCE = 20;

export function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

// A dot with its name beside it, relative to the dot.
export function nodeBox(n: Shape): Box {
  const half = Math.max(n.r, n.h / 2);
  return { x0: -n.r, y0: -half, x1: n.r + LABEL_GAP + n.w, y1: half };
}

// Just the name, with its halo, relative to the dot.
export function labelBox(n: Shape): Box {
  const x = n.r + LABEL_GAP;
  const halo = HALO / 2;
  return { x0: x - halo, y0: -n.h / 2 - halo, x1: x + n.w + halo, y1: n.h / 2 + halo };
}

export const at = (box: Box, x: number, y: number): Box => ({
  x0: box.x0 + x,
  y0: box.y0 + y,
  x1: box.x1 + x,
  y1: box.y1 + y,
});

export const grow = (box: Box, by: number): Box => ({
  x0: box.x0 - by,
  y0: box.y0 - by,
  x1: box.x1 + by,
  y1: box.y1 + by,
});

export const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Whether a line segment passes through a box (Liang–Barsky clipping).
export function crosses(a: Point, b: Point, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

export const pos = (n: LayoutNode): Point => ({ x: n.x ?? 0, y: n.y ?? 0 });

// Names read to the right of their dots, so a line leaving a dot to the
// right, near level, would run under that dot's own name. A line therefore
// bends just as much as it must: it leaves its left-hand dot more upright
// and comes into the other end more level. `bow` sets the bend, from 0.5
// (straight) down to 0 (leaving straight up or down).
const BOWS = [0.5, 0.36, 0.24, 0.12, 0];
// Points along a bent line, for checking it against what it passes.
const BEND_STEPS = 6;

export type Bend = { from: Point; via: Point; to: Point; bow: number; clear: boolean };

// The name beside a dot, relative to the dot, as a line must keep off it.
export const ownName = (n: Shape): Box => grow(labelBox(n), OWN_CLEAR - HALO / 2);

// Whether a line from a dot to a point `dx` right and `dy` down, bent by
// `bow`, keeps off the dot's own `name`. The bend is a quadratic curve whose
// x and y both grow steadily, so it's enough to see where it first reaches
// the name's left edge.
function passes(dx: number, dy: number, bow: number, name: Box): boolean {
  if (dx <= name.x0) return true;
  const k = name.x0 / dx;
  const a = 1 - 2 * bow;
  const t = a < 1e-9 ? k / (2 * bow) : (-2 * bow + Math.sqrt(4 * bow * bow + 4 * a * k)) / (2 * a);
  const y = dy * ((2 * bow - 1) * t * t + 2 * (1 - bow) * t);
  return y <= name.y0 || y >= name.y1;
}

// The line between two dots, bent as little as clears the left dot's name.
export function bend(p: Point, pName: Box, q: Point, qName: Box): Bend {
  const [from, to, name] = p.x <= q.x ? [p, q, pName] : [q, p, qName];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bow = BOWS.find((b) => passes(dx, dy, b, name));
  const b = bow ?? 0;
  return { from, via: { x: from.x + b * dx, y: from.y + (1 - b) * dy }, to, bow: b, clear: bow !== undefined };
}

function bendPoints({ from, via, to }: Bend): Point[] {
  return Array.from({ length: BEND_STEPS + 1 }, (_, k) => {
    const t = k / BEND_STEPS;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
    };
  });
}

// Whether a bent line passes through a box.
export function bendCrosses(line: Bend, box: Box): boolean {
  const { from, via, to } = line;
  if (Math.max(from.x, via.x, to.x) < box.x0 || Math.min(from.x, via.x, to.x) > box.x1) return false;
  if (Math.max(from.y, via.y, to.y) < box.y0 || Math.min(from.y, via.y, to.y) > box.y1) return false;
  const points = bendPoints(line);
  for (let k = 1; k < points.length; k += 1) if (crosses(points[k - 1], points[k], box)) return true;
  return false;
}

// What a set of dots and names covers.
export function extent(nodes: LayoutNode[]): Box {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of nodes) {
    const b = at(nodeBox(n), n.x ?? 0, n.y ?? 0);
    box.x0 = Math.min(box.x0, b.x0);
    box.y0 = Math.min(box.y0, b.y0);
    box.x1 = Math.max(box.x1, b.x1);
    box.y1 = Math.max(box.y1, b.y1);
  }
  return box;
}
