import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { SignIn } from "../features/auth/SignIn";
import { SearchOverlay } from "../features/search/SearchOverlay";
import { OfflineNote } from "../features/ui/OfflineNote";
import { Waiting } from "../features/ui/Waiting";

export const Route = createRootRoute({ component: Root });

function Root() {
  // The OAuth callback must render while still unauthenticated.
  const onCallback = useRouterState({
    select: (s) => s.location.pathname === "/sso-callback",
  });
  if (onCallback) return <Outlet />;

  return (
    <>
      <AuthLoading>
        <Waiting />
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
        <SearchOverlay />
        <OfflineNote />
      </Authenticated>
    </>
  );
}
