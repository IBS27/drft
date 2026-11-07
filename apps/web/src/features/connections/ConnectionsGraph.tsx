import { useNavigate } from "@tanstack/react-router";
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { dateLine } from "../thoughts/format";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@drft/backend/convex/_generated/api";

type GraphPage = FunctionReturnType<typeof api.thoughts.connectionGraph>;
export type GraphThought = GraphPage["page"][number];

type Box = { x0: number; y0: number; x1: number; y1: number };
type Point = { x: number; y: number };
type ViewTransform = { x: number; y: number; scale: number };

// How a name is set. The thoughts the map turns on (well connected, or back
// today) are the places to start reading, so they're named larger and darker.
type Voice = { size: number; weight: number; leading: number };
const PLAIN: Voice = { size: 13, weight: 400, leading: 17 };
const HUB: Voice = { size: 15, weight: 500, leading: 20 };
const TODAY = HUB;
// Links that make a thought one the map turns on.
const HUB_DEGREE = 3;

// A dot and its name, as they sit on screen. Names always read to the
// right of their dot, so a glance down any column reads one way.
type Shape = { r: number; lines: string[]; w: number; h: number; voice: Voice };

type LayoutNode = SimulationNodeDatum &
  Shape & {
    id: string;
    thought: GraphThought;
  };

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  id: string;
  sourceId: string;
  targetId: string;
};

type Pair = [LayoutNode, LayoutNode];

const MIN_SCALE = 0.36;
const MAX_SCALE = 3.2;

// Names and dots keep their size on screen; zoom changes only the spacing.
const LABEL_GAP = 7;
// A line of a name holds about 24 characters, in ems so larger names keep it.
const LABEL_EMS = 13.4;
// The paper-coloured outline drawn behind each letter (its stroke width).
const HALO = 4;
// The air a line keeps from a stranger's dot and name, and from its own
// end's name.
const EDGE_CLEAR = 6;
const OWN_CLEAR = 3;
// The least air between one dot-and-name and the next.
const CLEARANCE = 12;
// The map's room: just below the subtitle, as other pages' content sits
// below theirs, and clear of the footer row. A map shorter than the room
// keeps to its top.
const FRAME = { top: 12, bottom: 76, left: 40, right: 40 };
// How much room a group's dots and names get to spread through.
const PACKING = 1.9;
// The shapes a group is laid out in (width over height); a large group keeps
// the first, a small one offers each so the groups can fill the room together.
const CLUSTER_ASPECTS = [1.2, 0.6, 2.4];
const SMALL_CLUSTER = 40;
// The air between groups, widest first, narrowed only to fit the room.
const CLUSTER_GAPS = [104, 84, 68, 52, 40];
// Simulation ticks over which names grow from nothing to full size.
const GROW_TICKS = 140;
// Fresh layouts tried for a small group, and how many of the tidiest are
// then refined; the cleanest is kept.
const ATTEMPTS = 10;
const FINALISTS = 3;
// A map drawn smaller than its groups were laid out is refined again as
// drawn, up to this many thoughts; past it, names wait for zooming in.
const REFINED_MAP = 80;

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

const widthCache = new Map<string, number>();
let measureContext: CanvasRenderingContext2D | null = null;

