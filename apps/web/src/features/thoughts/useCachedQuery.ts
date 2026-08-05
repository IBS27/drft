import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { useEffect, useState } from "react";
import { readSeenUser } from "../auth/seenUser";

// The collection, remembered: the same trust that opens the shell for a
// returning visitor (features/auth/seenUser) paints their rows. Each
// query's last answer is kept per user; on the next visit it renders at
// once while the live subscription catches up behind it, and the moment
// real data lands it takes over. A browser the handshake rejects gets
// its memory cleared along with the seen-user flag.
const PREFIX = "drft:query:v1:";

function storageKey(name: string): string | null {
  const userId = readSeenUser();
  return userId ? `${PREFIX}${userId}:${name}` : null;
}

function read<T>(name: string): T | undefined {
  const key = storageKey(name);
  if (!key) return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    // Our own versioned write, so the shape is the query's return type.
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function write(name: string, value: unknown): void {
  const key = storageKey(name);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be denied (private mode); it only costs the fast paint.
  }
}

export function clearCachedQueries(): void {
  try {
    const mine: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) mine.push(key);
    }
    for (const key of mine) window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

// useQuery, with yesterday's answer while today's is on its way. `name`
// keys the stored copy and must be unique per query. Read once per
// mount — remembered rows must not change under the reader mid-handshake.
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  name: string,
): FunctionReturnType<Query> | undefined {
  // The tuple satisfies useQuery's conditional rest type, which a plain
  // union argument cannot narrow to.
  const live = useQuery(query, ...([args] as OptionalRestArgsOrSkip<Query>));
  const [cached] = useState(() => read<FunctionReturnType<Query>>(name));
  useEffect(() => {
    if (live !== undefined) write(name, live);
  }, [live, name]);
  // `??` would hide a legitimate null answer behind a stale copy.
  return live !== undefined ? live : cached;
}
