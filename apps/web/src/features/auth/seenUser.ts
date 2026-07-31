// Which user this browser last belonged to. Two readers: the shell opens
// on trust for a returning visitor while the handshake finishes, and a
// capture queued before the session lands carries this as its owner — so
// on a shared browser one account's words can never flush into another's.
const SEEN_KEY = "drft:auth-seen";

export function readSeenUser(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeSeenUser(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(SEEN_KEY, userId);
    else window.localStorage.removeItem(SEEN_KEY);
  } catch {
    // Storage can be denied (private mode); it only costs the fast open.
  }
}
