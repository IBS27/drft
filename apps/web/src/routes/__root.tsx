import { SignInButton } from "@clerk/clerk-react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";

export const Route = createRootRoute({ component: Root });

function Root() {
  return (
    <>
      <AuthLoading>
        <main className="min-h-dvh" />
      </AuthLoading>
      <Unauthenticated>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-12">
          <h1 className="text-xs tracking-[0.5em] text-pt uppercase">
            drft
          </h1>
          <SignInButton mode="modal">
            <button
              type="button"
              className="text-[11px] tracking-[0.3em] text-pl uppercase transition-colors hover:text-ink"
            >
              sign in
            </button>
          </SignInButton>
        </main>
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </>
  );
}
