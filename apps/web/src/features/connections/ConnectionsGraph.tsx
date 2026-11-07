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

type LabelSide = "right" | "left" | "top" | "bottom";
type Box = { x0: number; y0: number; x1: number; y1: number };

const LINE_HEIGHT = 17;
const LABEL_GAP = 7;

function nodeRadius(connected: number): number {
  return Math.min(9, 4.2 + connected * 1.1);
}

// Where a label sits around its node, in world units. Width is estimated
// from the text (Geist at 13.5px averages ~6.9px a character).
function labelBox(x: number, y: number, r: number, lines: string[], side: LabelSide): Box {
  const w = Math.max(...lines.map((line) => line.length)) * 6.9;
  const h = lines.length * LINE_HEIGHT;
  switch (side) {
    case "right":
      return { x0: x + r + LABEL_GAP, y0: y - h / 2, x1: x + r + LABEL_GAP + w, y1: y + h / 2 };
    case "left":
      return { x0: x - r - LABEL_GAP - w, y0: y - h / 2, x1: x - r - LABEL_GAP, y1: y + h / 2 };
    case "top":
      return { x0: x - w / 2, y0: y - r - LABEL_GAP - h, x1: x + w / 2, y1: y - r - LABEL_GAP };
    case "bottom":
      return { x0: x - w / 2, y0: y + r + LABEL_GAP, x1: x + w / 2, y1: y + r + LABEL_GAP + h };
  }
}

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Greedy placement once the layout settles: the most connected thoughts
// choose first, each taking the first side whose label clears every node
// and every label already placed. A label with nowhere to go waits for
// hover instead of landing on top of something.
function placeLabels(
  nodes: LayoutNode[],
  links: LayoutLink[],
  degree: Map<string, number>,
): Map<string, LabelSide> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Which way each node's edges leave it, so its label can sit opposite.
  const edgeSides = new Map<string, Record<LabelSide, number>>();
  for (const link of links) {
    for (const [from, to] of [
      [link.sourceId, link.targetId],
      [link.targetId, link.sourceId],
    ]) {
      const a = byId.get(from);
      const b = byId.get(to);
      if (!a || !b) continue;
      const dx = (b.x ?? 0) - (a.x ?? 0);
      const dy = (b.y ?? 0) - (a.y ?? 0);
      const side: LabelSide =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
      const counts = edgeSides.get(from) ?? { right: 0, left: 0, top: 0, bottom: 0 };
      counts[side] += 1;
      edgeSides.set(from, counts);
    }
  }
  const allSides: LabelSide[] = ["right", "left", "top", "bottom"];
  const nodeBoxes = nodes.map((node) => {
    const r = nodeRadius(degree.get(node.id) ?? 0) + 3;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    return { id: node.id, box: { x0: x - r, y0: y - r, x1: x + r, y1: y + r } };
  });
  // Points along every edge, so a label never sits on a line.
  const edgePoints: { x: number; y: number; ends: [string, string] }[] = [];
  for (const link of links) {
    const a = byId.get(link.sourceId);
    const b = byId.get(link.targetId);
    if (!a || !b) continue;
    const dx = (b.x ?? 0) - (a.x ?? 0);
    const dy = (b.y ?? 0) - (a.y ?? 0);
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
    for (let i = 1; i < steps; i += 1) {
      edgePoints.push({
        x: (a.x ?? 0) + (dx * i) / steps,
        y: (a.y ?? 0) + (dy * i) / steps,
        ends: [link.sourceId, link.targetId],
      });
    }
  }
  const placed: Box[] = [];
  const result = new Map<string, LabelSide>();
  const order = [...nodes]
    .filter((node) => (degree.get(node.id) ?? 0) > 0)
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  for (const node of order) {
    const r = nodeRadius(degree.get(node.id) ?? 0);
    const lines = labelLines(node.thought.text);
    const counts = edgeSides.get(node.id);
    const sides = counts
      ? [...allSides].sort((a, b) => counts[a] - counts[b])
      : allSides;
    let best: { side: LabelSide; box: Box; hits: number } | null = null;
    for (const side of sides) {
      const box = labelBox(node.x ?? 0, node.y ?? 0, r, lines, side);
      const hits =
        placed.filter((other) => overlaps(box, other)).length * 2 +
        nodeBoxes.filter((n) => n.id !== node.id && overlaps(box, n.box)).length +
        (edgePoints.some(
          (p) =>
            !p.ends.includes(node.id) &&
            p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1,
        )
          ? 1
          : 0);
      if (!best || hits < best.hits) best = { side, box, hits };
      if (hits === 0) break;
    }
    // The busiest thoughts choose first; a label lands only where it
    // touches nothing. The rest wait for hover.
    if (best && best.hits === 0) {
      placed.push(best.box);
      result.set(node.id, best.side);
    }
  }
  return result;
}

