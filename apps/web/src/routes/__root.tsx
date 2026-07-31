import { useAuth } from "@clerk/clerk-react";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { readSeenUser, writeSeenUser } from "../features/auth/seenUser";
import { SignIn } from "../features/auth/SignIn";
import { SearchOverlay } from "../features/search/SearchOverlay";
import { useEnsureSettings } from "../features/settings/useEnsureSettings";
import { OfflineNote } from "../features/ui/OfflineNote";
import { Waiting } from "../features/ui/Waiting";

// A returning visitor has already proven who they are; proving it again
// costs a Clerk round trip the room shouldn't be held hostage to. We
// remember who this browser was signed in as (features/auth/seenUser),
// and on the next visit open the room immediately while the handshake
// finishes behind it. Nothing private leaks: every query waits for real
// auth (each view renders its own quiet skeleton until then), and the
// moment the handshake comes back unauthenticated the sign-in screen
// takes over.

export const Route = createRootRoute({ component: Root });

function Root() {
  // The OAuth callback must render while still unauthenticated.
  const onCallback = useRouterState({
    select: (s) => s.location.pathname === "/sso-callback",
  });
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { userId } = useAuth();
  // Read once per load: the flag is written as auth resolves, and the
  // shell must not change its mind mid-handshake.
  const [seen] = useState(() => readSeenUser() !== null);
  useEnsureSettings();

  useEffect(() => {
    if (isLoading) return;
    writeSeenUser(isAuthenticated ? (userId ?? null) : null);
  }, [isLoading, isAuthenticated, userId]);

  if (onCallback) return <Outlet />;

  // Open on trust while auth is still in flight; fall back to the caret
  // only for a browser that has never been signed in here.
  const open = isAuthenticated || (isLoading && seen);
  if (!open) return isLoading ? <Waiting /> : <SignIn />;

  return (
    <>
      <Outlet />
      <SearchOverlay />
      <OfflineNote />
    </>
  );
}
