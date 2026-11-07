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

type LabelSide = "right" | "left";
type Box = { x0: number; y0: number; x1: number; y1: number };
type Point = { x: number; y: number };
type ViewTransform = { x: number; y: number; scale: number };

// A dot and its name, as they sit on screen.
type Shape = { r: number; lines: string[]; w: number; h: number };

type LayoutNode = SimulationNodeDatum &
  Shape & {
    id: string;
    thought: GraphThought;
    side: LabelSide;
  };

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  id: string;
  sourceId: string;
  targetId: string;
};

const MIN_SCALE = 0.36;
const MAX_SCALE = 3.2;

// Names and dots keep their size on screen; zoom changes only the spacing.
const FONT_SIZE = 13;
const LINE_HEIGHT = 17;
const LABEL_GAP = 7;
const LABEL_WIDTH = 164;
// The paper-coloured outline around each letter, for the rare line it crosses.
const HALO = 3;
// The least air between one dot-and-name and the next.
const CLEARANCE = 12;
// The map's room: below the subtitle, above the footer row.
const FRAME = { top: 12, bottom: 72, left: 40, right: 40 };
// How much room a group's dots and names get to spread through, and its shape.
const PACKING = 1.9;
const CLUSTER_ASPECT = 1.2;
// The air between groups, widest first, narrowed only to fit the room.
const CLUSTER_GAPS = [104, 84, 68, 52, 40];
// Simulation ticks over which names grow from nothing to full size.
const GROW_TICKS = 140;
// Fresh layouts tried for a small group; the cleanest is kept.
const ATTEMPTS = 12;

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
function textWidth(text: string): number {
  const cached = widthCache.get(text);
  if (cached !== undefined) return cached;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 6.6;
  measureContext.font = `400 ${FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`;
  const width = measureContext.measureText(text).width;
  if (document.fonts.status === "loaded") widthCache.set(text, width);
  return width;
}

const JOINING = new Set(
  "a an the of in on at to for from with by and or but as is are was were be your my our their its that".split(" "),
);

// A thought's name: up to two lines broken at words; a longer thought ends
// in an ellipsis after a whole word.
function labelLines(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > LABEL_WIDTH) {
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
      (textWidth(`${last.join(" ")}…`) > LABEL_WIDTH ||
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
      const widest = Math.max(...pair.map(textWidth));
      if (widest <= LABEL_WIDTH && widest < Math.max(...best.map(textWidth))) best = pair;
    }
    return best;
  }
  return lines;
}

// Size says how connected a thought is.
function nodeRadius(connected: number): number {
  return Math.min(6, 3.5 + Math.max(0, connected - 1) * 0.625);
}

function shape(thought: GraphThought, connected: number): Shape {
  const lines = labelLines(thought.text);
  return {
    r: nodeRadius(connected),
    lines,
    w: Math.max(...lines.map(textWidth)),
    h: lines.length * LINE_HEIGHT,
  };
}

// A dot with its name beside it, relative to the dot.
function nodeBox(n: Shape, side: LabelSide): Box {
  const half = Math.max(n.r, n.h / 2);
  return side === "right"
    ? { x0: -n.r, y0: -half, x1: n.r + LABEL_GAP + n.w, y1: half }
    : { x0: -(n.r + LABEL_GAP + n.w), y0: -half, x1: n.r, y1: half };
}

