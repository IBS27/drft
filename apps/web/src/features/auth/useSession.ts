import { useAuth } from "@clerk/clerk-react";
import { useConvexAuth } from "convex/react";

// Who decides what. Clerk alone says whether anyone is signed in; Convex
// only says whether the connection is carrying that session right now. A
// signed-in user whose connection is not is "connecting" — the room stays
// open on what it remembers — and never "signedOut".
export type Session = "loading" | "signedOut" | "connecting" | "ready";

export function useSession(): Session {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isRefreshing } = useConvexAuth();
  if (!isLoaded) return "loading";
  if (!isSignedIn) return "signedOut";
  // Refreshing: the server turned a token away and the socket is stopped
  // while a new one is fetched. Convex still calls that authenticated.
  return isAuthenticated && !isRefreshing ? "ready" : "connecting";
}
