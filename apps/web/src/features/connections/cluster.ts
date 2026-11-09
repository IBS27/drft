// Lays one group of thoughts out on its own: the heavy part of the map,
// and a pure function of what the group holds — which is what lets it run
// on a worker (layout.worker.ts) and be kept between visits (layoutStore).
import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import {
  at,
  bend,
  bendCrosses,
  CLEARANCE,
  EDGE_CLEAR,
  extent,
  grow,
  hash,
  nodeBox,
  overlaps,
  ownName,
  pos,
  crosses,
  type Bend,
  type Box,
  type LayoutLink,
  type LayoutNode,
  type Pair,
  type Point,
  type Shape,
} from "./geometry";

// Dots this close in x read as one column; several of them as a string.
// Within `ALIGN_REACH` ideal lines of each other, they're discouraged.
const ALIGN = 24;
const ALIGN_REACH = 3;
// How much room a group's dots and names get to spread through.
const PACKING = 1.9;
// The shapes a group is laid out in (width over height); a large group keeps
// the first, a small one offers each so the groups can fill the room together.
// None is much taller than wide: a tall group lays out single file.
const CLUSTER_ASPECTS = [1.2, 2.4, 0.85];
const SMALL_CLUSTER = 40;
// Simulation ticks over which names grow from nothing to full size.
const GROW_TICKS = 140;
// Fresh layouts tried for a small group, and how many of the tidiest are
// then refined; the cleanest is kept.
const ATTEMPTS = 10;
const FINALISTS = 3;

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
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

// What each flaw costs while a layout is refined: a line under a name or
// through a dot, and names crowding, are not allowed to stay; lines crossing,
// long lines and dots stacked in one column are only discouraged.
const COST = { hit: 400, crowd: 400, cross: 24, bundle: 12, bend: 14, length: 3, align: 10, run: 16 };

// How upright a line `dx` across and `dy` down stands: 1 when plumb, 0 once
// it leans as far across as RUN_LEAN of its height.
const RUN_LEAN = 0.8;
const upright = (dx: number, dy: number) => Math.max(0, 1 - Math.abs(dx) / (Math.abs(dy) * RUN_LEAN || 1e-9));

// What a dot costs for carrying a line on straight through it, one in from
// above and one out below: three dots stacked single file.
function straightRun(lines: Point[]): number {
  let cost = 0;
  for (let a = 0; a < lines.length; a += 1)
    for (let b = a + 1; b < lines.length; b += 1)
      if (lines[a].y * lines[b].y < 0)
        cost += COST.run * upright(lines[a].x, lines[a].y) * upright(lines[b].x, lines[b].y);
  return cost;
}

// How much two dots read as one column: 1 when level in x and near, falling
// to 0 at ALIGN apart across or `reach` apart down.
function alignment(dx: number, dy: number, reach: number): number {
  return Math.max(0, 1 - Math.abs(dx) / ALIGN) * Math.max(0, 1 - Math.abs(dy) / reach);
}
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

