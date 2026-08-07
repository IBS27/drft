"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// The delivery half of the return loop — an adapter over the selection
// rows resurfacing.ts writes. One email, one quiet link, nothing to
// dismiss; re-exposure is the whole job (docs/experience.html §03).
//
// Sandbox by default: without a verified domain, Resend sends from
// onboarding@resend.dev to the account owner's own address — exactly
// right for a single-user product. Without RESEND_API_KEY the adapter is
// dormant (the resurfacing still appears on the web); the tick retries
// until the send succeeds, so setting the key mid-morning still delivers.

declare const process: { env: Record<string, string | undefined> };

const DAY = 86_400_000;

// "You kept this two weeks ago" — round, human, never a count-up.
function agoPhrase(createdAt: number, now: number): string {
  const days = Math.max(0, Math.floor((now - createdAt) / DAY));
  if (days < 2) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "a week ago";
  if (days < 21) return "two weeks ago";
  if (days < 28) return "three weeks ago";
  if (days < 60) return "a month ago";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return "over a year ago";
}

function subjectLine(text: string): string {
  const line = text.split("\n", 1)[0].trim();
  return line.length > 78 ? `${line.slice(0, 77)}…` : line;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const deliver = internalAction({
  args: { resurfacingId: v.id("resurfacings") },
  handler: async (ctx, { resurfacingId }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log("[email] RESEND_API_KEY not set — delivery dormant");
      return;
    }
    const delivery = await ctx.runQuery(internal.resurfacing.deliveryContext, {
      resurfacingId,
    });
    // Rested between selection and delivery = never sent again; already
    // delivered = the tick's retry arriving after a success.
    if (!delivery || delivery.delivered || delivery.thought.status !== "open")
      return;

    let payload = delivery.emailPayload;
    if (!payload) {
      const now = Date.now();
      const ago = agoPhrase(delivery.thought.createdAt, now);
      const body = `You kept this ${ago}.`;

      const appUrl = (
        process.env.DRFT_APP_URL ?? "http://localhost:5173"
      ).replace(/\/$/, "");
      const link = `${appUrl}/thought/${delivery.thought._id}`;
      const candidate = {
        from: process.env.DRFT_FROM_EMAIL ?? "drft <onboarding@resend.dev>",
        to: delivery.email,
        subject: subjectLine(delivery.thought.text),
        text: `${body}\n\n${link}`,
        // Stillness, light room only — email clients own dark mode badly.
        html: [
          `<div style="background:#fafaf8;padding:48px 24px;font-family:'Helvetica Neue',ui-sans-serif,system-ui,sans-serif;font-weight:300;">`,
          `<div style="max-width:520px;margin:0 auto;">`,
          `<p style="margin:0;color:#2b2b28;font-size:16px;line-height:1.65;">${escapeHtml(body)}</p>`,
          `<p style="margin:28px 0 0;"><a href="${link}" style="color:#6b6b65;font-size:12px;letter-spacing:0.26em;text-transform:uppercase;text-decoration:none;">open in drft</a></p>`,
          `</div></div>`,
        ].join(""),
      };

      // This is also the last transactional status check before the external
      // send. A concurrent action returns the payload that won the race.
      const preparedPayload = await ctx.runMutation(
        internal.resurfacing.prepareEmailPayload,
        { resurfacingId, payload: candidate },
      );
      if (!preparedPayload) return;
      payload = preparedPayload;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Every attempt replays the exact persisted request. Resend can
        // therefore return the original success without sending twice.
        "Idempotency-Key": resurfacingId,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(
        `[email] Resend responded ${response.status}: ${await response.text()}`,
      );
      return; // deliveredAt stays unset; the next tick retries
    }
    await ctx.runMutation(internal.resurfacing.markDelivered, { resurfacingId });
  },
});
