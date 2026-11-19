import { useAuth, useClerk } from "@clerk/clerk-react";
import {
  ConvexProviderWithAuth,
  type ConvexReactClient,
  useConvexAuth,
} from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { logAuthEvent } from "./authLog";
import { createTokenFetcher } from "./tokenFetcher";

// Convex, authenticated by Clerk — in place of convex/react-clerk's
// ConvexProviderWithClerk, which turns any failed token fetch into "signed
// out" and leaves the tab that way until it is reloaded. Two things differ
// here: the token fetcher does not give up while Clerk has a session
// (./tokenFetcher), and if Convex drops the session anyway, it is handed
// back (Rearm, below).

// Convex only authenticates again when the fetcher it was given changes
// identity. The generation is how that is asked for.
const RearmContext = createContext<{ generation: number; rearm: () => void }>({
  generation: 0,
  rearm: () => {},
});

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function useClerkAuth() {
  const { isLoaded, isSignedIn, sessionId } = useAuth();
  const clerk = useClerk();
  const { generation } = useContext(RearmContext);
  const fetchAccessToken = useMemo(
    () =>
      createTokenFetcher({
        // Read live, so a fetcher mid-retry sees the sign-out that ends it.
        session: () => clerk.session,
        wait,
        log: logAuthEvent,
      }),
    // A new session or a re-arm must hand Convex a new fetcher: that is
    // what makes it authenticate again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [clerk, sessionId, generation],
  );
  return useMemo(
    () => ({
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn ?? false,
      fetchAccessToken,
    }),
    [isLoaded, isSignedIn, fetchAccessToken],
  );
}

// A sign-in passes through the same state for the length of its handshake.
const REARM_GRACE = 5_000;
const REARM_INTERVAL = 30_000;

// The fetcher closes the common way to lose the session; the server can
// still turn fresh tokens away (a tab frozen between fetching one and
// sending it). Clerk signed in with Convex settled on "not authenticated"
// is that state: hand the session back once, and after that only when the
// tab is returned to or the network comes back — never in a loop, and no
// more often than the interval (a wake inside it goes when it ends).
function Rearm() {
  const { isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { rearm } = useContext(RearmContext);
  const dropped = isSignedIn === true && !isLoading && !isAuthenticated;
  const attempts = useRef(0);
  const lastAt = useRef(0);

  // A new episode — and a new sign-in is one — gets its own first try.
  useEffect(() => {
    if (isAuthenticated || !isSignedIn) attempts.current = 0;
  }, [isAuthenticated, isSignedIn]);

  useEffect(() => {
    if (!dropped) return;
    const go = (why: string) => {
      attempts.current += 1;
      lastAt.current = Date.now();
      logAuthEvent("rearm", { why, attempt: attempts.current });
      rearm();
    };
    if (attempts.current === 0) {
      const grace = window.setTimeout(() => go("dropped"), REARM_GRACE);
      return () => window.clearTimeout(grace);
    }
    let timer: number | undefined;
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      const wait = REARM_INTERVAL - (Date.now() - lastAt.current);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => go("wake"), Math.max(0, wait));
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [dropped, rearm]);

  return null;
}

export function ConvexClerkProvider({
  client,
  children,
}: {
  client: ConvexReactClient;
  children: ReactNode;
}) {
  const [generation, setGeneration] = useState(0);
  const rearm = useCallback(() => setGeneration((g) => g + 1), []);
  const value = useMemo(() => ({ generation, rearm }), [generation, rearm]);
  return (
    <RearmContext value={value}>
      <ConvexProviderWithAuth client={client} useAuth={useClerkAuth}>
        <Rearm />
        {children}
      </ConvexProviderWithAuth>
    </RearmContext>
  );
}
