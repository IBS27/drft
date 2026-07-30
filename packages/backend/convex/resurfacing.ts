import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { RESURFACE_COOLDOWN_DAYS, RESURFACE_MIN_AGE_DAYS } from "./ai/limits";

// The return loop's selection half — deliberately dumb. No readiness
// scoring, no model choosing: a slow rotation over what the user put in.
// Skip resting, skip the fresh, skip the recently returned, then take
// whichever open thought has waited longest. If nothing qualifies, the
// day is silent. Delivery (email.ts) is an adapter over the rows this
// writes. See docs/experience.html §03.

const DAY = 86_400_000;
const MIN_GAP_MS = 20 * 3_600_000;
const emailPayloadValidator = v.object({
  from: v.string(),
  to: v.string(),
  subject: v.string(),
  text: v.string(),
  html: v.string(),
});

// A user's wall clock, without a timezone library: Intl formats the
// current instant into their zone.
function localParts(timezone: string, now: number) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const [hour, minute] = clock.split(":").map(Number);
  return { date, minutesOfDay: hour * 60 + minute };
}

function sendMinutes(sendTime: string): number {
  const [hour, minute] = sendTime.split(":").map(Number);
  return hour * 60 + minute;
}

// Runs every 15 minutes (crons.ts). Once a user's local clock passes
// their chosen time: pick today's thought if not yet picked, then hand
// the row to delivery. Delivery is retried each tick until it stamps
// deliveredAt — a transient send failure never silently eats the day.
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allSettings = await ctx.db.query("settings").collect();
    for (const settings of allSettings) {
      const { date, minutesOfDay } = localParts(settings.timezone, now);
      if (minutesOfDay < sendMinutes(settings.sendTime)) continue;

      const today = await ctx.db
        .query("resurfacings")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", settings.userId).eq("date", date),
        )
        .first();
      if (today) {
        if (today.deliveredAt === undefined)
          await ctx.scheduler.runAfter(0, internal.email.deliver, {
            resurfacingId: today._id,
          });
        continue;
      }

      // "One per day" by the wall clock too: a timezone change can start
      // a new local date hours after the last send — the floor keeps
      // travel from ever producing two emails in one waking day.
      const latest = await ctx.db
        .query("resurfacings")
        .withIndex("by_user_date", (q) => q.eq("userId", settings.userId))
        .order("desc")
        .first();
      if (latest && now - latest._creationTime < MIN_GAP_MS) continue;

      const thoughtId = await select(ctx, settings.userId, now);
      if (!thoughtId) continue; // silence beats filler
      const resurfacingId = await ctx.db.insert("resurfacings", {
        thoughtId,
        date,
        userId: settings.userId,
      });
      await ctx.scheduler.runAfter(0, internal.email.deliver, { resurfacingId });
    }
  },
});

async function select(ctx: MutationCtx, userId: string, now: number) {
  const open = await ctx.db
    .query("thoughts")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open"))
    .collect();
  const aged = open.filter(
    (t) => now - t.createdAt >= RESURFACE_MIN_AGE_DAYS * DAY,
  );

  // When each thought last came back. A row is created the moment the
  // thought is shown, so _creationTime is the instant the user saw it —
  // truer than parsing the local-date string (UTC-midnight skew). Rows
  // without userId (pre-phase-5) still count: a thought is one user's.
  const lastReturned = new Map<string, number>();
  for (const t of aged) {
    const rows = await ctx.db
      .query("resurfacings")
      .withIndex("by_thought", (q) => q.eq("thoughtId", t._id))
      .collect();
    for (const r of rows) {
      lastReturned.set(
        t._id,
        Math.max(lastReturned.get(t._id) ?? 0, r._creationTime),
      );
    }
  }

  const eligible = aged.filter(
    (t) => now - (lastReturned.get(t._id) ?? -Infinity) >= RESURFACE_COOLDOWN_DAYS * DAY,
  );
  if (eligible.length === 0) return null;

  // Longest-waiting first: never-resurfaced before ever-resurfaced,
  // oldest return before recent, oldest capture as the tiebreak.
  eligible.sort((a, b) => {
    const lastA = lastReturned.get(a._id) ?? 0;
    const lastB = lastReturned.get(b._id) ?? 0;
    return lastA - lastB || a.createdAt - b.createdAt;
  });
  return eligible[0]._id;
}

// Everything delivery needs in one read; thoughtContext (store.ts) adds
// the questions and connected fragments.
export const deliveryContext = internalQuery({
  args: { resurfacingId: v.id("resurfacings") },
  handler: async (ctx, { resurfacingId }) => {
    const resurfacing = await ctx.db.get(resurfacingId);
    if (!resurfacing || resurfacing.userId === undefined) return null;
    const thought = await ctx.db.get(resurfacing.thoughtId);
    if (!thought) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", resurfacing.userId ?? ""))
      .first();
    if (!settings) return null;
    return {
      delivered: resurfacing.deliveredAt !== undefined,
      email: settings.email,
      ...(resurfacing.emailPayload
        ? { emailPayload: resurfacing.emailPayload }
        : {}),
      thought: {
        _id: thought._id,
        text: thought.text,
        createdAt: thought.createdAt,
        status: thought.status,
      },
    };
  },
});

// Freezes the first complete Resend request before the external call. If
// delivery actions ever race, Convex OCC makes them converge on this one
// stored payload; retries then use the same body under the same idempotency
// key instead of asking the model to compose again.
export const prepareEmailPayload = internalMutation({
  args: {
    resurfacingId: v.id("resurfacings"),
    payload: emailPayloadValidator,
  },
  returns: v.union(emailPayloadValidator, v.null()),
  handler: async (ctx, { resurfacingId, payload }) => {
    const resurfacing = await ctx.db.get(resurfacingId);
    if (
      !resurfacing ||
      resurfacing.userId === undefined ||
      resurfacing.deliveredAt !== undefined
    )
      return null;
    if (resurfacing.emailPayload) return resurfacing.emailPayload;

    const thought = await ctx.db.get(resurfacing.thoughtId);
    if (
      !thought ||
      thought.userId !== resurfacing.userId ||
      thought.status !== "open"
    )
      return null;

    await ctx.db.patch(resurfacingId, { emailPayload: payload });
    return payload;
  },
});

export const markDelivered = internalMutation({
  args: { resurfacingId: v.id("resurfacings") },
  handler: async (ctx, { resurfacingId }) => {
    const resurfacing = await ctx.db.get(resurfacingId);
    if (resurfacing && resurfacing.deliveredAt === undefined)
      await ctx.db.patch(resurfacingId, {
        channel: "email",
        deliveredAt: Date.now(),
      });
  },
});
