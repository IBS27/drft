import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { SignIn } from "../features/auth/SignIn";

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
        <main className="min-h-dvh" />
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </>
  );
}
