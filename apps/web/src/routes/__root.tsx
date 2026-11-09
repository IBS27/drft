import { useAuth } from "@clerk/clerk-react";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { api } from "@drft/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { clearRememberedSession } from "../features/auth/rememberedSession";
import { readSeenUser, writeSeenUser } from "../features/auth/seenUser";
import { SignIn } from "../features/auth/SignIn";
import { ConnectionsPrompt } from "../features/consent/ConnectionsPrompt";
import { HoldLayer } from "../features/held/HoldLayer";
import { FindSheet } from "../features/search/FindSheet";
import { useEnsureSettings } from "../features/settings/useEnsureSettings";
import { Rail } from "../features/thoughts/Rail";
import { useRailAllowed } from "../features/thoughts/railPresence";
import { OfflineNote } from "../features/ui/OfflineNote";
import { useDesktop } from "../features/ui/useDesktop";
import { Waiting } from "../features/ui/Waiting";

// A returning visitor has already proven who they are; proving it again
// costs a Clerk round trip the room shouldn't be held hostage to. We
// remember who this browser was signed in as (features/auth/seenUser),
// and on the next visit open the room immediately while the handshake
// finishes behind it. Each view paints that user's remembered rows
// (features/thoughts/useCachedQuery) until real auth answers; the moment
// the handshake comes back unauthenticated the sign-in screen takes over
// and the remembered rows are cleared with the flag.

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
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { userId } = useAuth();
  // Read once per load: the flag is written as auth resolves, and the
  // shell must not change its mind mid-handshake.
  const [seen] = useState(() => readSeenUser() !== null);
  useEnsureSettings();
  // null = never asked. Still loading (undefined) doesn't hold the room.
  const consent = useQuery(api.consent.get, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) writeSeenUser(userId ?? null);
    else clearRememberedSession();
  }, [isLoading, isAuthenticated, userId]);

  if (onCallback) return <Outlet />;

  // Open on trust while auth is still in flight; fall back to the caret
  // only for a browser that has never been signed in here.
  const open = isAuthenticated || (isLoading && seen);
  if (!open) return isLoading ? <Waiting /> : <SignIn />;
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
      <OfflineNote />
    </>
  );
}