// A line's rendered width in Geist, measured once the font has loaded.
function textWidth(text: string, voice: Voice): number {
  const key = `${voice.size}/${voice.weight}/${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * voice.size * 0.51;
  measureContext.font = `${voice.weight} ${voice.size}px ${getComputedStyle(document.body).fontFamily}`;
  const width = measureContext.measureText(text).width;
  if (document.fonts.status === "loaded") widthCache.set(key, width);
  return width;
}

const JOINING = new Set(
  "a an the of in on at to for from with by and or but as is are was were be your my our their its that".split(" "),
);

// A thought's name: up to two lines broken at words; a longer thought ends
// in an ellipsis after a whole word.
function labelLines(text: string, voice: Voice): string[] {
  const max = voice.size * LABEL_EMS;
  const width = (line: string) => textWidth(line, voice);
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) {
      lines.push(line);
      line = "";
      if (lines.length === 2) break;
      line = word;
    } else {
      line = next;
    }
    used += 1;
  }
  if (line && lines.length < 2) lines.push(line);
  if (used < words.length) {
    const last = lines[lines.length - 1].split(" ");
    // The cut falls after a word that carries meaning, never after a stray
    // mark or a little joining word, and the ellipsis never follows punctuation.
    while (
      last.length > 1 &&
      (width(`${last.join(" ")}…`) > max ||
        !/[\p{L}\p{N}]/u.test(last[last.length - 1]) ||
        JOINING.has(last[last.length - 1].toLowerCase()))
    )
      last.pop();
    lines[lines.length - 1] = `${last.join(" ").replace(/[\s\p{P}\p{S}]+$/u, "")}…`;
    return lines;
  }
  // A whole thought on two lines breaks where the lines come out most even.
  if (lines.length === 2) {
    let best = lines;
    for (let i = 1; i < words.length; i += 1) {
      const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const widest = Math.max(...pair.map(width));
      if (widest <= max && widest < Math.max(...best.map(width))) best = pair;
    }
    return best;
  }
  return lines;
}

// Size says how connected a thought is.
function nodeRadius(connected: number): number {
  return connected >= 4 ? 5.5 : connected >= 2 ? 4 : 3;
}

function voiceOf(connected: number, returned: boolean): Voice {
  return returned ? TODAY : connected >= HUB_DEGREE ? HUB : PLAIN;
}

function shape(thought: GraphThought, connected: number, returned: boolean): Shape {
  const voice = voiceOf(connected, returned);
  const lines = labelLines(thought.text, voice);
  return {
    r: nodeRadius(connected),
    lines,
    w: Math.max(...lines.map((line) => textWidth(line, voice))),
    h: lines.length * voice.leading,
    voice,
  };
}

// A dot with its name beside it, relative to the dot.
function nodeBox(n: Shape): Box {
  const half = Math.max(n.r, n.h / 2);
  return { x0: -n.r, y0: -half, x1: n.r + LABEL_GAP + n.w, y1: half };
}

// Just the name, with its halo, relative to the dot.
function labelBox(n: Shape): Box {
  const x = n.r + LABEL_GAP;
  const halo = HALO / 2;
  return { x0: x - halo, y0: -n.h / 2 - halo, x1: x + n.w + halo, y1: n.h / 2 + halo };
}

const at = (box: Box, x: number, y: number): Box => ({
  x0: box.x0 + x,
  y0: box.y0 + y,
  x1: box.x1 + x,
  y1: box.y1 + y,
});

const grow = (box: Box, by: number): Box => ({
  x0: box.x0 - by,
  y0: box.y0 - by,
  x1: box.x1 + by,
  y1: box.y1 + by,
});

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Whether a line segment passes through a box (Liang–Barsky clipping).
function crosses(a: Point, b: Point, box: Box): boolean {
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

const pos = (n: LayoutNode): Point => ({ x: n.x ?? 0, y: n.y ?? 0 });

// Names read to the right of their dots, so a line leaving a dot to the
// right, near level, would run under that dot's own name. A line therefore
// bends just as much as it must: it leaves its left-hand dot more upright
// and comes into the other end more level. `bow` sets the bend, from 0.5
// (straight) down to 0 (leaving straight up or down).
const BOWS = [0.5, 0.36, 0.24, 0.12, 0];
// Points along a bent line, for checking it against what it passes.
const BEND_STEPS = 6;

type Bend = { from: Point; via: Point; to: Point; bow: number; clear: boolean };

// The name beside a dot, relative to the dot, as a line must keep off it.
const ownName = (n: Shape): Box => grow(labelBox(n), OWN_CLEAR - HALO / 2);

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
function bend(p: Point, pName: Box, q: Point, qName: Box): Bend {
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
function bendCrosses(line: Bend, box: Box): boolean {
  const { from, via, to } = line;
  if (Math.max(from.x, via.x, to.x) < box.x0 || Math.min(from.x, via.x, to.x) > box.x1) return false;
  if (Math.max(from.y, via.y, to.y) < box.y0 || Math.min(from.y, via.y, to.y) > box.y1) return false;
  const points = bendPoints(line);
  for (let k = 1; k < points.length; k += 1) if (crosses(points[k - 1], points[k], box)) return true;
  return false;
}

// A name partway grown in: the map takes its shape from dots and lines
// first, then names swell to full size and push room for themselves.
const sized = (n: Shape, g: number): Shape => (g >= 1 ? n : { ...n, w: n.w * g, h: n.h * g });

// Keeps every dot-and-name clear of every other by CLEARANCE, pushing apart
// along the shallower overlap. Returns whether anything still touched.
function separate(nodes: LayoutNode[], strength: number, g = 1): boolean {
  const boxes = nodes.map((n) =>
    at(nodeBox(sized(n, g)), (n.x ?? 0) + (n.vx ?? 0), (n.y ?? 0) + (n.vy ?? 0)),
  );
  const order = nodes.map((_, i) => i).sort((a, b) => boxes[a].x0 - boxes[b].x0);
  let touched = false;
  for (let i = 0; i < order.length; i += 1) {
    const A = boxes[order[i]];
    for (let k = i + 1; k < order.length; k += 1) {
      const B = boxes[order[k]];
      if (B.x0 >= A.x1 + CLEARANCE) break;
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + CLEARANCE;
      const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + CLEARANCE;
      if (ox <= 0 || oy <= 0) continue;
      touched = true;
      const a = nodes[order[i]];
      const b = nodes[order[k]];
      if (ox < oy) {
        const dir = A.x0 + A.x1 <= B.x0 + B.x1 ? 1 : -1;
        a.vx = (a.vx ?? 0) - dir * ox * strength;
        b.vx = (b.vx ?? 0) + dir * ox * strength;
      } else {
        const dir = A.y0 + A.y1 <= B.y0 + B.y1 ? 1 : -1;
        a.vy = (a.vy ?? 0) - dir * oy * strength;
        b.vy = (b.vy ?? 0) + dir * oy * strength;
      }
    }
  }
  return touched;
}

// Holds each dot-and-name inside the room.
function contain(nodes: LayoutNode[], room: Box, g = 1) {
  for (const n of nodes) {
    const box = nodeBox(sized(n, g));
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const nx = x + (n.vx ?? 0);
    const ny = y + (n.vy ?? 0);
    if (nx + box.x0 < room.x0) n.vx = room.x0 - box.x0 - x;
    else if (nx + box.x1 > room.x1) n.vx = room.x1 - box.x1 - x;
    if (ny + box.y0 < room.y0) n.vy = room.y0 - box.y0 - y;
    else if (ny + box.y1 > room.y1) n.vy = room.y1 - box.y1 - y;
  }
}

// Moves names off the lines: a stranger's dot-and-name steps aside (its
// line's ends give way), and the ends of a line no bend can lift off its own
// end's name step apart vertically. `strength` is how much of the way each
// call moves. Returns how many lines still ran through a name or dot.
function clearLines(nodes: LayoutNode[], pairs: Pair[], strength: number, g = 1): number {
  // A line's own end's name is checked at full size from the first tick, so
  // the map grows into lines that can clear it.
  const names = nodes.map(ownName);
  const wholes = nodes.map((n) => at(grow(nodeBox(sized(n, g)), EDGE_CLEAR), n.x ?? 0, n.y ?? 0));
  let hits = 0;
  for (const [s, t] of pairs) {
    const a = pos(s);
    const b = pos(t);
    const sx0 = Math.min(a.x, b.x);
    const sx1 = Math.max(a.x, b.x);
    const sy0 = Math.min(a.y, b.y);
    const sy1 = Math.max(a.y, b.y);
    nodes.forEach((n, i) => {
      if (n === s || n === t) {
        const other = n === s ? t : s;
        if ((n.x ?? 0) > (other.x ?? 0) || bend(pos(n), names[i], pos(other), names[i]).clear) return;
        hits += 1;
        const dir = (other.y ?? 0) >= (n.y ?? 0) ? 1 : -1;
        other.vy = (other.vy ?? 0) + dir * 4 * strength;
        n.vy = (n.vy ?? 0) - dir * 4 * strength;
        return;
      }
      const box = wholes[i];
      if (box.x1 < sx0 || box.x0 > sx1 || box.y1 < sy0 || box.y0 > sy1) return;
      if (!crosses(a, b, box)) return;
      hits += 1;
      const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t0 = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      let nx = c.x - (a.x + dx * t0);
      let ny = c.y - (a.y + dy * t0);
      let distance = Math.hypot(nx, ny);
      if (distance < 0.5) {
        nx = -dy;
        ny = dx;
        distance = 0;
      }
      const length = Math.hypot(nx, ny) || 1;
      nx /= length;
      ny /= length;
      const need =
        (Math.abs(nx) * (box.x1 - box.x0)) / 2 + (Math.abs(ny) * (box.y1 - box.y0)) / 2 - distance + 1;
      const push = Math.max(0, need) * strength;
      n.vx = (n.vx ?? 0) + nx * push;
      n.vy = (n.vy ?? 0) + ny * push;
      for (const end of [s, t]) {
        end.vx = (end.vx ?? 0) - nx * push * 0.5;
        end.vy = (end.vy ?? 0) - ny * push * 0.5;
      }
    });
  }
  return hits;
}

// Moves each dot by what the forces asked of it.
function settle(nodes: LayoutNode[]) {
  for (const n of nodes) {
    n.x = (n.x ?? 0) + (n.vx ?? 0);
    n.y = (n.y ?? 0) + (n.vy ?? 0);
    n.vx = 0;
    n.vy = 0;
  }
}

// A repeatable stream of numbers in [0, 1), so a map lays out the same way
// every time.
function randomFrom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Whether two segments cross.
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

// What each flaw costs while a layout is refined: a line under a name or
// through a dot, and names crowding, are not allowed to stay; lines crossing
// and long lines are only discouraged.
const COST = { hit: 400, crowd: 400, cross: 24, bundle: 12, bend: 14, length: 3 };
// Lines leaving one dot closer in angle than this read as one line.
const BUNDLE = 0.22;

// How a refinement runs: the line length it aims for, its seed, the room it
// keeps to and what each pixel outside costs, and how freely it moves (1 to
// reshape a group, less to tidy a finished map in place).
type Refinement = { ideal: number; seed: number; room: Box; hold: number; heat: number };

// The last word on a layout, at the size it's drawn: no line may run under
// a name (its own end's, which its bend can't clear, or a stranger's) or
// pass a stranger's dot or name closer than EDGE_CLEAR, and every
// dot-and-name keeps its air. Dots move one at a time (annealing: a worse
// spot is sometimes taken early on, rarely later) while lines stay short,
// straight and uncrossed; then any dot a flaw still touches tries rings of
// spots around itself and beside each neighbour. Returns how many dots a
// flaw still touches: none, nearly always.

function refine(nodes: LayoutNode[], pairs: Pair[], { ideal, seed, room, hold, heat }: Refinement): number {
  const count = nodes.length;
  if (count < 2) return 0;
  const random = randomFrom(seed);
  const index = new Map(nodes.map((n, i) => [n, i]));
  const ends = pairs.map(([s, t]) => [index.get(s) ?? 0, index.get(t) ?? 0] as const);
  const incident: number[][] = nodes.map(() => []);
  ends.forEach(([a, b], e) => {
    incident[a].push(e);
    incident[b].push(e);
  });
  const xs = nodes.map((n) => n.x ?? 0);
  const ys = nodes.map((n) => n.y ?? 0);
  const wholes = nodes.map((n) => grow(nodeBox(n), EDGE_CLEAR));
  const airs = nodes.map((n) => grow(nodeBox(n), CLEARANCE / 2));
  const names = nodes.map(ownName);
  const point = (i: number): Point => ({ x: xs[i], y: ys[i] });
  const lineOf = (e: number): Bend => {
    const [a, b] = ends[e];
    return bend(point(a), names[a], point(b), names[b]);
  };
  // Each line as drawn, kept current as its ends move.
  const lines = ends.map((_, e) => lineOf(e));
  const place = (i: number, x: number, y: number) => {
    xs[i] = x;
    ys[i] = y;
    for (const e of incident[i]) lines[e] = lineOf(e);
  };

  // Whether line `e` runs under node `j`'s name: its own end's, which no
  // bend could clear, or a stranger's dot-and-name with too little air.
  const hits = (e: number, j: number): boolean => {
    const [a, b] = ends[e];
    if (j === a || j === b) return !lines[e].clear;
    return bendCrosses(lines[e], at(wholes[j], xs[j], ys[j]));
  };
  const direction = (e: number, from: number) => {
    const [a, b] = ends[e];
    const to = a === from ? b : a;
    return Math.atan2(ys[to] - ys[from], xs[to] - xs[from]);
  };
  // What line `e` costs for leaving dot `at` beside another of its lines.
  const bundled = (at: number, e: number): number => {
    let cost = 0;
    const angle = direction(e, at);
    for (const f of incident[at]) {
      if (f === e) continue;
      const apart = Math.abs(((direction(f, at) - angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (apart < BUNDLE) cost += COST.bundle * (1 - apart / BUNDLE);
    }
    return cost;
  };
  // Everything that costs and depends on where dot `i` sits.
  const local = (i: number): number => {
    let cost = 0;
    for (const e of incident[i]) {
      const [a, b] = ends[e];
      cost += bundled(a, e) + bundled(b, e);
      for (let j = 0; j < count; j += 1) if (hits(e, j)) cost += COST.hit;
      const length = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) / ideal;
      cost += COST.length * length * length + COST.bend * (1 - 2 * lines[e].bow) * length;
      for (let f = 0; f < ends.length; f += 1) {
        const [c, d] = ends[f];
        if (c === a || c === b || d === a || d === b) continue;
        if (segmentsCross(point(a), point(b), point(c), point(d))) cost += COST.cross;
      }
    }
    for (let e = 0; e < ends.length; e += 1)
      if (ends[e][0] !== i && ends[e][1] !== i && hits(e, i)) cost += COST.hit;
    const mine = at(airs[i], xs[i], ys[i]);
    for (let j = 0; j < count; j += 1) {
      if (j === i) continue;
      const other = at(airs[j], xs[j], ys[j]);
      const ox = Math.min(mine.x1, other.x1) - Math.max(mine.x0, other.x0);
      const oy = Math.min(mine.y1, other.y1) - Math.max(mine.y0, other.y0);
      if (ox > 0 && oy > 0) cost += COST.crowd + Math.min(ox, oy) * 10;
    }
    cost +=
      hold *
      (Math.max(0, room.x0 - mine.x0) +
        Math.max(0, mine.x1 - room.x1) +
        Math.max(0, room.y0 - mine.y0) +
        Math.max(0, mine.y1 - room.y1));
    return cost;
  };
  const total = () => {
    let cost = 0;
    for (let i = 0; i < count; i += 1) cost += local(i);
    return cost;
  };

  const steps = Math.min(12_000, 200 * count);
  let temperature = 300 * heat;
  const cooling = Math.pow(0.5 / temperature, 1 / steps);
  let best = { cost: total(), xs: [...xs], ys: [...ys] };
  let current = best.cost;
  for (let step = 0; step < steps; step += 1, temperature *= cooling) {
    const i = Math.floor(random() * count);
    const before = local(i);
    const ox = xs[i];
    const oy = ys[i];
    const reach = ideal * (0.6 * heat * (1 - step / steps) + 0.04);
    if (incident[i].length > 0 && random() < 0.3 * heat) {
      // Beside a neighbour, above or below it.
      const [a, b] = ends[incident[i][Math.floor(random() * incident[i].length)]];
      const o = a === i ? b : a;
      const down = ideal * (0.5 + random() * 0.7) * (random() < 0.5 ? -1 : 1);
      place(i, xs[o] + (random() - 0.5) * 2 * Math.abs(down), ys[o] + down);
    } else {
      place(i, ox + (random() * 2 - 1) * reach, oy + (random() * 2 - 1) * reach);
    }
    const delta = local(i) - before;
    if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
      current += delta;
      if (current < best.cost - 1e-6) best = { cost: current, xs: [...xs], ys: [...ys] };
    } else {
      place(i, ox, oy);
    }
  }
  best.xs.forEach((x, i) => place(i, x, best.ys[i]));

  // The dots any remaining flaw touches.
  const flawed = (): Set<number> => {
    const found = new Set<number>();
    ends.forEach(([a, b], e) => {
      for (let j = 0; j < count; j += 1)
        if (hits(e, j)) {
          found.add(a);
          found.add(b);
          found.add(j);
        }
    });
    airs.forEach((box, i) => {
      for (let j = i + 1; j < count; j += 1)
        if (overlaps(at(box, xs[i], ys[i]), at(airs[j], xs[j], ys[j]))) {
          found.add(i);
          found.add(j);
        }
    });
    return found;
  };
  // Then each dot a flaw still touches tries rings of spots around itself
  // and steep spots beside each neighbour, and takes the cheapest.
  for (let round = 0; round < 12; round += 1) {
    const left = flawed();
    if (left.size === 0) break;
    for (const i of left) {
      const ox = xs[i];
      const oy = ys[i];
      const spots: Point[] = [];
      for (const radius of [6, 12, 24, 48, 96, 160])
        for (let k = 0; k < 16; k += 1) {
          const angle = (k / 16) * Math.PI * 2;
          spots.push({ x: ox + Math.cos(angle) * radius, y: oy + Math.sin(angle) * radius });
        }
      for (const e of incident[i]) {
        const [a, b] = ends[e];
        const o = a === i ? b : a;
        for (const down of [-1.2, -0.8, -0.5, 0.5, 0.8, 1.2])
          for (const across of [-1, -0.5, -0.2, 0, 0.2, 0.5, 1])
            spots.push({ x: xs[o] + across * ideal, y: ys[o] + down * ideal });
      }
      let bestCost = local(i);
      let bestSpot = { x: ox, y: oy };
      for (const spot of spots) {
        place(i, spot.x, spot.y);
        const cost = local(i);
        if (cost < bestCost - 1e-6) {
          bestCost = cost;
          bestSpot = spot;
        }
      }
      place(i, bestSpot.x, bestSpot.y);
    }
  }
  nodes.forEach((n, i) => {
    n.x = xs[i];
    n.y = ys[i];
  });
  return flawed().size;
}

type Layout = {
  nodes: LayoutNode[];
  links: LayoutLink[];
  // The view that frames the whole map: centred across the room, at its top.
  fit: ViewTransform;
};

// A group of thoughts that echo one another, laid out on its own: its dots
// sit relative to its own top-left corner, and `w`/`h` is what its dots and
// names cover. `flaws` counts what refining couldn't clear (nearly always 0).
type Cluster = { nodes: LayoutNode[]; w: number; h: number; flaws: number };

// One run of the layout from the given starting points: the group takes its
// shape from dots and lines while names grow in, then names and lines are
// eased off each other and everything is pushed fully apart inside the room.
function arrange(nodes: LayoutNode[], links: LayoutLink[], room: Box): Pair[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pairs = links.flatMap<Pair>((link) => {
    const s = byId.get(link.sourceId);
    const t = byId.get(link.targetId);
    return s && t ? [[s, t]] : [];
  });
  const cx = (room.x0 + room.x1) / 2;
  const cy = (room.y0 + room.y1) / 2;
  const spacing = Math.sqrt(((room.x1 - room.x0) * (room.y1 - room.y0)) / nodes.length);
  let g = 0;
  const simulation = forceSimulation(nodes)
    .stop()
    .force(
      "link",
      forceLink<LayoutNode, LayoutLink>(links.map((link) => ({ ...link })))
        .id((n) => n.id)
        .distance(spacing * 0.45)
        .strength(0.7),
    )
    .force("charge", forceManyBody<LayoutNode>().strength(-spacing * 1.2))
    // A pull to the middle, matched to the room's shape so the group fills
    // its width as much as its height.
    .force("x", forceX<LayoutNode>(cx).strength(0.05))
    .force("y", forceY<LayoutNode>(cy).strength(0.05 * Math.min(3, (room.x1 - room.x0) / (room.y1 - room.y0))))
    .force("lines", () => {
      clearLines(nodes, pairs, 0.2, g);
    })
    .force("names", () => {
      separate(nodes, 0.35, g);
    })
    .force("room", () => contain(nodes, room, g))
    .alphaDecay(0.02);
  const ticks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  for (let tick = 1; tick <= ticks; tick += 1) {
    g = Math.min(1, tick / GROW_TICKS);
    simulation.tick();
  }
  const step = (lines: boolean) => {
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }
    if (lines) clearLines(nodes, pairs, 0.25);
    const touched = separate(nodes, 0.5);
    contain(nodes, room);
    settle(nodes);
    return touched;
  };
  for (let pass = 1; pass <= 160; pass += 1) step(true);
  for (let pass = 0; pass < 200 && step(false); pass += 1);
  return pairs;
}

// Whether two lines cross away from a shared end.
function linesCross([a, b]: Pair, [c, d]: Pair): boolean {
  if (a === c || a === d || b === c || b === d) return false;
  return segmentsCross(pos(a), pos(b), pos(c), pos(d));
}

// How cleanly a run came out: names still touching, lines through a
// stranger's dot or name, lines through their own end's name, lines crossing
// each other, and length.
function untidiness(nodes: LayoutNode[], pairs: Pair[], spacing: number): number {
  const wholes = nodes.map((n) => at(grow(nodeBox(n), CLEARANCE / 2 - 1), n.x ?? 0, n.y ?? 0));
  let total = 0;
  wholes.forEach((a, i) =>
    wholes.forEach((b, k) => {
      if (i < k && overlaps(a, b)) total += 20;
    }),
  );
  pairs.forEach((pair, i) => {
    const [s, t] = pair;
    const a = pos(s);
    const b = pos(t);
    total += Math.hypot(b.x - a.x, b.y - a.y) / spacing;
    for (let k = i + 1; k < pairs.length; k += 1) if (linesCross(pair, pairs[k])) total += 4;
    const line = bend(a, ownName(s), b, ownName(t));
    if (!line.clear) total += 10;
    nodes.forEach((n, j) => {
      if (n !== s && n !== t && bendCrosses(line, wholes[j])) total += 6;
    });
  });
  return total;
}

// What a set of dots and names covers.
function extent(nodes: LayoutNode[]): Box {
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

// Lays one group out in screen pixels, so every name's real size takes part:
// its dots spread through a room of the given shape, sized to what they
// carry, until each name has its own space, clear of other names, other dots
// and the lines. It's laid out from a few starting points; the tidiest are
// refined and the cleanest kept.
function layoutCluster(thoughts: GraphThought[], links: LayoutLink[], shapes: Shape[], aspect: number): Cluster {
  const boxes = shapes.map(nodeBox);
  const needed =
    boxes.reduce((sum, box) => sum + (box.x1 - box.x0 + CLEARANCE) * (box.y1 - box.y0 + CLEARANCE), 0) * PACKING;
  const width = Math.max(...boxes.map((box) => box.x1 - box.x0 + CLEARANCE), Math.sqrt(needed * aspect));
  const room: Box = { x0: 0, y0: 0, x1: width, y1: Math.max(...boxes.map((box) => box.y1 - box.y0), needed / width) };
  const spacing = Math.sqrt((room.x1 * room.y1) / thoughts.length);

  const attempts = thoughts.length <= 40 ? ATTEMPTS : thoughts.length <= 120 ? 3 : 1;
  const runs = Array.from({ length: attempts }, (_, attempt) => {
    const nodes = thoughts.map<LayoutNode>((thought, i) => {
      const value = hash(`${attempt}:${thought._id}`);
      const angle = ((value % 3_600) / 3_600) * Math.PI * 2;
      const reach = 0.1 + (((value >>> 12) % 1_000) / 1_000) * 0.3;
      return {
        id: thought._id,
        thought,
        ...shapes[i],
        x: room.x1 / 2 + Math.cos(angle) * reach * room.x1,
        y: room.y1 / 2 + Math.sin(angle) * reach * room.y1,
      };
    });
    const pairs = arrange(nodes, links, room);
    return { attempt, nodes, pairs, score: untidiness(nodes, pairs, spacing) };
  });
  const finalists = runs.sort((a, b) => a.score - b.score).slice(0, thoughts.length <= 40 ? FINALISTS : 1);
  let best: { nodes: LayoutNode[]; score: number; flaws: number } | undefined;
  for (const { attempt, nodes, pairs } of finalists) {
    const flaws = refine(nodes, pairs, { ideal: spacing * 0.45, seed: hash(`${attempt}:${aspect}`), room, hold: 2, heat: 1 });
    const score = flaws * 100 + untidiness(nodes, pairs, spacing);
    if (!best || score < best.score) best = { nodes, score, flaws };
  }
  const nodes = best?.nodes ?? [];
  const box = extent(nodes);
  for (const n of nodes) {
    n.x = (n.x ?? 0) - box.x0;
    n.y = (n.y ?? 0) - box.y0;
  }
  return { nodes, w: box.x1 - box.x0, h: box.y1 - box.y0, flaws: best?.flaws ?? 0 };
}

// A group of thoughts that echo one another, in each shape it was laid out
// in; packing picks the one that suits its place.
type Group = { size: number; forms: Cluster[] };

// Groups already laid out, by what they hold, so a page that arrives or a
// resize leaves unchanged groups exactly as they were.
const groupCache = new Map<string, Group>();

// The map is of what echoes what: thoughts with no echo yet stay off it
// (each one's page still says so) rather than floating as stray dots. The
// rest fall into groups — thoughts linked to one another, directly or
// through others — each laid out on its own.
function layoutGroups(
  thoughts: GraphThought[],
  returnedId: string | null,
): { groups: Group[]; links: LayoutLink[] } {
  const allIds = new Set(thoughts.map((thought) => thought._id));
  const degree = new Map<string, number>();
  const links: LayoutLink[] = [];
  const seen = new Set<string>();
  const root = new Map<string, string>();
  const find = (id: string): string => {
    const parent = root.get(id) ?? id;
    if (parent === id) return id;
    const top = find(parent);
    root.set(id, top);
    return top;
  };
  for (const thought of thoughts)
    for (const connection of thought.connections) {
      const key = [thought._id, connection.toId].sort().join(":");
      if (!allIds.has(connection.toId) || connection.toId === thought._id || seen.has(key)) continue;
      seen.add(key);
      links.push({
        id: connection._id,
        source: thought._id,
        target: connection.toId,
        sourceId: thought._id,
        targetId: connection.toId,
      });
      degree.set(thought._id, (degree.get(thought._id) ?? 0) + 1);
      degree.set(connection.toId, (degree.get(connection.toId) ?? 0) + 1);
      root.set(find(thought._id), find(connection.toId));
    }
  const members = new Map<string, GraphThought[]>();
  for (const thought of thoughts) {
    if (!degree.has(thought._id)) continue;
    const top = find(thought._id);
    members.set(top, [...(members.get(top) ?? []), thought]);
  }
  if (groupCache.size > 400) groupCache.clear();
  const groups = [...members.values()].map((group) => {
    const ids = new Set<string>(group.map((thought) => thought._id));
    const own = links.filter((link) => ids.has(link.sourceId));
    const today = returnedId !== null && ids.has(returnedId) ? returnedId : null;
    const key = JSON.stringify([group.map((thought) => [thought._id, thought.text]), own.map((link) => link.id), today]);
    const cached = groupCache.get(key);
    if (cached) return cached;
    const shapes = group.map((thought) => shape(thought, degree.get(thought._id) ?? 0, thought._id === today));
    const aspects = group.length <= SMALL_CLUSTER ? CLUSTER_ASPECTS : CLUSTER_ASPECTS.slice(0, 1);
    const forms = aspects.map((aspect) => layoutCluster(group, own, shapes, aspect));
    // Packing chooses among the shapes that came out clean, when any did.
    const clean = forms.filter((form) => form.flaws === 0);
    const laid: Group = { size: group.length, forms: clean.length > 0 ? clean : forms };
    groupCache.set(key, laid);
    return laid;
  });
  return { groups, links };
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

// Places the groups in the room: as far apart as the room allows, then
// framed and centred. A map too large for the room starts zoomed out (and
// names wait for zooming in).
function computeLayout(groups: Group[], links: LayoutLink[], width: number, height: number): Layout {
  if (groups.length === 0) return { nodes: [], links, fit: { x: 0, y: 0, scale: 1 } };
  const room = {
    w: Math.max(200, width - FRAME.left - FRAME.right),
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
      (1 - Math.min(1, (bw * bh) / (room.w * room.h))) * 3;
    if (!best || score < best.score) best = { placed, scale, score };
  }
  const { placed, scale } = best as { placed: Placed[]; scale: number };
  // Each group comes clear of its lines at full size; a map drawn smaller
  // is refined again as drawn.
  const nodes = placed.flatMap((p) =>
    p.cluster.nodes.map((n) => ({ ...n, x: (p.x0 + (n.x ?? 0)) * scale, y: (p.y0 + (n.y ?? 0)) * scale })),
  );
  if (scale < 1 && nodes.length <= REFINED_MAP) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pairs = links.flatMap<Pair>((link) => {
      const s = byId.get(link.sourceId);
      const t = byId.get(link.targetId);
      return s && t ? [[s, t]] : [];
    });
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
  for (const n of nodes) {
    n.x = (n.x ?? 0) / scale;
    n.y = (n.y ?? 0) / scale;
  }
  // Names keep their size on screen, so the frame is measured as drawn.
  const box = extent(nodes.map((n) => ({ ...n, x: (n.x ?? 0) * scale, y: (n.y ?? 0) * scale })));
  return {
    nodes,
    links,
    fit: {
      scale,
      x: FRAME.left + (room.w - (box.x1 - box.x0)) / 2 - box.x0,
      y: FRAME.top - box.y0,
    },
  };
}

// Which names show at this zoom. At the fitted view every name has room;
// zoomed out, they're named in turn — the thought in hand and its
// neighbours, today's, then the most connected, then the newest — each only
// where it keeps clear of the names already placed and of every dot.
function placeLabels({
  nodes,
  degree,
  view,
  first,
  among,
}: {
  nodes: LayoutNode[];
  degree: Map<string, number>;
  view: ViewTransform;
  first: string[];
  among?: Set<string>;
}): Set<string> {
  const screen = (n: LayoutNode): Point => ({
    x: view.x + (n.x ?? 0) * view.scale,
    y: view.y + (n.y ?? 0) * view.scale,
  });
  const firstSet = new Set(first);
  const dots = nodes.map((n) => {
    const p = screen(n);
    return { id: n.id, near: firstSet.has(n.id), box: grow(at({ x0: -n.r, y0: -n.r, x1: n.r, y1: n.r }, p.x, p.y), 2) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rest = nodes
    .filter((n) => !firstSet.has(n.id) && (!among || among.has(n.id)))
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        b.thought.createdAt - a.thought.createdAt,
    );
  const order = [...first.flatMap((id) => byId.get(id) ?? []), ...rest];
  const placed: Box[] = [];
  const result = new Set<string>();
  order.forEach((n, index) => {
    const p = screen(n);
    const name = at(labelBox(n), p.x, p.y);
    const near = firstSet.has(n.id);
    const blocked =
      placed.some((other) => overlaps(name, other)) ||
      dots.some((dot) => dot.id !== n.id && (dot.near || !near) && overlaps(name, dot.box));
    if (!blocked || (index === 0 && first.length > 0)) {
      placed.push(grow(name, 2));
      result.add(n.id);
    }
  });
  return result;
}

export function ConnectionsGraph({
  thoughts,
  loading,
  returnedId,
}: {
  thoughts: GraphThought[];
  loading: boolean;
  // Today's returned thought: the one "now" on the map.
  returnedId: string | null;
}) {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLDivElement>(null);
  const pan = useRef<
    { pointerId: number; origin: Point; transform: ViewTransform } | undefined
  >(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fontsReady, setFontsReady] = useState(() => document.fonts.status === "loaded");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Set once the reader pans or zooms; until then the map stays fitted.
  const [userView, setUserView] = useState<ViewTransform | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Names are measured in Geist, so the layout waits for it.
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // Pages arrive again as new arrays with the same thoughts; the map is laid
  // out again only when what it shows has changed.
  const signature = useMemo(
    () =>
      JSON.stringify(
        thoughts.map((t) => [t._id, t.text, t.status, t.connections.map((c) => c._id)]),
      ),
    [thoughts],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content
  const shown = useMemo(() => thoughts, [signature]);
  // Groups take their shape from what they hold alone; a resize only
  // packs them again.
  const groups = useMemo(
    () => (fontsReady ? layoutGroups(shown, returnedId) : { groups: [], links: [] }),
    [shown, fontsReady, returnedId],
  );
  const layout = useMemo<Layout>(
    () =>
      size.width === 0
        ? { nodes: [], links: [], fit: { x: 0, y: 0, scale: 1 } }
        : computeLayout(groups.groups, groups.links, size.width, size.height),
    [groups, size.width, size.height],
  );
  const view = userView ?? layout.fit;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The find sheet can stand open over this page; while it does,
      // escape belongs to it (see features/search/FindSheet).
      if (document.querySelector("[data-overlay]") !== null) return;
      void navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const byId = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const degree = useMemo(() => {
    const values = new Map<string, number>();
    for (const link of layout.links) {
      values.set(link.sourceId, (values.get(link.sourceId) ?? 0) + 1);
      values.set(link.targetId, (values.get(link.targetId) ?? 0) + 1);
    }
    return values;
  }, [layout.links]);
  const neighbors = useMemo(() => {
    if (!activeId) return new Set<string>();
    const values = new Set<string>();
    for (const link of layout.links) {
      if (link.sourceId === activeId) values.add(link.targetId);
      if (link.targetId === activeId) values.add(link.sourceId);
    }
    return values;
  }, [activeId, layout.links]);
  const active = activeId ? byId.get(activeId)?.thought : undefined;

  const restingLabels = useMemo(
    () =>
      placeLabels({
        nodes: layout.nodes,
        degree,
        view,
        first: returnedId && byId.has(returnedId) ? [returnedId] : [],
      }),
    [byId, degree, layout.nodes, returnedId, view],
  );
  // With a thought in hand, it and its neighbours are named first; the
  // resting names that still fit stay, stepped back.
  const labels = useMemo(() => {
    if (!activeId) return restingLabels;
    const circle = [...neighbors].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
    return placeLabels({
      nodes: layout.nodes,
      degree,
      view,
      first: [activeId, ...circle],
      among: restingLabels,
    });
  }, [activeId, degree, layout.nodes, neighbors, restingLabels, view]);

  const open = (id: string) => {
    void navigate({
      to: "/thought/$thoughtId",
      params: { thoughtId: id },
    });
  };
  const onNodeKeyDown = (event: ReactKeyboardEvent<SVGGElement>, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open(id);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-thought-node]")) return;
    pan.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      transform: view,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pan.current || pan.current.pointerId !== event.pointerId) return;
    // Only a real drag hands the view to the reader — a bare click keeps
    // the map fitted while pages are still arriving.
    setUserView({
      ...pan.current.transform,
      x: pan.current.transform.x + event.clientX - pan.current.origin.x,
      y: pan.current.transform.y + event.clientY - pan.current.origin.y,
    });
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, view.scale * Math.exp(-event.deltaY * 0.0012)),
    );
    const world = {
      x: (cursor.x - view.x) / view.scale,
      y: (cursor.y - view.y) / view.scale,
    };
    setUserView({
      x: cursor.x - world.x * scale,
      y: cursor.y - world.y * scale,
      scale,
    });
  };

  const screen = (node: LayoutNode): Point => ({
    x: view.x + (node.x ?? 0) * view.scale,
    y: view.y + (node.y ?? 0) * view.scale,
  });

  return (
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      {thoughts.length === 0 ? (
        <div className="flex h-full items-center justify-center pb-20 text-[14px] text-pl">
          {loading ? <span className="caret h-5 w-0.5 rounded-full bg-dot" /> : "No thoughts yet"}
        </div>
      ) : (
        <>
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            className={`block size-full touch-none ${pan.current ? "cursor-grabbing" : "cursor-grab"}`}
            aria-label="connections between all thoughts"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <g aria-hidden="true" className="pointer-events-none">
              {layout.links.map((link) => {
                const source = byId.get(link.sourceId);
                const target = byId.get(link.targetId);
                if (!source || !target) return null;
                const near = activeId === link.sourceId || activeId === link.targetId;
                const { from, via, to } = bend(screen(source), ownName(source), screen(target), ownName(target));
                return (
                  <path
                    key={link.id}
                    d={`M${from.x} ${from.y}Q${via.x} ${via.y} ${to.x} ${to.y}`}
                    fill="none"
                    className={`transition-[stroke,opacity] duration-200 ${
                      near ? "stroke-mut" : activeId ? "map-edge opacity-40" : "map-edge"
                    }`}
                    strokeWidth={1}
                  />
                );
              })}
            </g>

            {layout.nodes.map((node) => {
              const selected = node.id === activeId;
              const near = selected || neighbors.has(node.id);
              const connected = degree.get(node.id) ?? 0;
              const { x, y } = screen(node);
              const returned = node.id === returnedId;
              const resting = node.thought.status === "resting";
              return (
                <g
                  key={node.id}
                  data-thought-node
                  role="link"
                  tabIndex={0}
                  aria-label={`${node.thought.text}, ${connected} connection${connected === 1 ? "" : "s"}${resting ? ", set down" : ""}`}
                  className={`cursor-pointer outline-none transition-opacity duration-200 ${activeId && !near ? "opacity-25" : ""}`}
                  onPointerEnter={() => setActiveId(node.id)}
                  onPointerLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(node.id)}
                  onBlur={() => setActiveId(null)}
                  onClick={() => open(node.id)}
                  onKeyDown={(event) => onNodeKeyDown(event, node.id)}
                  transform={`translate(${x} ${y})`}
                >
                  <circle r={16} fill="transparent" />
                  {selected && <circle r={node.r + 6} className="fill-ink/10" />}
                  {returned && !selected && <circle r={node.r + 5} className="fill-dot/15" />}
                  <circle
                    r={resting ? node.r - 0.6 : node.r}
                    className={
                      returned
                        ? "fill-dot stroke-pg"
                        : resting
                          ? `fill-pg ${selected ? "stroke-ink" : "stroke-faint"}`
                          : selected
                            ? "fill-ink stroke-pg"
                            : "fill-mut stroke-pg"
                    }
                    strokeWidth={resting ? 1.25 : 1.5}
                  />
                </g>
              );
            })}

            {/* Names sit above every dot and line; the ones in hand on top. */}
            <g aria-hidden="true" className="pointer-events-none">
              {layout.nodes
                .filter((node) => labels.has(node.id))
                .sort(
                  (a, b) =>
                    Number(a.id === activeId || neighbors.has(a.id)) -
                    Number(b.id === activeId || neighbors.has(b.id)),
                )
                .map((node) => {
                  const selected = node.id === activeId;
                  const near = selected || neighbors.has(node.id);
                  const { voice } = node;
                  const lead = voice !== PLAIN;
                  const first = -((node.lines.length - 1) * voice.leading) / 2;
                  const textX = node.r + LABEL_GAP;
                  const { x, y } = screen(node);
                  return (
                    <text
                      key={node.id}
                      transform={`translate(${x} ${y})`}
                      dominantBaseline="central"
                      paintOrder="stroke"
                      strokeWidth={HALO}
                      strokeLinejoin="round"
                      fontSize={voice.size}
                      fontWeight={voice.weight}
                      className={`stroke-pg transition-[fill,opacity] duration-200 ${near || lead ? "fill-ink" : "fill-pt"} ${activeId && !near ? "opacity-40" : ""}`}
                    >
                      {node.lines.map((line, i) => (
                        <tspan key={i} x={textX} y={first + i * voice.leading}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  );
                })}
            </g>
          </svg>

          {!active && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6">
              <div className="mx-auto flex w-full max-w-[688px] items-center justify-between gap-6 px-10 text-[13px] text-pl">
                <p className="flex items-center gap-4">
                  {returnedId && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-2 rounded-full bg-dot" />
                      Back today
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full bg-mut" />
                    Kept
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full border-[1.5px] border-faint" />
                    Set down
                  </span>
                </p>
                <p>Point to preview · click to open · scroll to zoom</p>
              </div>
            </div>
          )}
          {active && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute bottom-7 left-1/2 w-[min(600px,70%)] -translate-x-1/2 rounded-[16px] bg-scr/95 px-6 py-4 text-center shadow-lift ring-1 ring-line ring-inset backdrop-blur"
            >
              <div className="text-[13px] text-pl first-letter:uppercase">
                {dateLine(active.createdAt, Date.now())}
                {active.status === "resting" && ", set down"}
              </div>
              <div className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap text-[18px] leading-relaxed tracking-[-0.01em] text-ink">
                {active.text}
              </div>
              <div className="mt-2 text-[12.5px] text-pl">
                {degree.get(active._id) ?? 0} connection
                {(degree.get(active._id) ?? 0) === 1 ? "" : "s"}. Click to open.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
