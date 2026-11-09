import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { migrated } from "./migrationState";
import {
  CAPTURE_LAG_MS,
  COOLDOWN_MS,
  MIN_AGE_MS,
  earliestEligibleAt,
  localInstant,
  localParts,
  nextDate,
  selectThoughtId,
  sendMinutes,
} from "./selection";

// The return loop's selection half — deliberately dumb. No readiness
// scoring, no model choosing: a slow rotation over what the user put in.
// Skip resting, skip the fresh, skip the recently returned, then take
// whichever open thought has waited longest. If nothing qualifies, the
// day is silent. The arithmetic lives in selection.ts (pure, tested);
// delivery (email.ts) is an adapter over the rows this writes. See
// docs/experience.html §03.

const MIN_GAP_MS = 20 * 3_600_000;
// Due users handed out per tick transaction: far inside what one mutation
// may read and schedule, and a busy quarter hour just takes more pages.
const TICK_PAGE_SIZE = 200;
const emailPayloadValidator = v.object({
  from: v.string(),
  to: v.string(),
  subject: v.string(),
  text: v.string(),
  html: v.string(),
});

// Runs every 15 minutes (crons.ts). It only finds who is due: each due
// user gets a transaction of their own (`forUser`), so one account's
// trouble — a collection too large to read, a row that will not parse —
// can never cost anyone else their morning. A user stays due until their
// own run moves `nextDueAt` on, so a run that failed is simply tried
// again at the next tick. `now` and `cursor` carry a tick across pages
// when more users are due than one transaction should schedule.
export const tick = internalMutation({
  args: { now: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const due = await ctx.db
      .query("settings")
      .withIndex("by_nextDueAt", (q) => q.lte("nextDueAt", now))
      .paginate({ cursor: args.cursor ?? null, numItems: TICK_PAGE_SIZE });
    for (const settings of due.page) {
      await ctx.scheduler.runAfter(0, internal.resurfacing.forUser, {
        userId: settings.userId,
        now,
      });
    }
    if (!due.isDone) {
      await ctx.scheduler.runAfter(0, internal.resurfacing.tick, {
        now,
        cursor: due.continueCursor,
      });
    }
  },
});

// One user's turn. Once their local clock passes their chosen time: pick
// today's thought if not yet picked, then hand the row to delivery.
// Delivery is retried each tick until it stamps deliveredAt — a transient
// send failure never silently eats the day.
//
// Then it works out when to look again. `nextDueAt` is never a promise to
// send, only the earliest moment this could have anything to do if
// nothing changes meanwhile — so the tick can skip the user until then
// instead of asking every quarter hour. Whatever could make a thought
// eligible sooner moves it up: settings.ts (time or timezone changed),
// thoughts.wake, and a capture made offline long ago (thoughts.capture).
export const forUser = internalMutation({
  // `now` is the tick's own instant. The run decides by it, not by
  // whenever the scheduler reached this user: a tick at 23:45 belongs to
  // that day even if its work starts a moment after midnight.
  args: { userId: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { userId, now = Date.now() }) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!settings) return;
    const nextDueAt = await returnToday(ctx, settings, now);
    // "Still due" needs no write when the row already says so — an
    // undelivered day would otherwise rewrite settings every tick.
    const alreadyDue = (settings.nextDueAt ?? 0) <= now;
    if (nextDueAt <= now ? alreadyDue : nextDueAt === settings.nextDueAt) return;
    await ctx.db.patch(settings._id, { nextDueAt });
  },
});

// Does today's work for one user and returns when to look again; a time
// that is not in the future means "at the next tick".
async function returnToday(
  ctx: MutationCtx,
  settings: Doc<"settings">,
  now: number,
): Promise<number> {
  const { userId, timezone } = settings;
  const { date, minutesOfDay } = localParts(timezone, now);
  const send = sendMinutes(settings.sendTime);
  if (minutesOfDay < send) return localInstant(timezone, date, send);

  const today = await ctx.db
    .query("resurfacings")
    .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
    .first();
  if (today) {
    if (today.deliveredAt !== undefined)
      return localInstant(timezone, nextDate(date), send);
    await ctx.scheduler.runAfter(0, internal.email.deliver, {
      resurfacingId: today._id,
    });
    return now;
  }

  // "One per day" by the wall clock too: a timezone change can start
  // a new local date hours after the last send — the floor keeps
  // travel from ever producing two emails in one waking day.
  const latest = await ctx.db
    .query("resurfacings")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  // That same travel can leave a row dated ahead of today (chosen under
  // a clock further east). It becomes "today's" when the date does, so
  // the next look is no later than tomorrow's time.
  const horizon =
    latest && latest.date > date
      ? localInstant(timezone, nextDate(date), send)
      : Infinity;
  if (latest && now - latest._creationTime < MIN_GAP_MS)
    return Math.min(latest._creationTime + MIN_GAP_MS, horizon);

  const { thoughtId, eligibleAt } = (await migrated(ctx, "lastReturnedAt"))
    ? await select(ctx, userId, now)
    : await legacySelect(ctx, userId, now);
  // Silence beats filler. The day stays open, though: a thought that
  // comes of age this afternoon is sent this afternoon. A thought
  // captured after this run can't be old enough before the second bound
  // (see CAPTURE_LAG_MS), so nothing needs to tell us about it.
  if (!thoughtId)
    return Math.min(eligibleAt, now + MIN_AGE_MS - CAPTURE_LAG_MS, horizon);

  const resurfacingId = await ctx.db.insert("resurfacings", {
    thoughtId,
    date,
    userId,
  });
  await markReturned(ctx, thoughtId, resurfacingId);
  await ctx.scheduler.runAfter(0, internal.email.deliver, { resurfacingId });
  return now;
}

