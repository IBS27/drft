// Enrichment and return-loop tuning, with no provider imports.

// Cosine similarity from text-embedding-3-small: unrelated text sits
// near 0.2, genuine topical resonance around 0.4+. Tune against real
// captures, not intuition.
export const LINK_THRESHOLD = 0.42;
export const MAX_LINKS_PER_ENRICH = 2;

// The return loop. "Never the newest": a thought must sit at least this
// long before it can come back. And once resurfaced, it rests out of the
// rotation this long — the loop is a slow wheel, not a feed.
export const RESURFACE_MIN_AGE_DAYS = 3;
export const RESURFACE_COOLDOWN_DAYS = 30;