export function refine(nodes: LayoutNode[], pairs: Pair[], { ideal, seed, room, hold, heat }: Refinement): number {
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
  // The way each line leaves dot `v`.
  const runAt = (v: number): number =>
    straightRun(
      incident[v].map((e) => {
        const o = ends[e][0] === v ? ends[e][1] : ends[e][0];
        return { x: xs[o] - xs[v], y: ys[o] - ys[v] };
      }),
    );
  // Everything that costs and depends on where dot `i` sits.
  const local = (i: number): number => {
    let cost = runAt(i);
    for (const e of incident[i]) {
      cost += runAt(ends[e][0] === i ? ends[e][1] : ends[e][0]);
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
      cost += COST.align * alignment(xs[i] - xs[j], ys[i] - ys[j], ideal * ALIGN_REACH);
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

// A group of thoughts that echo one another, laid out on its own: its dots
// sit relative to its own top-left corner, and `w`/`h` is what its dots and
// names cover. `flaws` counts what refining couldn't clear (nearly always 0).
export type Cluster = { nodes: LayoutNode[]; w: number; h: number; flaws: number };

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
// each other, dots stacked in one column, and length.
function untidiness(nodes: LayoutNode[], pairs: Pair[], spacing: number): number {
  const wholes = nodes.map((n) => at(grow(nodeBox(n), CLEARANCE / 2 - 1), n.x ?? 0, n.y ?? 0));
  let total = 0;
  wholes.forEach((a, i) =>
    wholes.forEach((b, k) => {
      if (i >= k) return;
      if (overlaps(a, b)) total += 20;
      const [p, q] = [pos(nodes[i]), pos(nodes[k])];
      total += 2 * alignment(p.x - q.x, p.y - q.y, spacing * 0.45 * ALIGN_REACH);
    }),
  );
  const out = new Map<LayoutNode, Point[]>();
  for (const [s, t] of pairs) {
    const [a, b] = [pos(s), pos(t)];
    out.set(s, [...(out.get(s) ?? []), { x: b.x - a.x, y: b.y - a.y }]);
    out.set(t, [...(out.get(t) ?? []), { x: a.x - b.x, y: a.y - b.y }]);
  }
  for (const lines of out.values()) total += straightRun(lines) / 8;
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

// Lays one group out in screen pixels, so every name's real size takes part:
// its dots spread through a room of the given shape, sized to what they
// carry, until each name has its own space, clear of other names, other dots
// and the lines. It's laid out from a few starting points; the tidiest are
// refined and the cleanest kept.
function layoutCluster(ids: string[], links: LayoutLink[], shapes: Shape[], aspect: number): Cluster {
  const boxes = shapes.map(nodeBox);
  const needed =
    boxes.reduce((sum, box) => sum + (box.x1 - box.x0 + CLEARANCE) * (box.y1 - box.y0 + CLEARANCE), 0) * PACKING;
  const width = Math.max(...boxes.map((box) => box.x1 - box.x0 + CLEARANCE), Math.sqrt(needed * aspect));
  const room: Box = { x0: 0, y0: 0, x1: width, y1: Math.max(...boxes.map((box) => box.y1 - box.y0), needed / width) };
  const spacing = Math.sqrt((room.x1 * room.y1) / ids.length);

  const attempts = ids.length <= 40 ? ATTEMPTS : ids.length <= 120 ? 3 : 1;
  const runs = Array.from({ length: attempts }, (_, attempt) => {
    const nodes = ids.map<LayoutNode>((id, i) => {
      const value = hash(`${attempt}:${id}`);
      const angle = ((value % 3_600) / 3_600) * Math.PI * 2;
      const reach = 0.1 + (((value >>> 12) % 1_000) / 1_000) * 0.3;
      return {
        id,
        ...shapes[i],
        x: room.x1 / 2 + Math.cos(angle) * reach * room.x1,
        y: room.y1 / 2 + Math.sin(angle) * reach * room.y1,
      };
    });
    const pairs = arrange(nodes, links, room);
    return { attempt, nodes, pairs, score: untidiness(nodes, pairs, spacing) };
  });
  const finalists = runs.sort((a, b) => a.score - b.score).slice(0, ids.length <= 40 ? FINALISTS : 1);
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
export type Group = { size: number; forms: Cluster[] };

// Everything a group's layout depends on. `key` names exactly that, so a
// layout can be kept under it and found again.
export type GroupJob = { key: string; ids: string[]; links: LayoutLink[]; shapes: Shape[] };

// A small group is laid out in each shape, so the groups can fill the room
// together; a large one keeps the first.
export function layoutGroup({ ids, links, shapes }: GroupJob): Group {
  const aspects = ids.length <= SMALL_CLUSTER ? CLUSTER_ASPECTS : CLUSTER_ASPECTS.slice(0, 1);
  const forms = aspects.map((aspect) => layoutCluster(ids, links, shapes, aspect));
  // Packing chooses among the shapes that came out clean, when any did.
  const clean = forms.filter((form) => form.flaws === 0);
  return { size: ids.length, forms: clean.length > 0 ? clean : forms };
}
