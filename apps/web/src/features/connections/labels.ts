import { at, grow, labelBox, overlaps, type Box, type LayoutNode, type Point, type ViewTransform } from "./geometry";

// Which names show at this zoom. At the fitted view every name has room;
// zoomed out, they're named in turn — the thought in hand and its
// neighbours, today's, then the most connected, then the newest — each only
// where it keeps clear of the names already placed and of every dot.
export function placeLabels({
  nodes,
  degree,
  createdAt,
  view,
  first,
  among,
}: {
  nodes: LayoutNode[];
  degree: Map<string, number>;
  // When each thought was captured, by id.
  createdAt: Map<string, number>;
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
        (createdAt.get(b.id) ?? 0) - (createdAt.get(a.id) ?? 0),
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
