import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
} from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect } from "react";
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
        <QuestionCountBackfill />
        <Outlet />
        <SearchOverlay />
        <OfflineNote />
      </Authenticated>
    </>
  );
}

// Existing thoughts predate the collection's denormalized waiting count.
// Small indexed batches make the migration invisible and resumable.
function QuestionCountBackfill() {
  const ensureQuestionCounts = useMutation(api.thoughts.ensureQuestionCounts);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        let hasMore = true;
        while (active && hasMore) {
          hasMore = await ensureQuestionCounts({});
        }
      } catch {
        // The collection retains an indexed legacy fallback, so a transient
        // migration failure never blocks the app.
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [ensureQuestionCounts]);

  return null;
}