// Just the name, with its halo, relative to the dot.
function labelBox(n: Shape, side: LabelSide): Box {
  const x = n.r + LABEL_GAP;
  return side === "right"
    ? { x0: x - HALO, y0: -n.h / 2 - HALO, x1: x + n.w + HALO, y1: n.h / 2 + HALO }
    : { x0: -x - n.w - HALO, y0: -n.h / 2 - HALO, x1: -x + HALO, y1: n.h / 2 + HALO };
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

// A name partway grown in: the map takes its shape from dots and lines
// first, then names swell to full size and push room for themselves.
const sized = (n: Shape, g: number): Shape => (g >= 1 ? n : { ...n, w: n.w * g, h: n.h * g });

// Keeps every dot-and-name clear of every other by CLEARANCE, pushing apart
// along the shallower overlap. Returns whether anything still touched.
function separate(nodes: LayoutNode[], strength: number, g = 1): boolean {
  const boxes = nodes.map((n) =>
    at(nodeBox(sized(n, g), n.side), (n.x ?? 0) + (n.vx ?? 0), (n.y ?? 0) + (n.vy ?? 0)),
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
    const box = nodeBox(sized(n, g), n.side);
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

// Moves names off the lines: a stranger's name steps aside (its line's ends
// give way), and a line running through its own end's name turns away.
function clearLines(nodes: LayoutNode[], pairs: Array<[LayoutNode, LayoutNode]>, g = 1) {
  // A line keeps clear of its own end's name, and of a stranger's dot and name.
  const names = nodes.map((n) => at(grow(labelBox(sized(n, g), n.side), 2), n.x ?? 0, n.y ?? 0));
  const wholes = nodes.map((n) => at(grow(nodeBox(sized(n, g), n.side), 4), n.x ?? 0, n.y ?? 0));
  for (const [s, t] of pairs) {
    const a = pos(s);
    const b = pos(t);
    const sx0 = Math.min(a.x, b.x);
    const sx1 = Math.max(a.x, b.x);
    const sy0 = Math.min(a.y, b.y);
    const sy1 = Math.max(a.y, b.y);
    nodes.forEach((n, i) => {
      const own = n === s || n === t;
      const box = own ? names[i] : wholes[i];
      if (box.x1 < sx0 || box.x0 > sx1 || box.y1 < sy0 || box.y0 > sy1) return;
      if (!crosses(a, b, box)) return;
      if (own) {
        const other = n === s ? t : s;
        const dir = (other.y ?? 0) >= (n.y ?? 0) ? 1 : -1;
        other.vy = (other.vy ?? 0) + dir * 1.2;
        n.vy = (n.vy ?? 0) - dir * 0.6;
        return;
      }
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
        (Math.abs(nx) * (box.x1 - box.x0)) / 2 + (Math.abs(ny) * (box.y1 - box.y0)) / 2 - distance + 2;
      const push = Math.max(0, need) * 0.25;
      n.vx = (n.vx ?? 0) + nx * push;
      n.vy = (n.vy ?? 0) + ny * push;
      for (const end of [s, t]) {
        end.vx = (end.vx ?? 0) - nx * push * 0.5;
        end.vy = (end.vy ?? 0) - ny * push * 0.5;
      }
    });
  }
}

// Turns a name to the dot's left where that crosses fewer lines and names.
function chooseSides(nodes: LayoutNode[], pairs: Array<[LayoutNode, LayoutNode]>, room: Box) {
  const cost = (n: LayoutNode, side: LabelSide) => {
    const p = pos(n);
    const name = at(labelBox(n, side), p.x, p.y);
    const whole = at(nodeBox(n, side), p.x, p.y);
    let total = 0;
    // A line through the dot's own name reads worse than a stranger's.
    for (const [s, t] of pairs) if (crosses(pos(s), pos(t), name)) total += s === n || t === n ? 2 : 1;
    for (const other of nodes)
      if (other !== n && overlaps(grow(whole, CLEARANCE / 2), at(nodeBox(other, other.side), other.x ?? 0, other.y ?? 0)))
        total += 10;
    if (whole.x0 < room.x0 || whole.x1 > room.x1) total += 10;
    return total;
  };
  for (const n of nodes) {
    const other: LabelSide = n.side === "right" ? "left" : "right";
    // Names read to the right unless the left is clearly better.
    if (cost(n, other) + (other === "left" ? 0.5 : 0) < cost(n, n.side)) n.side = other;
  }
}

type Layout = {
  nodes: LayoutNode[];
  links: LayoutLink[];
  // The view that frames the whole map, centred in the room.
  fit: ViewTransform;
};

type Pair = [LayoutNode, LayoutNode];

// A group of thoughts that echo one another, laid out on its own: its dots
// sit relative to its own top-left corner, and `w`/`h` is what its dots and
// names cover.
type Cluster = { nodes: LayoutNode[]; w: number; h: number };

// One run of the layout from the given starting points: the group takes its
// shape from dots and lines while names grow in, names choose a side, then
// names and lines are eased off each other and everything is pushed fully
// apart inside the room.
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
    .force("lines", () => clearLines(nodes, pairs, g))
    .force("names", () => {
      separate(nodes, 0.35, g);
    })
    .force("room", () => contain(nodes, room, g))
    .alphaDecay(0.02);
  const ticks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  for (let tick = 1; tick <= ticks; tick += 1) {
    g = Math.min(1, tick / GROW_TICKS);
    simulation.tick();
    if (tick === 160 || tick === 220 || tick === 280) chooseSides(nodes, pairs, room);
  }
  const step = (lines: boolean) => {
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }
    if (lines) clearLines(nodes, pairs);
    const touched = separate(nodes, 0.5);
    contain(nodes, room);
    for (const n of nodes) {
      n.x = (n.x ?? 0) + (n.vx ?? 0);
      n.y = (n.y ?? 0) + (n.vy ?? 0);
      n.vx = 0;
      n.vy = 0;
    }
    return touched;
  };
  for (let pass = 1; pass <= 160; pass += 1) {
    step(true);
    if (pass % 40 === 0 && pass < 160) chooseSides(nodes, pairs, room);
  }
  for (let pass = 0; pass < 200 && step(false); pass += 1);
  return pairs;
}

// Whether two lines cross away from a shared end.
function linesCross([a, b]: Pair, [c, d]: Pair): boolean {
  if (a === c || a === d || b === c || b === d) return false;
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const [pa, pb, pc, pd] = [pos(a), pos(b), pos(c), pos(d)];
  return side(pa, pb, pc) * side(pa, pb, pd) < 0 && side(pc, pd, pa) * side(pc, pd, pb) < 0;
}

// How cleanly a run came out: names still touching, lines through a
// stranger's dot or name, lines through their own end's name, lines crossing
// each other, and length.
function untidiness(nodes: LayoutNode[], pairs: Pair[], spacing: number): number {
  const wholes = nodes.map((n) => at(grow(nodeBox(n, n.side), CLEARANCE / 2 - 1), n.x ?? 0, n.y ?? 0));
  const names = nodes.map((n) => at(labelBox(n, n.side), n.x ?? 0, n.y ?? 0));
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
    nodes.forEach((n, j) => {
      if (n === s || n === t) {
        if (crosses(a, b, names[j])) total += 2;
      } else if (crosses(a, b, wholes[j])) total += 6;
    });
  });
  return total;
}

