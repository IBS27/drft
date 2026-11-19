// What the session did while nobody was watching. A tab that loses its
// session does so in the background, long after devtools were closed, so
// the last few auth events are kept in this browser to be read afterwards:
//   JSON.parse(localStorage.getItem("drft:auth-log"))
// Events and connection state only — never a token, an id or a thought.
const LOG_KEY = "drft:auth-log";
const LIMIT = 60;

export type AuthLogDetail = Record<string, string | number | boolean | null>;

export function logAuthEvent(event: string, detail: AuthLogDetail = {}): void {
  try {
    const connection = (navigator as Navigator & { connection?: { rtt?: number } })
      .connection;
    const entry = {
      at: new Date().toISOString(),
      event,
      ...detail,
      online: navigator.onLine,
      rtt: connection?.rtt ?? null,
      visible: document.visibilityState === "visible",
    };
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(LOG_KEY) ?? "[]",
    );
    const log: unknown[] = Array.isArray(stored) ? stored : [];
    window.localStorage.setItem(
      LOG_KEY,
      JSON.stringify([...log, entry].slice(-LIMIT)),
    );
  } catch {
    // Storage can be denied (private mode); the log is only ever a courtesy.
  }
}

export function clearAuthLog(): void {
  try {
    window.localStorage.removeItem(LOG_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
