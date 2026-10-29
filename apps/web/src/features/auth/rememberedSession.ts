import { clearCachedQueries } from "../thoughts/useCachedQuery";
import { discardPendingCaptures } from "../thoughts/pendingCaptures";
import { writeSeenUser } from "./seenUser";

// Sign-out may navigate before React observes the unauthenticated state, so
// forget the fast-open identity and its private rows synchronously.
export function clearRememberedSession(): void {
  writeSeenUser(null);
  clearCachedQueries();
}

// A deleted account leaves nothing in this browser: on top of sign-out's
// forgetting, its kept-but-unsent thoughts go too.
export function forgetDeletedAccount(userId: string): void {
  clearRememberedSession();
  discardPendingCaptures(userId);
}
