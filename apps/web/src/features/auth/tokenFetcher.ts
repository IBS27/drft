import type { AuthLogDetail } from "./authLog";

// Convex asks for a fresh token about once a minute, and takes a single
// empty answer as "signed out": it drops the session and never asks again
// (convex/browser/sync/authentication_manager). Clerk can come back empty
// for reasons that have nothing to do with being signed out — a request
// that failed while it believed the browser offline, a rate limit, a tab
// waking before its network does. So this fetcher answers empty only when
// Clerk itself has no session; anything else it keeps asking, and the
// socket simply waits.

// The slice of a Clerk session this needs.
type TokenSession = {
  getToken(options: {
    template: string;
    skipCache: boolean;
  }): Promise<string | null>;
};

export type TokenFetcherDeps = {
  // Clerk's live session: null once signed out, undefined while Clerk is
  // between states.
  session: () => TokenSession | null | undefined;
  wait: (ms: number) => Promise<void>;
  log: (event: string, detail: AuthLogDetail) => void;
};

export type TokenFetcher = (args: {
  forceRefreshToken: boolean;
}) => Promise<string | null>;

const MAX_DELAY = 15_000;
const MAX_RETRY_AFTER = 60_000;

// 1s, 2s, 4s, 8s, then every 15s — or as long as Clerk asked for, if longer.
function retryDelay(attempt: number, retryAfterSeconds?: number): number {
  const backoff = Math.min(MAX_DELAY, 1000 * 2 ** Math.min(attempt, 4));
  if (!retryAfterSeconds) return backoff;
  return Math.max(backoff, Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER));
}

// Clerk's API errors are read by shape, not class: clerk-js is loaded from
// Clerk's CDN, so the errors it throws are not instances of this bundle's.
function describe(error: unknown): { detail: AuthLogDetail; retryAfter?: number } {
  const shape: { status?: unknown; retryAfter?: unknown; errors?: unknown } =
    typeof error === "object" && error !== null ? error : {};
  if (typeof shape.status === "number") {
    const first: unknown = Array.isArray(shape.errors) ? shape.errors[0] : null;
    const code =
      typeof first === "object" && first !== null && "code" in first
        ? first.code
        : null;
    return {
      detail: {
        reason: "api",
        status: shape.status,
        code: typeof code === "string" ? code : null,
      },
      retryAfter:
        typeof shape.retryAfter === "number" ? shape.retryAfter : undefined,
    };
  }
  return {
    detail: {
      reason: "threw",
      code: error instanceof Error ? error.name : null,
    },
  };
}

export function createTokenFetcher({
  session,
  wait,
  log,
}: TokenFetcherDeps): TokenFetcher {
  async function fetchToken(force: boolean): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      const current = session();
      // Signed out, by Clerk's own account: the one honest empty answer.
      if (current === null) return null;

      let failure: ReturnType<typeof describe> = {
        detail: { reason: "no-session-yet" },
      };
      if (current) {
        try {
          const token = await current.getToken({
            template: "convex",
            skipCache: force,
          });
          if (token) {
            if (attempt > 0) log("token-recovered", { attempts: attempt });
            return token;
          }
          failure = { detail: { reason: "empty" } };
        } catch (error) {
          failure = describe(error);
        }
      }
      // Once per flight: a long outage must not push the events that
      // explain it out of the log.
      if (attempt === 0) log("token-failed", { ...failure.detail, force });
      await wait(retryDelay(attempt, failure.retryAfter));
    }
  }

  // Convex can ask twice at once (its scheduled refresh, and again when the
  // server turns the old token away) and only uses the later answer, so
  // forced calls share one flight rather than each retrying on its own. A
  // call that may use Clerk's cache never joins it: handing Convex the token
  // it already holds is another way it gives up.
  let forced: Promise<string | null> | null = null;
  return ({ forceRefreshToken }) => {
    if (!forceRefreshToken) return fetchToken(false);
    forced ??= fetchToken(true).finally(() => {
      forced = null;
    });
    return forced;
  };
}
