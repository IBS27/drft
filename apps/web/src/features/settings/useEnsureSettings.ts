import { useUser } from "@clerk/clerk-react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@drft/backend/convex/_generated/api";
import { useEffect } from "react";

// The daily email starts without a settings visit: the first signed-in load
// creates the row (default 8:00, this browser's timezone), and later loads
// keep the timezone current when the user travels. The same call is where
// the server notices a legacy account and starts its own backfills, so it
// belongs to the session, not to one route — a visitor who arrives on the
// email's deep link and never opens the collection still gets both.
// Idempotent, so StrictMode's double effect is harmless.
// Clerk hands out a new `user` object whenever it refreshes the session, so
// the effect keys on what the call actually sends — who, which email, which
// timezone — and fires once per real change rather than once per refresh.
export function useEnsureSettings(): void {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.settings.ensure);
  const { user } = useUser();
  const userId = user?.id;
  const email = user?.primaryEmailAddress?.emailAddress;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    void ensure({ timezone, email });
  }, [ensure, isAuthenticated, userId, email, timezone]);
}