// A row is created the moment the thought is shown, so its _creationTime
// is the instant the user saw it — truer than parsing the local-date
// string (UTC-midnight skew). Whoever inserts a resurfacing calls this, so
// the thought's place in the rotation moves with it.
export async function markReturned(
  ctx: MutationCtx,
  thoughtId: Id<"thoughts">,
  resurfacingId: Id<"resurfacings">,
) {
  const resurfacing = await ctx.db.get(resurfacingId);
  if (resurfacing)
    await ctx.db.patch(thoughtId, { lastReturnedAt: resurfacing._creationTime });
}

// Something just became able to return sooner than the schedule assumed:
// make sure the user's next look is no later than `at`.
export async function returnNoLaterThan(
  ctx: MutationCtx,
  userId: string,
  at: number,
) {
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (settings?.nextDueAt !== undefined && settings.nextDueAt > at)
    await ctx.db.patch(settings._id, { nextDueAt: at });
}

type Selection = { thoughtId: Id<"thoughts"> | null; eligibleAt: number };

// selection.ts's rule, read off the by_user_status_lastReturnedAt index
// instead of the whole collection. Never-returned thoughts sort first,
// oldest capture first, so the oldest of them is the only one that can be
// due; after them, the thought whose last return is oldest. `eligibleAt`
// is when the silence could end if nothing is selected.
async function select(
  ctx: MutationCtx,
  userId: string,
  now: number,
): Promise<Selection> {
  const neverReturned = await ctx.db
    .query("thoughts")
    .withIndex("by_user_status_lastReturnedAt", (q) =>
      q.eq("userId", userId).eq("status", "open").eq("lastReturnedAt", undefined),
    )
    .first();
  if (neverReturned && neverReturned.createdAt <= now - MIN_AGE_MS)
    return { thoughtId: neverReturned._id, eligibleAt: now };

  // Anything returned was old enough when it returned, so the age filter
  // passes the first row; it only guards hand-made history.
  const cooledDown = await ctx.db
    .query("thoughts")
    .withIndex("by_user_status_lastReturnedAt", (q) =>
      q
        .eq("userId", userId)
        .eq("status", "open")
        .gte("lastReturnedAt", 0)
        .lte("lastReturnedAt", now - COOLDOWN_MS),
    )
    .filter((q) => q.lte(q.field("createdAt"), now - MIN_AGE_MS))
    .first();
  if (cooledDown) return { thoughtId: cooledDown._id, eligibleAt: now };

  const leastRecent = await ctx.db
    .query("thoughts")
    .withIndex("by_user_status_lastReturnedAt", (q) =>
      q.eq("userId", userId).eq("status", "open").gte("lastReturnedAt", 0),
    )
    .first();
  return {
    thoughtId: null,
    eligibleAt: Math.min(
      neverReturned ? neverReturned.createdAt + MIN_AGE_MS : Infinity,
      leastRecent?.lastReturnedAt !== undefined
        ? leastRecent.lastReturnedAt + COOLDOWN_MS
        : Infinity,
    ),
  };
}

// The selection as it was before thoughts carried lastReturnedAt: read
// every open thought and every return of each. Used until the backfill
// has stamped the thoughts returned before this release (see
// migrationState.ts); goes with it. Rows without userId (pre-phase-5)
// still count: a thought is one user's.
async function legacySelect(
  ctx: MutationCtx,
  userId: string,
  now: number,
): Promise<Selection> {
  const open = await ctx.db
    .query("thoughts")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open"))
    .collect();

  const lastReturned = new Map<string, number>();
  for (const t of open) {
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

  return {
    thoughtId: selectThoughtId(open, lastReturned, now),
    eligibleAt: earliestEligibleAt(open, lastReturned),
  };
}

// Everything delivery needs in one read.
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
      // The stored request existed to make a retry an exact replay.
      // Once delivered there is nothing left to retry, and it is most
      // of the row.
      await ctx.db.patch(resurfacingId, {
        channel: "email",
        deliveredAt: Date.now(),
        emailPayload: undefined,
      });
  },
});