function endpointId(endpoint: string | number | LayoutNode): string {
  return typeof endpoint === "object" ? endpoint.id : String(endpoint);
}

function fitTransform(
  nodes: LayoutNode[],
  width: number,
  height: number,
): ViewTransform {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };
  const xs = nodes.map((node) => node.x ?? width / 2);
  const ys = nodes.map((node) => node.y ?? height / 2);
  // Labels sit mostly to the right of their nodes: allow for them so the
  // map, as seen, is centred.
  const minX = Math.min(...xs) - 150;
  const maxX = Math.max(...xs) + 160;
  const minY = Math.min(...ys) - 30;
  const maxY = Math.max(...ys) + 30;
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const scale = Math.min(
    1.35,
    Math.max(
      MIN_SCALE,
      Math.min((width - 160) / graphWidth, (height - 190) / graphHeight),
    ),
  );
  return {
    x: width / 2 - ((minX + maxX) / 2) * scale,
    // A touch above centre: the legend weighs on the bottom edge.
    y: height * 0.46 - ((minY + maxY) / 2) * scale,
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
  const userMoved = useRef(false);
  const pan = useRef<
    { pointerId: number; origin: Point; transform: ViewTransform } | undefined
  >(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [labelSides, setLabelSides] = useState<Map<string, LabelSide>>(
    () => new Map(),
  );
  const [transform, setTransform] = useState<ViewTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });

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
    const linkDegree = new Map<string, number>();
    for (const link of layout.links) {
      linkDegree.set(link.sourceId, (linkDegree.get(link.sourceId) ?? 0) + 1);
      linkDegree.set(link.targetId, (linkDegree.get(link.targetId) ?? 0) + 1);
    }
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
    const simulation = forceSimulation(layout.nodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(layout.links)
          .id((node) => node.id)
          .distance(150)
          .strength(0.34),
      )
      .force("charge", forceManyBody().strength(-190).distanceMax(440))
      .force("collide", forceCollide(34).strength(0.95))
      .force("center", forceCenter(size.width / 2, size.height / 2))
      .force("x", forceX(size.width / 2).strength(0.025))
      .force("y", forceY(size.height / 2).strength(0.025))
      .alphaDecay(0.045)
      // Labels are placed as the map settles, and again when it comes to rest.
      .on("end", () => setLabelSides(placeLabels(layout.nodes, layout.links, linkDegree)))
      .on("tick", () => {
        tick += 1;
        for (const node of layout.nodes) {
          const x = node.x ?? size.width / 2;
          const y = node.y ?? size.height / 2;
          positions.current.set(node.id, {
            x,
            y,
          });
          nodeElements.current
            .get(node.id)
            ?.setAttribute("transform", `translate(${x} ${y})`);
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
        if (
          !userMoved.current &&
          !pan.current &&
          (tick === 8 || tick === 24 || tick === 56)
        ) {
          setTransform(fitTransform(layout.nodes, size.width, size.height));
        }
        if (tick === 24 || tick === 56)
          setLabelSides(placeLabels(layout.nodes, layout.links, linkDegree));
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
              transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
            >
              <g aria-hidden="true" className="pointer-events-none">
                {layout.links.map((link) => {
                  const source = byId.get(endpointId(link.source));
                  const target = byId.get(endpointId(link.target));
                  if (!source || !target) return null;
                  const visible =
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
                        visible
                          ? "stroke-mut opacity-90"
                          : activeId
                            ? "stroke-line opacity-60"
                            : "stroke-faint opacity-40"
                      }`}
                      strokeWidth={visible ? 1.5 : 1.1}
                    />
                  );
                })}
              </g>

              {layout.nodes.map((node) => {
                const selected = node.id === activeId;
                const neighbor = neighbors.has(node.id);
                const connected = degree.get(node.id) ?? 0;
                const x = node.x ?? size.width / 2;
                const y = node.y ?? size.height / 2;
                const radius =
                  connected === 0
                    ? 2.5
                    : node.thought.status === "resting"
                      ? Math.max(3.5, nodeRadius(connected) - 2)
                      : nodeRadius(connected);
                // At rest every connected thought that has room is named,
                // so the map reads at a glance; while one is in hand, only
                // its neighbourhood speaks and the rest steps back.
                const placedSide = labelSides.get(node.id);
                const showLabel = activeId
                  ? selected || neighbor
                  : placedSide !== undefined;
                const side: LabelSide =
                  placedSide ?? (x > size.width * 0.72 ? "left" : "right");
                const receded = activeId !== null && !selected && !neighbor;
                const lone = connected === 0 && !selected;
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
                    className={`cursor-pointer outline-none transition-opacity duration-200 ${receded ? "opacity-35" : lone ? "opacity-50" : ""}`}
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
                      vectorEffect="non-scaling-stroke"
                      className={
                        node.id === returnedId
                          ? "fill-dot stroke-pg"
                          : selected
                            ? "fill-ink stroke-pg"
                          : node.thought.status === "resting"
                            ? "fill-pg stroke-faint"
                            : connected > 0
                              ? "fill-mut stroke-pg"
                              : "fill-pl stroke-none"
                      }
                      strokeWidth={node.thought.status === "resting" || connected === 0 ? 1.25 : 2}
                    />
                    {showLabel && (
                      <text
                        dominantBaseline="central"
                        textAnchor={side === "right" ? "start" : side === "left" ? "end" : "middle"}
                        paintOrder="stroke"
                        strokeWidth={7}
                        strokeLinejoin="round"
                        className={`pointer-events-none stroke-pg text-[13.5px] ${selected ? "fill-ink font-medium" : "fill-pt"}`}
                      >
                        {(() => {
                          const lines = labelLines(node.thought.text);
                          const block = lines.length * LINE_HEIGHT;
                          const x =
                            side === "right"
                              ? radius + LABEL_GAP
                              : side === "left"
                                ? -(radius + LABEL_GAP)
                                : 0;
                          // Centre of the label block, then one line per row.
                          const cy =
                            side === "top"
                              ? -(radius + LABEL_GAP + block / 2)
                              : side === "bottom"
                                ? radius + LABEL_GAP + block / 2
                                : 0;
                          const first = cy - ((lines.length - 1) * LINE_HEIGHT) / 2;
                          return lines.map((line, i) => (
                            <tspan key={i} x={x} y={first + i * LINE_HEIGHT}>
                              {line}
                            </tspan>
                          ));
                        })()}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {!active && (
            <div className="pointer-events-none absolute inset-x-7 bottom-6 flex items-center justify-between text-[13px] text-pl">
              <p className="flex items-center rounded-full bg-scr/90 px-4 py-2 ring-1 ring-line ring-inset backdrop-blur">
              {returnedId && (
                <span className="mr-3 inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full bg-dot" />
                  Back today
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full bg-pt" />
                Kept
              </span>
              <span className="ml-3 inline-flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full ring-1 ring-faint" />
                Set down
              </span>

              </p>
              <p className="rounded-full bg-scr/90 px-4 py-2 ring-1 ring-line ring-inset backdrop-blur">
                Point to a dot to name it · click to open · scroll to zoom
              </p>
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
