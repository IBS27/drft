import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

// The product's one real preference: when the daily email arrives. Both
// clients (web settings, iOS settings sheet) read and write the same row;
// the server sends the email, so the server owns the time.

export const DEFAULT_SEND_TIME = "08:00";

const SEND_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function upsert(
  ctx: MutationCtx,
  args: { sendTime?: string; timezone: string; email?: string },
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in");
  if (args.sendTime !== undefined && !SEND_TIME.test(args.sendTime))
    throw new Error("sendTime must be HH:MM (24h)");
  if (!validTimezone(args.timezone)) throw new Error("Unknown timezone");

  const existing = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", identity.subject))
    .first();
  // The identity's email is the truth when the JWT carries one; a
  // client-provided value only fills a first-time gap — it never
  // overwrites an address already on file.
  const email = identity.email ?? existing?.email ?? args.email;
  if (!email) throw new Error("No email available for this account");

  if (existing) {
    await ctx.db.patch(existing._id, {
      email,
      timezone: args.timezone,
      ...(args.sendTime !== undefined ? { sendTime: args.sendTime } : {}),
    });
  } else {
    await ctx.db.insert("settings", {
      userId: identity.subject,
      email,
      sendTime: args.sendTime ?? DEFAULT_SEND_TIME,
      timezone: args.timezone,
    });
  }
  return identity.subject;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    return row
      ? { sendTime: row.sendTime, timezone: row.timezone, email: row.email }
      : null;
  },
});

// Called once per signed-in load: creates the row (default 8:00, the
// client's timezone) so the daily email starts without a settings visit,
// and keeps the timezone current when the user travels.
export const ensure = mutation({
  args: { timezone: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await upsert(ctx, args);
  },
});

export const save = mutation({
  args: {
    sendTime: v.string(),
    timezone: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsert(ctx, args);
  },
});
