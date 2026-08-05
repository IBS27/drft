import { clearCachedQueries } from "../thoughts/useCachedQuery";
import { writeSeenUser } from "./seenUser";

// Sign-out may navigate before React observes the unauthenticated state, so
// forget the fast-open identity and its private rows synchronously.
export function clearRememberedSession(): void {
  writeSeenUser(null);
  clearCachedQueries();
}
