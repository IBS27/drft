/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { TransactionMetricsTracker } from "convex-test/dist/transactionMetrics.js";
import { vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.ts");

export type Setup = ReturnType<typeof convexTest>;

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

// A deployment as it is once migrations:backfillFastPaths has finished
// (on an empty one it finishes at once): every reader on its fast path.
export async function migratedDeployment(
  options?: Parameters<typeof convexTest>[0],
): Promise<Setup> {
  const t = convexTest(options ?? schema, modules);
  await t.mutation(internal.migrations.backfillFastPaths, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return t;
}

// Scheduled functions that have been asked for so far, by name
// ("email:deliver"), finished or not.
export async function scheduled(t: Setup, name: string): Promise<number> {
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return jobs.filter((job) => job.name === name).length;
}

type Syscall = (op: string, jsonArgs: string) => Promise<string>;

export type Transaction = {
  bytesRead: number;
  bytesWritten: number;
  databaseQueries: number;
  documentsRead: number;
  documentsWritten: number;
  functionsScheduled: number;
};

// Watches what reaches the fake backend until `restore`:
//
//   transactions — one entry per query or mutation that ran, in order,
//     with what it read, wrote and scheduled (convex-test's own counters,
//     the ones its `transactionLimits` enforce). A test's own `t.run` is
//     one too, so compare lengths around the call under test.
//   searches — each vector search an action made, by index.
//
// It also papers over one difference between convex-test and Convex. A
// vector index holds only the documents that have the vector field;
// convex-test scores every document the filter admits and throws on one
// without it. For the length of a search, such a document reads as a zero
// vector, which scores 0 — below any threshold a link needs.
export function watchBackend(): {
  transactions: Transaction[];
  searches: string[];
  restore: () => void;
} {
  const transactions: Transaction[] = [];
  const searches: string[] = [];

  const tracker = TransactionMetricsTracker.prototype as unknown as {
    _layers: { metrics: Transaction }[];
    commit: () => void;
    rollback: () => void;
  };
  const { commit, rollback } = tracker;
  const finishing = (finish: () => void) =>
    function (this: typeof tracker) {
      // The outermost layer is the transaction itself.
      if (this._layers.length === 1) transactions.push({ ...this._layers[0].metrics });
      finish.call(this);
    };
  tracker.commit = finishing(commit);
  tracker.rollback = finishing(rollback);

  const convex = (globalThis as unknown as { Convex: object }).Convex;
  const original = Object.getOwnPropertyDescriptor(convex, "asyncSyscall");
  if (!original?.get) throw new Error("convexTest() must be created first");
  Object.defineProperty(convex, "asyncSyscall", {
    configurable: true,
    get(): Syscall {
      const real: Syscall = original.get?.call(convex);
      return async (op, jsonArgs) => {
        if (op !== "1.0/actions/vectorSearch") return await real(op, jsonArgs);
        const { query } = JSON.parse(jsonArgs) as {
          query: { indexName: string; vector: number[] };
        };
        searches.push(query.indexName);
        const zero = query.vector.map(() => 0);
        Object.defineProperty(Object.prototype, "embedding", {
          configurable: true,
          get: () => zero,
        });
        try {
          return await real(op, jsonArgs);
        } finally {
          delete (Object.prototype as { embedding?: number[] }).embedding;
        }
      };
    },
  });

  return {
    transactions,
    searches,
    restore: () => {
      tracker.commit = commit;
      tracker.rollback = rollback;
      Object.defineProperty(convex, "asyncSyscall", original);
    },
  };
}