// What a set of dots and names covers.
function extent(nodes: LayoutNode[]): Box {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of nodes) {
    const b = at(nodeBox(n, n.side), n.x ?? 0, n.y ?? 0);
    box.x0 = Math.min(box.x0, b.x0);
    box.y0 = Math.min(box.y0, b.y0);
    box.x1 = Math.max(box.x1, b.x1);
    box.y1 = Math.max(box.y1, b.y1);
  }
  return box;
}

// Lays one group out in screen pixels, so every name's real size takes part:
// its dots spread through a room sized to what they carry until each name
// has its own space, clear of other names, other dots and, where it can be,
// the lines. It's laid out from a few starting points and the cleanest kept.
function layoutCluster(thoughts: GraphThought[], links: LayoutLink[], degree: Map<string, number>): Cluster {
  const shapes = thoughts.map((thought) => shape(thought, degree.get(thought._id) ?? 0));
  const boxes = shapes.map((n) => nodeBox(n, "right"));
  const needed =
    boxes.reduce((sum, box) => sum + (box.x1 - box.x0 + CLEARANCE) * (box.y1 - box.y0 + CLEARANCE), 0) * PACKING;
  const width = Math.max(...boxes.map((box) => box.x1 - box.x0 + CLEARANCE), Math.sqrt(needed * CLUSTER_ASPECT));
  const room: Box = { x0: 0, y0: 0, x1: width, y1: Math.max(...boxes.map((box) => box.y1 - box.y0), needed / width) };
  const spacing = Math.sqrt((room.x1 * room.y1) / thoughts.length);

  let best: { nodes: LayoutNode[]; score: number } | undefined;
  const attempts = thoughts.length <= 40 ? ATTEMPTS : thoughts.length <= 120 ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const nodes = thoughts.map<LayoutNode>((thought, i) => {
      const value = hash(`${attempt}:${thought._id}`);
      const angle = ((value % 3_600) / 3_600) * Math.PI * 2;
      const reach = 0.1 + (((value >>> 12) % 1_000) / 1_000) * 0.3;
      return {
        id: thought._id,
        thought,
        side: "right",
        ...shapes[i],
        x: room.x1 / 2 + Math.cos(angle) * reach * room.x1,
        y: room.y1 / 2 + Math.sin(angle) * reach * room.y1,
      };
    });
    const pairs = arrange(nodes, links, room);
    const score = untidiness(nodes, pairs, spacing);
    if (!best || score < best.score) best = { nodes, score };
  }
  const nodes = best?.nodes ?? [];
  const box = extent(nodes);
  for (const n of nodes) {
    n.x = (n.x ?? 0) - box.x0;
    n.y = (n.y ?? 0) - box.y0;
  }
  return { nodes, w: box.x1 - box.x0, h: box.y1 - box.y0 };
}

