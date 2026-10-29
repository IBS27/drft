// Kept, but not yet sent. The window is small — the room opens before
// Convex has the session — but a thought that has been acknowledged is
// already the user's, so the queue outlives this screen: leaving for
// /settings, a reload, or the handshake coming back signed-out all used
// to drop it. It is flushed on the next load that has a session.
// Each entry names its owner (the user this browser was signed in as when
// it was kept), and draining takes only the signed-in user's entries — on
// a shared browser one account's words never flush into another's.
const PENDING_KEY = "drft:pending-captures";

type PendingCapture = { text: string; owner: string | null };

function readPending(): PendingCapture[] {
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(PENDING_KEY) ?? "[]",
    );
    if (!Array.isArray(raw)) return [];
    const items: unknown[] = raw;
    return items.filter((p): p is PendingCapture => {
      if (typeof p !== "object" || p === null) return false;
      const entry = p as Record<string, unknown>;
      return (
        typeof entry.text === "string" &&
        (typeof entry.owner === "string" || entry.owner === null)
      );
    });
  } catch {
    return [];
  }
}

function writePending(pending: PendingCapture[]): void {
  try {
    if (pending.length === 0) window.localStorage.removeItem(PENDING_KEY);
    else window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage can be denied (private mode); the send below still happens.
  }
}

export function queue(trimmed: string, owner: string | null): void {
  writePending([...readPending(), { text: trimmed, owner }]);
}

// Ownerless entries are a should-not-happen (the queue is only reachable
// once this browser has a remembered user); flushing them to whoever is
// here keeps capture's promise that nothing kept is ever dropped.
export function drain(userId: string): string[] {
  const pending = readPending();
  const mine = pending.filter((p) => p.owner === userId || p.owner === null);
  if (mine.length > 0)
    writePending(pending.filter((p) => !mine.includes(p)));
  return mine.map((p) => p.text);
}

// Account deletion: this user's unsent words go with the account. Ownerless
// entries can only be theirs too (see drain).
export function discardPendingCaptures(userId: string): void {
  writePending(
    readPending().filter((p) => p.owner !== userId && p.owner !== null),
  );
}
