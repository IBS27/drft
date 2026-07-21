// Contract-derived tuning, importable from the default runtime (store.ts
// enforces caps in-transaction) — so no provider imports here.

// Cosine similarity from text-embedding-3-small: unrelated text sits
// near 0.2, genuine topical resonance around 0.4+. Tune against real
// captures, not intuition.
export const LINK_THRESHOLD = 0.42;
export const MAX_LINKS_PER_ENRICH = 2;

// Softer bar for what may be *mentioned* in a live session — context for
// the partner, not a persisted link.
export const SESSION_RESONANCE_THRESHOLD = 0.35;

// "One or two prepared questions, not five" — never more than this many
// unseen on a thought.
export const MAX_UNSEEN_QUESTIONS = 2;

// How long a session stays quiet before the partner prepares questions
// from what was said.
export const SESSION_SETTLE_MS = 45 * 60 * 1000;
