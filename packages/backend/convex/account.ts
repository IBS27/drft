import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { revokeAppleGrant } from "./appleRevocation";
import { fetchWithTimeout } from "./fetchWithTimeout";

// Account deletion: the Clerk user and everything stored for them —
// thoughts, connections, notes, resurfacings, settings, consent.
//
// The user's confirmation commits the deletion. From then on the server
// drives it to completion on its own: the purge is scheduled in the same
// transaction that records the request, and removing the Clerk user is
// retried until it succeeds. Once the action returns, the client treats the
// account as gone; it only hears an error if the request never committed.
//
// The `accountDeletions` row blocks new writes for the user (capture,
// settings, consent) while this runs — a still-valid session token could otherwise
// add a thought behind the purge. Every other row hangs off a thought, and
// those paths already refuse a thought that no longer exists. The row is
// removed a day after both halves finish, long after any token for the
// deleted user has expired.

// The Convex runtime provides process.env; declared here so this file also
// typechecks inside the web app's program (no node types there).
declare const process: { env: Record<string, string | undefined> };

// Per purge transaction: a document count, and a byte estimate for
// thoughts (text plus a 1536-float embedding), kept well inside Convex's
// read limits however long a single thought is.
const PURGE_DOCUMENT_BUDGET = 1_000;
const PURGE_THOUGHT_BYTES_BUDGET = 4_000_000;
const EMBEDDING_BYTES = 1536 * 8;

const CLERK_RETRY_BASE_MS = 60_000;
const CLERK_RETRY_MAX_MS = 3_600_000;
const CLERK_MAX_ATTEMPTS = 30;
const FORGET_AFTER_MS = 86_400_000;
const FORGET_RECHECK_MS = 3_600_000;

async function deletionOf(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("accountDeletions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

// For write paths that create rows for a user.
export async function isAccountDeleting(
  ctx: QueryCtx,
  userId: string,
): Promise<boolean> {
  return (await deletionOf(ctx, userId)) !== null;
}

export const deleteAccount = action({
  args: { appleAuthorizationCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { appleAuthorizationCode }): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const userId = identity.subject;

    const { clerkDeleted } = await ctx.runMutation(internal.account.request, {
      userId,
    });
    if (clerkDeleted) return null;

    // Apple asks apps to revoke the Sign in with Apple grant on deletion.
    // Best effort: an Apple outage must never keep an account alive.
    if (appleAuthorizationCode) {
      try {
        await revokeAppleGrant(appleAuthorizationCode);
      } catch (error) {
        console.error("[account] Sign in with Apple revocation failed", error);
      }
    }

    try {
      await deleteClerkUser(userId);
      await ctx.runMutation(internal.account.markClerkDeleted, { userId });
    } catch (error) {
      // Committed either way: the scheduled retries finish the job.
      console.error(`[account] removing Clerk user ${userId} failed; retrying`, error);
    }
    return null;
  },
});

export const request = internalMutation({
  args: { userId: v.string() },
  returns: v.object({ clerkDeleted: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const existing = await deletionOf(ctx, userId);
    if (existing?.clerkDeletedAt !== undefined) return { clerkDeleted: true };
    if (!existing)
      await ctx.db.insert("accountDeletions", {
        userId,
        requestedAt: Date.now(),
      });
    // The daily tick only visits users with settings, and enrichment only
    // sends for users who allowed it: no email and no OpenAI request goes
    // out from this moment on, even before the purge reaches anything else.
    await deleteSettingsAndConsent(ctx, userId);
    await ctx.scheduler.runAfter(0, internal.account.purge, { userId });
    // The safety net, in case the caller's own attempt never completes.
    await ctx.scheduler.runAfter(
      CLERK_RETRY_BASE_MS,
      internal.account.retryClerkDeletion,
      { userId, attempt: 1 },
    );
    return { clerkDeleted: false };
  },
});

// Deletes the user's rows a bounded batch at a time, rescheduling itself
// until nothing is left. Each thought goes in the same transaction as
// everything hanging off it, so no child is ever left without its thought.
export const purge = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    let documents = PURGE_DOCUMENT_BUDGET;
    let thoughtBytes = PURGE_THOUGHT_BYTES_BUDGET;
    const drop = async (rows: { _id: Id<TableNames> }[]) => {
      for (const row of rows) await ctx.db.delete(row._id);
      documents -= rows.length;
      return documents <= 0;
    };
    const continueLater = async () => {
      await ctx.scheduler.runAfter(0, internal.account.purge, { userId });
      return null;
    };

    while (thoughtBytes > 0) {
      const thought = await ctx.db
        .query("thoughts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (!thought) break;
      const thoughtId = thought._id;
      if (
        (await drop(
          await ctx.db
            .query("connections")
            .withIndex("by_from", (q) => q.eq("fromId", thoughtId))
            .take(documents),
        )) ||
        (await drop(
          await ctx.db
            .query("connections")
            .withIndex("by_to", (q) => q.eq("toId", thoughtId))
            .take(documents),
        )) ||
        (await drop(
          await ctx.db
            .query("notes")
            .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
            .take(documents),
        )) ||
        (await drop(
          await ctx.db
            .query("resurfacings")
            .withIndex("by_thought", (q) => q.eq("thoughtId", thoughtId))
            .take(documents),
        ))
      )
        return await continueLater();
      thoughtBytes -= thought.text.length * 4 + EMBEDDING_BYTES;
      if (await drop([thought])) return await continueLater();
    }
    if (thoughtBytes <= 0) return await continueLater();

    // Selection history whose thought is already gone.
    if (
      await drop(
        await ctx.db
          .query("resurfacings")
          .withIndex("by_user_date", (q) => q.eq("userId", userId))
          .take(documents),
      )
    )
      return await continueLater();
    await deleteSettingsAndConsent(ctx, userId);

    const deletion = await deletionOf(ctx, userId);
    if (deletion) await ctx.db.patch(deletion._id, { purgedAt: Date.now() });
    return null;
  },
});

