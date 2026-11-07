import { useNavigate } from "@tanstack/react-router";
import {
  forceCenter,
  forceCollide,
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

type LayoutNode = SimulationNodeDatum & {
  id: string;
  thought: GraphThought;
};

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  id: string;
  sourceId: string;
  targetId: string;
};

type ViewTransform = { x: number; y: number; scale: number };
type Point = { x: number; y: number };

const MIN_SCALE = 0.36;
const MAX_SCALE = 3.2;
const LINE_CHARS = 24;

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function initialPoint(id: string, width: number, height: number): Point {
  const value = hash(id);
  const angle = ((value % 3_600) / 3_600) * Math.PI * 2;
  const radius =
    (0.14 + (((value >>> 12) % 1_000) / 1_000) * 0.34) *
    Math.min(width, height);
  return {
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
  };
}

// A thought's label: up to two short lines, broken at words, so most
// thoughts are named in full and long ones end in an ellipsis at a word.
function labelLines(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= LINE_CHARS || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && line) lines.push(line);
  const shown = lines.join(" ").length;
  const full = words.join(" ").length;
  if (shown < full) {
    const last = lines[lines.length - 1].replace(/[\s,—–-]+$/, "");
    lines[lines.length - 1] = `${last.slice(0, LINE_CHARS - 1)}…`;
  }
  return lines;
}

type LabelSide = "right" | "left";
type Box = { x0: number; y0: number; x1: number; y1: number };
type Placement = Map<string, LabelSide>;

// Labels and dots keep their size on screen; zoom changes only the spacing,
// so zooming in makes room for more names.
const FONT_SIZE = 13;
const LINE_HEIGHT = 17;
const LABEL_GAP = 7;
// The paper behind a name, so no line crosses a word.
const LABEL_PAD = 3;
// The least air between two names at rest.
const LABEL_CLEARANCE = 8;
// The map sits between the page's subtitle and the footer row; names read
// to the right, so the fit leaves room for them there.
const FRAME = { top: 16, bottom: 64, side: 40 };
const LEFT_ROOM = 24;
const RIGHT_ROOM = 100;
// How near the frame's right edge a name may run before it turns left.
const EDGE_MARGIN = 20;

function nodeRadius(connected: number): number {
  return Math.min(9, 4.2 + connected * 1.1);
}

