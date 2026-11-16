import { useAuth } from "@clerk/clerk-react";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { api } from "@drft/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { logAuthEvent } from "../features/auth/authLog";
import { clearRememberedSession } from "../features/auth/rememberedSession";
import { readSeenUser, writeSeenUser } from "../features/auth/seenUser";
import { SignIn } from "../features/auth/SignIn";
import { ConnectionsPrompt } from "../features/consent/ConnectionsPrompt";
import { HoldLayer } from "../features/held/HoldLayer";
import { FindSheet } from "../features/search/FindSheet";
import { useEnsureSettings } from "../features/settings/useEnsureSettings";
import { Rail } from "../features/thoughts/Rail";
import { useRailAllowed } from "../features/thoughts/railPresence";
import { ConnectionNote } from "../features/ui/ConnectionNote";
import { useDesktop } from "../features/ui/useDesktop";
import { Waiting } from "../features/ui/Waiting";

// A returning visitor has already proven who they are; proving it again
// costs a Clerk round trip the room shouldn't be held hostage to. We
// remember who this browser was signed in as (features/auth/seenUser),
// and on the next visit open the room immediately while the handshake
// finishes behind it. Each view paints that user's remembered rows
// (features/thoughts/useCachedQuery) until real auth answers.
//
// Only Clerk can say nobody is signed in: the moment it does, the sign-in
// screen takes over and the remembered rows are cleared with the flag.
// Convex not carrying the session — a handshake in flight, a token refresh
// that failed — is not that; the room stays open and the connection is
// re-made behind it (features/auth/ConvexClerkProvider).

export const Route = createRootRoute({ component: Root });

// The pages the rail stands beside. Connections has it on wide screens
// only (routes/connections); the sign-in callback and a page that isn't
// there have none.
const RAIL_PAGES: ReadonlySet<string> = new Set([
  "/",
  "/thought/$thoughtId",
  "/held",
  "/resting",
  "/settings",
]);

function Root() {
  // The OAuth callback must render while still unauthenticated.
  const onCallback = useRouterState({
    select: (s) => s.location.pathname === "/sso-callback",
  });
  const page = useRouterState({
    select: (s) => s.matches[s.matches.length - 1]?.routeId,
  });
  const desktop = useDesktop();
  const railAllowed = useRailAllowed();
  const { isAuthenticated } = useConvexAuth();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const signedOut = isLoaded && !isSignedIn;
  // Read once per load, then kept in step with what auth resolves to: the
  // shell must not change its mind mid-handshake, and a room that has
  // opened stays open while its connection is re-made.
  const [seen, setSeen] = useState(() => readSeenUser() !== null);
  if (isAuthenticated && !seen) setSeen(true);
  if (signedOut && seen) setSeen(false);
  useEnsureSettings();
  // null = never asked. Still loading (undefined) doesn't hold the room.
  const consent = useQuery(api.consent.get, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (signedOut) {
      // A remembered user Clerk no longer knows, without having signed out
      // here (that clears the flag first): worth being able to explain.
      if (readSeenUser() !== null) logAuthEvent("clerk-signed-out");
      clearRememberedSession();
    } else if (isAuthenticated) writeSeenUser(userId ?? null);
  }, [signedOut, isAuthenticated, userId]);

  if (onCallback) return <Outlet />;

  if (signedOut) return <SignIn />;
  // Open on trust while auth is still in flight; fall back to the caret
  // only for a browser that has never been signed in here.
  if (!isAuthenticated && !seen) return <Waiting />;
  if (isAuthenticated && consent === null) return <ConnectionsPrompt />;

  const rail =
    railAllowed &&
    page !== undefined &&
    (RAIL_PAGES.has(page) || (page === "/connections" && desktop));
  return (
    <>
      {/* Outside the pages, so moving between them leaves it mounted. */}
      {rail && <Rail desktop={desktop} />}
      <Outlet />
      <FindSheet />
      <HoldLayer />
      <ConnectionNote />
    </>
  );
}
