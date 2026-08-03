# drft

A space for unfinished thoughts — instant capture on iOS, an AI thinking-partner workspace on the web.

- `apps/web` — Vite + React + TypeScript SPA (bun)
- `apps/landing` — Astro static landing page. Ships inside the web deployment: `build:deploy` (apps/web, the Vercel build command via its `vercel.json`) builds it and copies the output into `dist` (`/landing.html`, `/_astro/`, `/robots.txt`); `apps/web/middleware.ts` (edge) rewrites signed-out `/` to `/landing.html`, and `/?signin` bypasses it so the CTA reaches the app's sign-in screen.
- `apps/ios` — native Swift/SwiftUI capture app (outside the Bun workspace; see `apps/ios/SPEC.md`)
- `packages/backend` — Convex backend (schema, capture mutation, enrichment/partner AI, return-loop scheduler + email, Clerk auth config)
- `docs/overview.html` — product & tech overview
- `docs/experience.html` — the experience: moment-by-moment product spec (capture rules, return loop, partner contract, lifecycle)
- `docs/design.html` — the design: "Stillness" (light + dark)

## Commands

From `apps/web`: `bun dev` · `bun run build` · `bun run lint` · `bun run typecheck`
From `apps/landing`: `bun dev` · `bun run build` · `bun run typecheck`
The web dev server mirrors production routing (see `landingSite` in `apps/web/vite.config.ts`): signed-out `/` serves the landing site, `/?signin` bypasses it. It builds `apps/landing` on start and rebuilds + reloads on landing source changes — no second dev server needed; use `bun dev` in `apps/landing` only for focused landing work with HMR.
From `packages/backend`: `bun run dev` (convex dev) · `bun run typecheck`

Dev-only design seed (plants sample thoughts + schedules real enrichment on them; fabricates one resurfacing for the given date — selection-log only, so no email is sent for it), from `packages/backend`:
`bunx convex run seed:run '{"date":"YYYY-MM-DD"}'` · undo with `bunx convex run seed:clear`
Both no-op unless the deployment sets `SEED_ALLOWED=1` (dev only, already set) — guards against an accidental `--prod` run.

One-time embedding catch-up for thoughts/messages captured before phase 3: `bunx convex run enrichment:backfillEmbeddings`

Web env lives in `apps/web/.env.local` (see `.env.example`): `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`. The Convex deployment needs `CLERK_JWT_ISSUER_DOMAIN` set (Clerk JWT template named `convex`) and `OPENAI_API_KEY` (phase 3: partner sessions, enrichment, embeddings — model routing in `convex/ai/models.ts`). The daily return email (phase 5) needs `RESEND_API_KEY` (without it delivery is dormant — selection still runs and the web shows the day's thought); optional: `DRFT_FROM_EMAIL` (defaults to the Resend sandbox `drft <onboarding@resend.dev>`, which can only send to the Resend account owner's address) and `DRFT_APP_URL` (link target in the email, defaults to `http://localhost:5173`). The send time is per-user in the `settings` table, written from web or iOS settings.

## Production deployment

- Convex production is `optimistic-stork-701` (`https://optimistic-stork-701.convex.cloud`). Set its required env with `bunx convex env set --prod ...`, then deploy from `packages/backend` with `bunx convex deploy`; never set `SEED_ALLOWED` in production. Production data is separate from development and must not be migrated implicitly.
- Vercel project `drft` uses root directory `apps/web` and serves `trydrft.app` (`www` redirects to the apex). Its Production env must pair `VITE_CONVEX_URL` with the matching Clerk publishable key/Convex issuer. Vite env is build-time, so redeploy after changes from the repo root with `bunx vercel --prod --yes --archive=tgz`.
- Production currently uses Clerk test keys. Email remains sandbox-only until a verified sender is set in `DRFT_FROM_EMAIL`; the iOS client still targets the development Convex deployment.

## Conventions

- Bun for packages and scripts; never npm/yarn.
- TypeScript: no `any`.
- Follow the Stillness design tokens in `docs/design.html` for all UI.