function displayRadius(thought: GraphThought, connected: number): number {
  return thought.status === "resting"
    ? Math.max(3.5, nodeRadius(connected) - 2)
    : nodeRadius(connected);
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

// Where a label's words sit beside its node, in screen pixels.
function labelBox(x: number, y: number, r: number, lines: string[], side: LabelSide): Box {
  const w = Math.max(...lines.map(textWidth));
  const h = lines.length * LINE_HEIGHT;
  return side === "right"
    ? { x0: x + r + LABEL_GAP, y0: y - h / 2, x1: x + r + LABEL_GAP + w, y1: y + h / 2 }
    : { x0: x - r - LABEL_GAP - w, y0: y - h / 2, x1: x - r - LABEL_GAP, y1: y + h / 2 };
}

const grow = (box: Box, by: number): Box => ({
  x0: box.x0 - by,
  y0: box.y0 - by,
  x1: box.x1 + by,
  y1: box.y1 + by,
});

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Whether a line segment passes through a box (Liang–Barsky clipping).
function crosses([a, b]: [Point, Point], box: Box): boolean {
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

// Which thoughts are named, and on which side. Names read to the right; a
// name takes the left only where the right would run off the canvas. In
// turn — `first`, then by connections, then newest — each name lands only
// where it keeps clear of every dot and every name already placed. The rest
// wait for hover.
//
// With a thought in hand, `first` is it and its neighbours: they are named
// before anything else, only need to clear each other's dots, may turn left
// to keep their bright lines (`lines`) visible, and the thought itself is
// always named.
function placeLabels({
  nodes,
  degree,
  transform,
  width,
  first = [],
  among,
  lines = [],
}: {
  nodes: LayoutNode[];
  degree: Map<string, number>;
  transform: ViewTransform;
  width: number;
  first?: string[];
  among?: Set<string>;
  lines?: Array<[Point, Point]>;
}): Placement {
  const screen = (node: LayoutNode): Point => ({
    x: transform.x + (node.x ?? 0) * transform.scale,
    y: transform.y + (node.y ?? 0) * transform.scale,
  });
  const radius = (node: LayoutNode) =>
    displayRadius(node.thought, degree.get(node.id) ?? 0);
  const firstSet = new Set(first);
  const dots = nodes.map((node) => {
    const p = screen(node);
    const r = radius(node) + 2;
    return {
      id: node.id,
      near: firstSet.has(node.id),
      box: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r },
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rest = nodes
    .filter((node) => !firstSet.has(node.id) && (!among || among.has(node.id)))
    .sort(
      (a, b) =>
        (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
        b.thought.createdAt - a.thought.createdAt,
    );
  const order = [...first.flatMap((id) => byId.get(id) ?? []), ...rest];
  const rightEdge = width - EDGE_MARGIN;
  const placed: Box[] = [];
  const result: Placement = new Map();
  order.forEach((node, index) => {
    const p = screen(node);
    const r = radius(node);
    const words = labelLines(node.thought.text);
    const near = firstSet.has(node.id);
    const fallback: LabelSide =
      labelBox(p.x, p.y, r, words, "right").x1 + LABEL_PAD > rightEdge ? "left" : "right";
    const sides: LabelSide[] = near ? [fallback, fallback === "right" ? "left" : "right"] : [fallback];
    const options = sides.map((side) => {
      const paper = grow(labelBox(p.x, p.y, r, words, side), LABEL_PAD);
      const blocked =
        (side === "right" && paper.x1 > rightEdge) ||
        placed.some((other) => overlaps(paper, grow(other, LABEL_CLEARANCE))) ||
        dots.some((dot) => dot.id !== node.id && (dot.near || !near) && overlaps(paper, dot.box));
      const hidesLine = near && lines.some((line) => crosses(line, paper));
      return { side, paper, score: (blocked ? 2 : 0) + (hidesLine ? 1 : 0) };
    });
    const best = options.reduce((a, b) => (b.score < a.score ? b : a));
    if (best.score < 2 || (index === 0 && first.length > 0)) {
      placed.push(best.paper);
      result.set(node.id, best.side);
    }
  });
  return result;
}

function endpointId(endpoint: string | number | LayoutNode): string {
  return typeof endpoint === "object" ? endpoint.id : String(endpoint);
}

// Fits the dots into the frame, centred between the subtitle and the
// footer, with room for names to their right.
function fitTransform(
  nodes: LayoutNode[],
  width: number,
  height: number,
): ViewTransform {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };
  const xs = nodes.map((node) => node.x ?? width / 2);
  const ys = nodes.map((node) => node.y ?? height / 2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const roomWidth = width - FRAME.side * 2 - LEFT_ROOM - RIGHT_ROOM;
  const roomHeight = height - FRAME.top - FRAME.bottom - LINE_HEIGHT * 2;
  const scale = Math.min(
    1.9,
    Math.max(
      MIN_SCALE,
      Math.min(
        roomWidth / Math.max(1, maxX - minX),
        roomHeight / Math.max(1, maxY - minY),
      ),
    ),
  );
  return {
    x: FRAME.side + LEFT_ROOM + roomWidth / 2 - ((minX + maxX) / 2) * scale,
    y: FRAME.top + LINE_HEIGHT + roomHeight / 2 - ((minY + maxY) / 2) * scale,
    scale,
  };
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
  const positions = useRef(new Map<string, Point>());
  const nodeElements = useRef(new Map<string, SVGGElement>());
  const edgeElements = useRef(new Map<string, SVGLineElement>());
  const labelElements = useRef(new Map<string, SVGGElement>());
  const userMoved = useRef(false);
  const pan = useRef<
    { pointerId: number; origin: Point; transform: ViewTransform } | undefined
  >(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  // Bumped as the layout settles, so names are placed where dots came to rest.
  const [settled, setSettled] = useState(0);
  const [transform, setTransformState] = useState<ViewTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  // The simulation moves dots between renders; it reads the view from here.
  const transformRef = useRef(transform);
  const setTransform = (next: ViewTransform) => {
    transformRef.current = next;
    setTransformState(next);
  };

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

  const layout = useMemo(() => {
    // The map is of what echoes what: thoughts with no echo yet stay off it
    // (each one's page still says so) rather than floating as stray dots.
    const allIds = new Set(thoughts.map((thought) => thought._id));
    const linked = new Set<string>();
    for (const thought of thoughts)
      for (const connection of thought.connections)
        if (allIds.has(connection.toId)) {
          linked.add(thought._id);
          linked.add(connection.toId);
        }
    const shown = thoughts.filter((thought) => linked.has(thought._id));
    const thoughtIds = new Set(shown.map((thought) => thought._id));
    const nodes = shown.map<LayoutNode>((thought) => {
      const remembered = positions.current.get(thought._id);
      const point =
        remembered ?? initialPoint(thought._id, size.width, size.height);
      return { id: thought._id, thought, x: point.x, y: point.y };
    });
    const links = shown.flatMap<LayoutLink>((thought) =>
      thought.connections
        .filter((connection) => thoughtIds.has(connection.toId))
        .map((connection) => ({
          id: connection._id,
          source: thought._id,
          target: connection.toId,
          sourceId: thought._id,
          targetId: connection.toId,
        })),
    );
    return { nodes, links };
  }, [thoughts, size.height, size.width]);

  useEffect(() => {
    if (size.width === 0 || size.height === 0 || layout.nodes.length === 0)
      return;
    let tick = 0;
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
    const fit = () => {
      if (userMoved.current || pan.current) return;
      const next = fitTransform(layout.nodes, size.width, size.height);
      transformRef.current = next;
      setTransformState(next);
      for (const node of layout.nodes) {
        const at = `translate(${next.x + (node.x ?? 0) * next.scale} ${next.y + (node.y ?? 0) * next.scale})`;
        nodeElements.current.get(node.id)?.setAttribute("transform", at);
        labelElements.current.get(node.id)?.setAttribute("transform", at);
      }
    };
    const simulation = forceSimulation(layout.nodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(layout.links)
          .id((node) => node.id)
          .distance(150)
          .strength(0.34),
      )
      .force("charge", forceManyBody().strength(-240).distanceMax(440))
      .force("collide", forceCollide(50).strength(0.95))
      .force("center", forceCenter(size.width / 2, size.height / 2))
      .force("x", forceX(size.width / 2).strength(0.025))
      .force("y", forceY(size.height / 2).strength(0.025))
      .alphaDecay(0.045)
      // Names are placed as the map settles, and again when it comes to rest.
      .on("end", () => {
        fit();
        setSettled((value) => value + 1);
      })
      .on("tick", () => {
        tick += 1;
        const view = transformRef.current;
        for (const node of layout.nodes) {
          const x = node.x ?? size.width / 2;
          const y = node.y ?? size.height / 2;
          positions.current.set(node.id, { x, y });
          const at = `translate(${view.x + x * view.scale} ${view.y + y * view.scale})`;
          nodeElements.current.get(node.id)?.setAttribute("transform", at);
          labelElements.current.get(node.id)?.setAttribute("transform", at);
        }
        for (const link of layout.links) {
          const source = nodeById.get(link.sourceId);
          const target = nodeById.get(link.targetId);
          const edge = edgeElements.current.get(link.id);
          if (!source || !target || !edge) continue;
          edge.setAttribute("x1", String(source.x ?? size.width / 2));
          edge.setAttribute("y1", String(source.y ?? size.height / 2));
          edge.setAttribute("x2", String(target.x ?? size.width / 2));
          edge.setAttribute("y2", String(target.y ?? size.height / 2));
        }
        if (tick === 8 || tick === 24 || tick === 56) fit();
        if (tick === 24 || tick === 56) setSettled((value) => value + 1);
      });
    return () => {
      simulation.stop();
    };
  }, [layout, size.height, size.width]);

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

  // At rest, every thought with room is named — today's first, then the most
  // connected, then the newest. With one in hand, it and its neighbours are
  // named first; the resting names that still fit stay, stepped back.
  const restingLabels = useMemo(
    () =>
      settled === 0
        ? new Map<string, LabelSide>()
        : placeLabels({
            nodes: layout.nodes,
            degree,
            transform,
            width: size.width,
            first: returnedId && byId.has(returnedId) ? [returnedId] : [],
          }),
    [byId, degree, layout.nodes, returnedId, settled, size.width, transform],
  );
  const labels = useMemo(() => {
    if (!activeId) return restingLabels;
    const circle = [...neighbors].sort(
      (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0),
    );
    const screen = (id: string): Point => {
      const node = byId.get(id);
      return {
        x: transform.x + (node?.x ?? 0) * transform.scale,
        y: transform.y + (node?.y ?? 0) * transform.scale,
      };
    };
    return placeLabels({
      nodes: layout.nodes,
      degree,
      transform,
      width: size.width,
      first: [activeId, ...circle],
      among: new Set(restingLabels.keys()),
      lines: circle.map((id) => [screen(activeId), screen(id)]),
    });
  }, [activeId, byId, degree, layout.nodes, neighbors, restingLabels, size.width, transform]);

  const open = (id: string) => {
    void navigate({
      to: "/thought/$thoughtId",
      params: { thoughtId: id },
    });
  };
  const onNodeKeyDown = (
    event: ReactKeyboardEvent<SVGGElement>,
    id: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open(id);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-thought-node]")) return;
    pan.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      transform,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pan.current || pan.current.pointerId !== event.pointerId) return;
    // Only a real drag hands the view to the user — a bare click keeps
    // auto-fit alive while pages are still arriving.
    userMoved.current = true;
    setTransform({
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
    userMoved.current = true;
    const rect = frame.getBoundingClientRect();
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, transform.scale * Math.exp(-event.deltaY * 0.0012)),
    );
    const world = {
      x: (cursor.x - transform.x) / transform.scale,
      y: (cursor.y - transform.y) / transform.scale,
    };
    setTransform({
      x: cursor.x - world.x * scale,
      y: cursor.y - world.y * scale,
      scale,
    });
  };

  return (
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(color-mix(in_oklab,var(--line)_35%,transparent)_1px,transparent_1.2px)] bg-[length:26px_26px]"
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
            <g
              aria-hidden="true"
              className="pointer-events-none"
              transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
            >
              {layout.links.map((link) => {
                const source = byId.get(endpointId(link.source));
                const target = byId.get(endpointId(link.target));
                if (!source || !target) return null;
                const near =
                  activeId === link.sourceId || activeId === link.targetId;
                return (
                  <line
                    key={link.id}
                    ref={(element) => {
                      if (element) edgeElements.current.set(link.id, element);
                      else edgeElements.current.delete(link.id);
                    }}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    vectorEffect="non-scaling-stroke"
                    className={`transition-[stroke,opacity] duration-200 ${
                      near
                        ? "stroke-pt"
                        : activeId
                          ? "stroke-faint opacity-15"
                          : "map-edge stroke-faint"
                    }`}
                    strokeWidth={near ? 1.5 : 1.1}
                  />
                );
              })}
            </g>

            {layout.nodes.map((node) => {
              const selected = node.id === activeId;
              const near = selected || neighbors.has(node.id);
              const connected = degree.get(node.id) ?? 0;
              const x = transform.x + (node.x ?? size.width / 2) * transform.scale;
              const y = transform.y + (node.y ?? size.height / 2) * transform.scale;
              const radius = displayRadius(node.thought, connected);
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    if (element) nodeElements.current.set(node.id, element);
                    else nodeElements.current.delete(node.id);
                  }}
                  data-thought-node
                  role="link"
                  tabIndex={0}
                  aria-label={`${node.thought.text}, ${connected} connection${connected === 1 ? "" : "s"}${node.thought.status === "resting" ? ", set down" : ""}`}
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
                  {selected && <circle r={radius + 6} className="fill-ink/10" />}
                  {node.id === returnedId && !selected && (
                    <circle r={radius + 5} className="fill-dot/15" />
                  )}
                  <circle
                    r={radius}
                    className={
                      node.id === returnedId
                        ? "fill-dot stroke-pg"
                        : selected
                          ? "fill-ink stroke-pg"
                          : node.thought.status === "resting"
                            ? "fill-pg stroke-faint"
                            : "fill-mut stroke-pg"
                    }
                    strokeWidth={node.thought.status === "resting" ? 1.25 : 2}
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
                  const side = labels.get(node.id) ?? "right";
                  const selected = node.id === activeId;
                  const near = selected || neighbors.has(node.id);
                  const radius = displayRadius(node.thought, degree.get(node.id) ?? 0);
                  const lines = labelLines(node.thought.text);
                  const box = grow(labelBox(0, 0, radius, lines, side), LABEL_PAD);
                  const first = -((lines.length - 1) * LINE_HEIGHT) / 2;
                  const textX = side === "left" ? -(radius + LABEL_GAP) : radius + LABEL_GAP;
                  const x = transform.x + (node.x ?? size.width / 2) * transform.scale;
                  const y = transform.y + (node.y ?? size.height / 2) * transform.scale;
                  return (
                    <g
                      key={node.id}
                      ref={(element) => {
                        if (element) labelElements.current.set(node.id, element);
                        else labelElements.current.delete(node.id);
                      }}
                      transform={`translate(${x} ${y})`}
                      className={`transition-opacity duration-200 ${activeId && !near ? "opacity-25" : ""}`}
                    >
                      <rect
                        x={box.x0}
                        y={box.y0}
                        width={box.x1 - box.x0}
                        height={box.y1 - box.y0}
                        rx={4}
                        className="fill-pg"
                      />
                      <text
                        dominantBaseline="central"
                        textAnchor={side === "right" ? "start" : "end"}
                        paintOrder="stroke"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        className={`stroke-pg text-[13px] ${selected ? "fill-ink" : "fill-pt"}`}
                      >
                        {lines.map((line, i) => (
                          <tspan key={i} x={textX} y={first + i * LINE_HEIGHT}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </g>
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
