import type { Group, GroupJob } from "./cluster";
import { perform, type Packing, type Work } from "./layoutWork";
import type { Layout } from "./pack";

// The map is laid out off the page's thread, a few pieces at a time: each
// group is independent of the others, so a handful of workers share them
// out and the page stays free to scroll, type and leave. Packing the
// finished groups into the room goes the same way — it is lighter, but
// still a few hundred milliseconds on a large map. Where a worker can't be
// made, the work is done here instead, one piece per turn of the event loop.

type Task = { work: Work; done: (result: Group | Layout) => void; worker?: Worker };

// One core is left for the page itself.
const WORKERS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

const waiting: Task[] = [];
const working = new Set<Task>();
const idle: Worker[] = [];
let unavailable = false;
let here: number | undefined;

function spawn(): Worker | null {
  try {
    return new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

// Without workers: the old way, on this thread.
function workHere() {
  if (here !== undefined) return;
  here = window.setTimeout(() => {
    here = undefined;
    const task = waiting.shift();
    if (!task) return;
    task.done(perform(task.work));
    workHere();
  });
}

function giveUpOnWorkers() {
  unavailable = true;
  for (const task of working) {
    task.worker?.terminate();
    waiting.unshift(task);
  }
  working.clear();
  for (const worker of idle.splice(0)) worker.terminate();
  workHere();
}

function next() {
  if (unavailable) return workHere();
  while (waiting.length > 0 && working.size < WORKERS) {
    const worker = idle.pop() ?? spawn();
    if (!worker) return giveUpOnWorkers();
    const task = waiting.shift() as Task;
    task.worker = worker;
    working.add(task);
    worker.onmessage = (event: MessageEvent<Group | Layout>) => {
      working.delete(task);
      idle.push(worker);
      task.done(event.data);
      next();
    };
    // The worker's script didn't load or run: nothing it holds will finish.
    worker.onerror = giveUpOnWorkers;
    worker.postMessage(task.work);
  }
  // Nothing left to do: no worker waits around for a next visit.
  if (waiting.length === 0 && working.size === 0)
    for (const worker of idle.splice(0)) worker.terminate();
}

// Does one piece of work and hands the result to `done`. The returned
// function calls it off: work still waiting is dropped, work under way is
// stopped.
function run(task: Task): () => void {
  waiting.push(task);
  next();
  return () => {
    const queued = waiting.indexOf(task);
    if (queued !== -1) waiting.splice(queued, 1);
    if (working.delete(task)) task.worker?.terminate();
    // After the caller has called off everything it means to: a whole map
    // is called off piece by piece, and a freed worker mustn't pick up a
    // piece that is about to go too.
    queueMicrotask(next);
  };
}

// A message holds what `perform` returned for the work sent, so each
// result is the kind its work asked for.
export function layOutGroup(job: GroupJob, done: (group: Group) => void): () => void {
  return run({ work: { group: job }, done: (result) => done(result as Group) });
}

export function packGroups(packing: Packing, done: (layout: Layout) => void): () => void {
  return run({ work: { pack: packing }, done: (result) => done(result as Layout) });
}
