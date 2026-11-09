import type { api } from "@drft/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { GroupJob } from "./cluster";
import type { LayoutLink } from "./geometry";
import { shape } from "./measure";

type GraphPage = FunctionReturnType<typeof api.thoughts.connectionGraph>;
export type GraphThought = GraphPage["page"][number];

// What a map is made of, before any of it is laid out: its lines, and each
// group as the job of laying it out.
export type GroupPlan = { jobs: GroupJob[]; links: LayoutLink[] };

// The map is of what echoes what: thoughts with no echo yet stay off it
// (each one's page still says so) rather than floating as stray dots. The
// rest fall into groups — thoughts linked to one another, directly or
// through others — each laid out on its own.
export function planGroups(
  thoughts: GraphThought[],
  returnedId: string | null,
): GroupPlan {
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
  const jobs = [...members.values()].map((group) => {
    const ids = new Set<string>(group.map((thought) => thought._id));
    const own = links.filter((link) => ids.has(link.sourceId));
    const today = returnedId !== null && ids.has(returnedId) ? returnedId : null;
    const shapes = group.map((thought) => shape(thought.text, degree.get(thought._id) ?? 0, thought._id === today));
    // What the group holds, and how wide its names measured: a layout kept
    // under this is never shown for names that have since come out another
    // size (a font that failed to load, or a new cut of it).
    const key = JSON.stringify([
      group.map((thought) => [thought._id, thought.text]),
      own.map((link) => link.id),
      today,
      shapes.map((s) => s.w),
    ]);
    return { key, ids: group.map((thought) => thought._id), links: own, shapes };
  });
  return { jobs, links };
}
