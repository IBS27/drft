import { useAuth } from "@clerk/clerk-react";
import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { readSeenUser } from "../auth/seenUser";

// The collection, remembered: the same trust that opens the shell for a
// returning visitor (features/auth/seenUser) paints their rows. Each
// query's last answer is kept per user; on the next visit it renders at
// once while the live subscription catches up behind it, and the moment
// real data lands it takes over. A browser the handshake rejects gets
// its memory cleared along with the seen-user flag.
//
// The version only has to move when a stored answer would *render wrong* —
// a field that has gone away is read by nothing and costs nothing, and the
// first live answer overwrites it anyway. Bumping for one of those would
// trade every returning visitor's instant first paint for nothing.
const PREFIX = "drft:query:v1:";

function storageKey(userId: string, name: string): string {
  return `${PREFIX}${userId}:${name}`;
}

function read<T>(userId: string, name: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, name));
    // Our own versioned write, so the shape is the query's return type.
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function write(userId: string, name: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey(userId, name), JSON.stringify(value));
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

// useQuery, with its last answer while the live one is on its way. `name`
// keys the stored copy and must uniquely identify the query arguments.
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  name: string,
): FunctionReturnType<Query> | undefined {
  const { isLoaded, userId } = useAuth();
  // The remembered owner enables the first paint only while Clerk is loading.
  // Once Clerk resolves, its identity is authoritative; switching accounts
  // can never leave the previous owner's cached rows on screen.
  const [rememberedUserId] = useState(() => readSeenUser());
  const cacheUserId = isLoaded ? userId : rememberedUserId;
  // The tuple satisfies useQuery's conditional rest type, which a plain
  // union argument cannot narrow to.
  const live = useQuery(query, ...([args] as OptionalRestArgsOrSkip<Query>));
  const cached = useMemo(
    () =>
      cacheUserId
        ? read<FunctionReturnType<Query>>(cacheUserId, name)
        : undefined,
    [cacheUserId, name],
  );
  useEffect(() => {
    if (live !== undefined && userId) write(userId, name, live);
  }, [live, name, userId]);
  // `??` would hide a legitimate null answer behind a stale copy.
  return live !== undefined ? live : cached;
}