// Groups already laid out, by what they hold, so a page that arrives or a
// resize leaves unchanged groups exactly as they were.
const clusterCache = new Map<string, Cluster>();

// The map is of what echoes what: thoughts with no echo yet stay off it
// (each one's page still says so) rather than floating as stray dots. The
// rest fall into groups — thoughts linked to one another, directly or
// through others — each laid out on its own.
function layoutClusters(thoughts: GraphThought[]): { clusters: Cluster[]; links: LayoutLink[] } {
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
  const groups = new Map<string, GraphThought[]>();
  for (const thought of thoughts) {
    if (!degree.has(thought._id)) continue;
    const top = find(thought._id);
    groups.set(top, [...(groups.get(top) ?? []), thought]);
  }
  if (clusterCache.size > 400) clusterCache.clear();
  const clusters = [...groups.values()].map((members) => {
    const ids = new Set<string>(members.map((thought) => thought._id));
    const own = links.filter((link) => ids.has(link.sourceId));
    const key = JSON.stringify([members.map((thought) => [thought._id, thought.text]), own.map((link) => link.id)]);
    const cached = clusterCache.get(key);
    if (cached) return cached;
    const cluster = layoutCluster(members, own, degree);
    clusterCache.set(key, cluster);
    return cluster;
  });
  return { clusters, links };
}

type Placed = Box & { cluster: Cluster };

