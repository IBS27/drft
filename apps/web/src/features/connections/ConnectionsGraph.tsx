import { useNavigate } from "@tanstack/react-router";
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
import {
  bend,
  HALO,
  LABEL_GAP,
  MAX_SCALE,
  MIN_SCALE,
  ownName,
  type LayoutNode,
  type Point,
  type ViewTransform,
} from "./geometry";
import type { GraphThought } from "./groups";
import { placeLabels } from "./labels";
import { LEGEND_GAP, type Layout } from "./pack";
import type { GroupLayouts } from "./useGroupLayouts";
import { useMapLayout } from "./useMapLayout";

const NO_MAP: Layout = { nodes: [], links: [], fit: { x: 0, y: 0, scale: 1 }, bottom: 0 };

// The map itself: the groups, laid out off the page's thread
// (useGroupLayouts), are packed into the room (useMapLayout) and drawn
// here. `map` is null until the first one is ready.
export function ConnectionsGraph({ map: latest }: { map: GroupLayouts | null }) {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLDivElement>(null);
  const pan = useRef<
    { pointerId: number; origin: Point; transform: ViewTransform } | undefined
  >(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
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

  // Groups take their shape from what they hold alone; a resize only
  // packs them again. What's drawn is the last map packed, whole: its
  // thoughts with its layout.
  const packed = useMapLayout(latest, size.width, size.height);
  const map = packed?.map ?? null;
  const layout = packed?.layout ?? NO_MAP;
  // Today's returned thought: the one "now" on the map.
  const returnedId = map?.returnedId ?? null;
  // The thoughts as they are now, by id: the layout only says where each sits.
  const thoughts = useMemo(
    () => new Map<string, GraphThought>(map?.thoughts.map((thought) => [thought._id, thought])),
    [map],
  );
  const createdAt = useMemo(
    () => new Map<string, number>(map?.thoughts.map((thought) => [thought._id, thought.createdAt])),
    [map],
  );
  const view = userView ?? layout.fit;
  // The legend keeps to the page title's column (688px, 40px padding), so the
  // page has one left edge even where the map spreads wider.
  const titleX0 = (size.width - Math.min(size.width, 688)) / 2 + 40;

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
  const active = activeId && byId.has(activeId) ? thoughts.get(activeId) : undefined;

  const restingLabels = useMemo(
    () =>
      placeLabels({
        nodes: layout.nodes,
        degree,
        createdAt,
        view,
        first: returnedId && byId.has(returnedId) ? [returnedId] : [],
      }),
    [byId, createdAt, degree, layout.nodes, returnedId, view],
  );
  // With a thought in hand, it and its neighbours are named first; the
  // resting names that still fit stay, stepped back.
  const labels = useMemo(() => {
    if (!activeId) return restingLabels;
    const circle = [...neighbors].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
    return placeLabels({
      nodes: layout.nodes,
      degree,
      createdAt,
      view,
      first: [activeId, ...circle],
      among: restingLabels,
    });
  }, [activeId, createdAt, degree, layout.nodes, neighbors, restingLabels, view]);

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
      {map === null || map.thoughts.length === 0 ? (
        <div className="flex h-full items-center justify-center pb-20 text-[14px] text-pl">
          {map === null ? <span className="caret h-5 w-0.5 rounded-full bg-dot" /> : "No thoughts yet"}
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
              const thought = thoughts.get(node.id);
              const resting = thought?.status === "resting";
              return (
                <g
                  key={node.id}
                  data-thought-node
                  role="link"
                  tabIndex={0}
                  aria-label={`${thought?.text ?? ""}, ${connected} connection${connected === 1 ? "" : "s"}${resting ? ", set down" : ""}`}
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
                      className={`stroke-pg transition-[fill,opacity] duration-200 ${near || node.id === returnedId ? "fill-ink" : "fill-pt"} ${activeId && !near ? "opacity-40" : ""}`}
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
            <div
              className="pointer-events-none absolute"
              style={{ top: layout.bottom + LEGEND_GAP, left: titleX0, width: size.width - 2 * titleX0 }}
            >
              <div className="flex items-center justify-between gap-6 text-[13px] leading-5 text-pl">
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
