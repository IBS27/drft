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
const LABEL_LIMIT = 42;

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

function label(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > LABEL_LIMIT
    ? `${oneLine.slice(0, LABEL_LIMIT - 1)}…`
    : oneLine;
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
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const scale = Math.min(
    1.2,
    Math.max(
      MIN_SCALE,
      Math.min((width - 100) / graphWidth, (height - 150) / graphHeight),
    ),
  );
  return {
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
    scale,
  };
}

export function ConnectionsGraph({
  thoughts,
  loading,
}: {
  thoughts: GraphThought[];
  loading: boolean;
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
    const thoughtIds = new Set(thoughts.map((thought) => thought._id));
    const nodes = thoughts.map<LayoutNode>((thought) => {
      const remembered = positions.current.get(thought._id);
      const point =
        remembered ?? initialPoint(thought._id, size.width, size.height);
      return { id: thought._id, thought, x: point.x, y: point.y };
    });
    const links = thoughts.flatMap<LayoutLink>((thought) =>
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
    const simulation = forceSimulation(layout.nodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(layout.links)
          .id((node) => node.id)
          .distance(92)
          .strength(0.34),
      )
      .force("charge", forceManyBody().strength(-54).distanceMax(300))
      .force("collide", forceCollide(13).strength(0.8))
      .force("center", forceCenter(size.width / 2, size.height / 2))
      .force("x", forceX(size.width / 2).strength(0.025))
      .force("y", forceY(size.height / 2).strength(0.025))
      .alphaDecay(0.045)
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
    <div ref={frameRef} className="relative min-h-0 flex-1 overflow-hidden">
      {thoughts.length === 0 ? (
        <div className="flex h-full items-center justify-center pb-20 text-[10.5px] tracking-[0.3em] text-pl uppercase">
          {loading ? <span className="caret h-3 w-px bg-ink" /> : "no thoughts yet"}
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
                      className={`transition-opacity duration-200 ${visible ? "stroke-ink opacity-45" : "stroke-line opacity-0"}`}
                      strokeWidth={1}
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
                const radius = Math.min(6.5, 3.4 + connected * 0.55);
                const showLabel = selected || neighbor;
                const labelOnLeft = x > size.width * 0.72;
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
                    className="cursor-pointer outline-none"
                    onPointerEnter={() => setActiveId(node.id)}
                    onPointerLeave={() => setActiveId(null)}
                    onFocus={() => setActiveId(node.id)}
                    onBlur={() => setActiveId(null)}
                    onClick={() => open(node.id)}
                    onKeyDown={(event) => onNodeKeyDown(event, node.id)}
                    transform={`translate(${x} ${y})`}
                  >
                    <circle r={16} fill="transparent" />
                    <circle
                      r={radius}
                      vectorEffect="non-scaling-stroke"
                      className={
                        selected
                          ? "fill-dot stroke-none"
                          : node.thought.status === "resting"
                            ? `fill-pg stroke-faint ${neighbor ? "opacity-100" : "opacity-50"}`
                            : `stroke-none ${neighbor ? "fill-ink opacity-90" : "fill-mut opacity-45"}`
                      }
                      strokeWidth={1}
                    />
                    {showLabel && (
                      <text
                        x={labelOnLeft ? -13 : 13}
                        y={-5}
                        textAnchor={labelOnLeft ? "end" : "start"}
                        className="pointer-events-none fill-pt text-[11px] font-light"
                      >
                        {label(node.thought.text)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {active && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute bottom-7 left-1/2 w-[min(640px,70%)] -translate-x-1/2 text-center"
            >
              <div className="text-[9px] tracking-[0.28em] text-pl uppercase">
                {dateLine(active.createdAt, Date.now())}
                {active.status === "resting" && " · set down"}
              </div>
              <div className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap text-[17px] leading-relaxed font-light text-ink">
                {active.text}
              </div>
              <div className="mt-2 text-[8px] tracking-[0.22em] text-pl uppercase">
                {degree.get(active._id) ?? 0} connection
                {(degree.get(active._id) ?? 0) === 1 ? "" : "s"} · click to open
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