export const markClerkDeleted = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const deletion = await deletionOf(ctx, userId);
    if (!deletion || deletion.clerkDeletedAt !== undefined) return null;
    await ctx.db.patch(deletion._id, { clerkDeletedAt: Date.now() });
    await ctx.scheduler.runAfter(FORGET_AFTER_MS, internal.account.forget, {
      userId,
    });
    return null;
  },
});

export const clerkDeletionPending = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const deletion = await deletionOf(ctx, userId);
    return deletion !== null && deletion.clerkDeletedAt === undefined;
  },
});

export const retryClerkDeletion = internalAction({
  args: { userId: v.string(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, attempt }): Promise<null> => {
    const pending = await ctx.runQuery(internal.account.clerkDeletionPending, {
      userId,
    });
    if (!pending) return null;
    try {
      await deleteClerkUser(userId);
      await ctx.runMutation(internal.account.markClerkDeleted, { userId });
    } catch (error) {
      if (attempt >= CLERK_MAX_ATTEMPTS) {
        console.error(
          `[account] gave up removing Clerk user ${userId} after ${attempt} attempts — delete it by hand`,
          error,
        );
        return null;
      }
      console.warn(`[account] removing Clerk user ${userId} failed`, error);
      await ctx.scheduler.runAfter(
        Math.min(CLERK_RETRY_BASE_MS * 2 ** attempt, CLERK_RETRY_MAX_MS),
        internal.account.retryClerkDeletion,
        { userId, attempt: attempt + 1 },
      );
    }
    return null;
  },
});

// The last trace of the account: removed once the purge has finished.
export const forget = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const deletion = await deletionOf(ctx, userId);
    if (!deletion) return null;
    if (deletion.purgedAt === undefined) {
      // A purge that should have finished long ago failed outright (a
      // scheduled mutation that throws is not retried): start it again.
      console.error(`[account] purge for ${userId} unfinished; restarting it`);
      await ctx.scheduler.runAfter(0, internal.account.purge, { userId });
      await ctx.scheduler.runAfter(FORGET_RECHECK_MS, internal.account.forget, {
        userId,
      });
      return null;
    }
    await ctx.db.delete(deletion._id);
    return null;
  },
});

async function deleteSettingsAndConsent(ctx: MutationCtx, userId: string) {
  const rows = [
    ...(await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()),
    ...(await ctx.db
      .query("consents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()),
  ];
  for (const row of rows) await ctx.db.delete(row._id);
}

// Clerk's Backend API. Deleting the user also ends every session it has.
async function deleteClerkUser(userId: string): Promise<void> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY is not set");
  const response = await fetchWithTimeout(
    `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${secret}` } },
  );
  if (response.ok) return;
  // 404 is "already gone" (an earlier attempt succeeded but its reply was
  // lost) — unless the key belongs to another Clerk instance, where every
  // user is unknown. Only trust it from the instance that signs our tokens.
  if (response.status === 404 && (await secretMatchesIssuer(secret))) return;
  throw new Error(
    `Clerk user deletion failed: ${response.status} ${await response.text()}`,
  );
}

async function secretMatchesIssuer(secret: string): Promise<boolean> {
  const issuer = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "").replace(/\/$/, "");
  if (!issuer) return false;
  const [byKey, byIssuer] = await Promise.all([
    fetchWithTimeout("https://api.clerk.com/v1/jwks", {
      headers: { Authorization: `Bearer ${secret}` },
    }),
    fetchWithTimeout(`${issuer}/.well-known/jwks.json`, {}),
  ]);
  if (!byKey.ok || !byIssuer.ok) return false;
  const kids = async (r: Response) =>
    ((await r.json()) as { keys?: { kid?: string }[] }).keys?.map((k) => k.kid) ?? [];
  const issuerKids = new Set(await kids(byIssuer));
  return (await kids(byKey)).some((kid) => kid !== undefined && issuerKids.has(kid));
}
