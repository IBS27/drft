import { useAuth } from "@clerk/clerk-react";
import { useEffect, useMemo, useState } from "react";
import type { Group } from "./cluster";
import type { LayoutLink } from "./geometry";
import { planGroups, type GraphThought, type GroupPlan } from "./groups";
import { layOutGroup } from "./layoutPool";
import { keepOnlyGroups, laidOut, readGroups, writeGroup } from "./layoutStore";

// A map's groups, each laid out, with the thoughts and lines they were laid
// out for. Packing them into the room is the page's (pack.ts).
export type GroupLayouts = {
  thoughts: GraphThought[];
  returnedId: string | null;
  groups: Group[];
  links: LayoutLink[];
};

// Lays out the groups of `plan` that aren't in hand: from the store where
// they were kept, on the worker pool otherwise, largest first. Calls
// `settled` once every group is in hand; the returned function calls the
// rest off.
function layOut(plan: GroupPlan, userId: string | null, settled: (groups: Group[]) => void): () => void {
  let live = true;
  const calledOff: (() => void)[] = [];
  const keys = plan.jobs.map((job) => job.key);
  const settle = () => {
    if (!live || !keys.every((key) => laidOut.has(key))) return;
    const groups = keys.map((key) => laidOut.get(key) as Group);
    const current = new Set(keys);
    for (const key of [...laidOut.keys()]) if (!current.has(key)) laidOut.delete(key);
    if (userId) void keepOnlyGroups(userId, keys);
    settled(groups);
  };
  const missing = plan.jobs
    .filter((job) => !laidOut.has(job.key))
    .sort((a, b) => b.ids.length - a.ids.length);
  if (missing.length === 0) {
    settle();
    return () => {};
  }
  void (async () => {
    const kept = userId
      ? await readGroups(userId, missing.map((job) => job.key))
      : new Map<string, Group>();
    if (!live) return;
    for (const job of missing) {
      const group = kept.get(job.key);
      if (group) {
        laidOut.set(job.key, group);
        continue;
      }
      calledOff.push(
        layOutGroup(job, (laid) => {
          laidOut.set(job.key, laid);
          if (userId) void writeGroup(userId, job.key, laid);
          settle();
        }),
      );
    }
    settle();
  })();
  return () => {
    live = false;
    for (const callOff of calledOff) callOff();
  };
}

// The groups of the map of `thoughts`, laid out — off the page's thread,
// once `ready` says every thought has arrived (a map laid out page by page
// is laid out many times over). `map` is the last finished one, kept on
// screen while a newer one is on its way; `settled` says it is the map of
// what was asked for.
export function useGroupLayouts(
  thoughts: GraphThought[],
  returnedId: string | null,
  ready: boolean,
): { map: GroupLayouts | null; settled: boolean } {
  const { userId } = useAuth();
  const [fontsReady, setFontsReady] = useState(() => document.fonts.status === "loaded");
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
  const plan = useMemo(
    () => (ready && fontsReady ? planGroups(shown, returnedId) : null),
    [shown, returnedId, ready, fontsReady],
  );

  const [laid, setLaid] = useState<{ plan: GroupPlan; map: GroupLayouts } | null>(null);
  useEffect(() => {
    if (!plan) return;
    return layOut(plan, userId ?? null, (groups) =>
      setLaid({ plan, map: { thoughts: shown, returnedId, groups, links: plan.links } }),
    );
    // `shown` and `returnedId` are what the plan was made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, userId]);

  return { map: laid?.map ?? null, settled: laid !== null && laid.plan === plan };
}