// Packs the groups around the largest, each set beside one already placed
// with `gap` between them, choosing the spot that keeps the whole map most
// compact for the room's shape and, after that, nearest its middle.
function pack(clusters: Cluster[], gap: number, room: { w: number; h: number }): Placed[] {
  const order = [...clusters].sort((a, b) => b.nodes.length - a.nodes.length || b.w * b.h - a.w * a.h);
  const placed: Placed[] = [];
  const bound = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (const cluster of order) {
    const { w, h } = cluster;
    if (placed.length === 0) {
      placed.push({ x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2, cluster });
      Object.assign(bound, placed[0]);
      continue;
    }
    let best: { box: Box; score: number } | undefined;
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
        // The whole map's reach against the room's shape (its longer side
        // first, then both) — least wins.
        const across = bw / room.w;
        const down = bh / room.h;
        const middle = Math.hypot((box.x0 + box.x1) / 2 / room.w, (box.y0 + box.y1) / 2 / room.h);
        const score = Math.max(across, down) * 10 + (across + down) * 3 + middle;
        if (!best || score < best.score) best = { box, score };
      }
    }
    if (!best) continue;
    placed.push({ ...best.box, cluster });
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
function computeLayout(clusters: Cluster[], links: LayoutLink[], width: number, height: number): Layout {
  if (clusters.length === 0) return { nodes: [], links, fit: { x: 0, y: 0, scale: 1 } };
  const room = {
    w: Math.max(200, width - FRAME.left - FRAME.right),
    h: Math.max(200, height - FRAME.top - FRAME.bottom),
  };
  let best: { placed: Placed[]; scale: number } | undefined;
  for (const gap of CLUSTER_GAPS) {
    const placed = pack(clusters, gap, room);
    const bw = Math.max(...placed.map((p) => p.x1)) - Math.min(...placed.map((p) => p.x0));
    const bh = Math.max(...placed.map((p) => p.y1)) - Math.min(...placed.map((p) => p.y0));
    const scale = Math.max(MIN_SCALE, Math.min(1, room.w / bw, room.h / bh));
    if (!best || scale > best.scale + 0.001) best = { placed, scale };
    if (scale >= 1) break;
  }
  const { placed, scale } = best as { placed: Placed[]; scale: number };
  const nodes = placed.flatMap((p) =>
    p.cluster.nodes.map((n) => ({ ...n, x: p.x0 + (n.x ?? 0), y: p.y0 + (n.y ?? 0) })),
  );
  // Names keep their size on screen, so the frame is measured as drawn.
  const box = extent(nodes.map((n) => ({ ...n, x: (n.x ?? 0) * scale, y: (n.y ?? 0) * scale })));
  return {
    nodes,
    links,
    fit: {
      scale,
      x: FRAME.left + (room.w - (box.x1 - box.x0)) / 2 - box.x0,
      y: FRAME.top + (room.h - (box.y1 - box.y0)) / 2 - box.y0,
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
    const name = at(labelBox(n, n.side), p.x, p.y);
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
    () => (fontsReady ? layoutClusters(shown) : { clusters: [], links: [] }),
    [shown, fontsReady],
  );
  const layout = useMemo<Layout>(
    () =>
      size.width === 0
        ? { nodes: [], links: [], fit: { x: 0, y: 0, scale: 1 } }
        : computeLayout(groups.clusters, groups.links, size.width, size.height),
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
                const a = screen(source);
                const b = screen(target);
                return (
                  <line
                    key={link.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
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
                  const first = -((node.lines.length - 1) * LINE_HEIGHT) / 2;
                  const textX = node.side === "left" ? -(node.r + LABEL_GAP) : node.r + LABEL_GAP;
                  const { x, y } = screen(node);
                  return (
                    <text
                      key={node.id}
                      transform={`translate(${x} ${y})`}
                      dominantBaseline="central"
                      textAnchor={node.side === "right" ? "start" : "end"}
                      paintOrder="stroke"
                      strokeWidth={HALO}
                      strokeLinejoin="round"
                      className={`stroke-pg text-[13px] transition-[fill,opacity] duration-200 ${near || (!activeId && node.id === returnedId) ? "fill-ink" : "fill-mut"} ${activeId && !near ? "opacity-40" : ""}`}
                    >
                      {node.lines.map((line, i) => (
                        <tspan key={i} x={textX} y={first + i * LINE_HEIGHT}>
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
              <div className="mx-auto flex w-full max-w-[688px] items-center justify-between gap-6 px-10 text-[12.5px] text-pl">
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
                    <span className="inline-block size-2 rounded-full ring-1 ring-faint ring-inset" />
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
