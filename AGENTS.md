# drft

A space for unfinished thoughts — instant capture on iOS, a quiet collection on the web with automatic connections, rest/wake, and a daily thought returned by email.

- `apps/web` — Vite + React + TypeScript SPA (bun)
- `apps/landing` — Astro static landing page. Ships inside the web deployment: `build:deploy` (apps/web, the Vercel build command via its `vercel.json`) builds it, copies the output into `dist` (`/landing.html`, `/privacy.html`, `/_astro/`, `/robots.txt`) and renames the app shell to `dist/app.html`. Routing is static `vercel.json` rewrites, no middleware: signed-out `/` (Clerk's `__client_uat` cookie absent, empty or `0`) goes to `/landing.html`, and `/?signin` bypasses it so the CTA reaches the app's sign-in screen; `/privacy` (the privacy policy) goes to `/privacy.html` for everyone; every other path falls back to `/app.html`. The shell must not ship as `index.html`: Vercel serves an existing file before it consults rewrites, so the `/` rewrite would never run. `/assets/` and `/_astro/` hold only content-hashed files — they are cached immutably and kept out of the fallback, so a missing chunk is a 404 rather than HTML.
- `apps/ios` — native Swift/SwiftUI capture app (outside the Bun workspace)
- `packages/backend` — Convex backend (schema, capture mutation, enrichment AI, return-loop scheduler + email, Clerk auth config)
- `docs/overview.html` — product & tech overview
- `docs/experience.html` — the experience: moment-by-moment product spec (capture rules, return loop, connections, lifecycle)
- `docs/design.html` — the design: "Stillness" (light + dark)
- `docs/vivid.html` — the four "more vivid" web directions; Ember is the one the web app uses

## Commands

From `apps/web`: `bun dev` · `bun run build` · `bun run lint` · `bun run typecheck`
From `apps/landing`: `bun dev` · `bun run build` · `bun run typecheck`
The web dev server mirrors production routing (see `landingSite` in `apps/web/vite.config.ts`; keep its `isSignedIn` in step with the `/` rewrite in `apps/web/vercel.json`): signed-out `/` serves the landing site, `/privacy` the privacy policy, `/?signin` bypasses the landing. It builds `apps/landing` on start and rebuilds + reloads on landing source changes — no second dev server needed; use `bun dev` in `apps/landing` only for focused landing work with HMR.
From `packages/backend`: `bun run dev` (convex dev) · `bun run typecheck`
Whenever the iOS Simulator is needed, use the iPhone 17 Pro Max simulator. Never build with signing disabled (e.g. `CODE_SIGNING_ALLOWED=NO`) — it strips the entitlements, silently breaking Clerk sign-in and the capture queue.

### iOS from the Linux machine

Xcode and the simulators live on the MacBook, T3 device host `macbook` (`ssh macbook` works without a password). Agents running on the Mac itself build in their own checkout and skip the sync. From Linux, build over ssh and drive the simulator only through T3's device tools. `apps/ios` is self-contained, so each checkout syncs just that folder to its own directory on the Mac — never build in the Mac's `~/Developer/drft` or `~/.t3/worktrees`, which are other checkouts.

1. `device_open` the iPhone 17 Pro Max on host `macbook` (this boots it; install fails on a shut-down simulator). It returns the `agent-device` command to use for every UI action.
2. Sync, build and install (works from anywhere in the checkout):
   ```sh
   R=$(git rev-parse --show-toplevel); W=$(basename "$R")
   rsync -az --delete --exclude .build --exclude xcuserdata "$R/apps/ios/" "macbook:.cache/drft-remote/$W/apps/ios/"
   ssh macbook "cd ~/.cache/drft-remote/$W/apps/ios && xcodebuild -project drft.xcodeproj -scheme drft -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' -derivedDataPath .build/DerivedData -quiet build && xcrun simctl install 'iPhone 17 Pro Max' .build/DerivedData/Build/Products/Debug-iphonesimulator/drft.app"
   ```
3. `<agent-device> open com.srinivasib.drft --relaunch`.

Simulator builds sign "to run locally", so signing stays on and needs no keychain unlock over ssh. Keep `-configuration Debug`: the scheme launches Release (Xcode runs on a device use production), so without it `xcodebuild` builds against production Clerk and Convex. Debug builds talk to the dev Convex deployment. All checkouts share this one simulator, so the last install wins — relaunch right before checking, and don't run two iOS checks in parallel. Each checkout's build cache on the Mac is ~2 GB; remove `~/.cache/drft-remote/<worktree>` on the Mac when the worktree is gone.

Convex deploys the entire backend snapshot. Never run `convex dev` from parallel worktrees against the same deployment; use one designated backend worktree, or give the worktree its own deployment: from `packages/backend`, `bunx convex deployment create dev/<name> --type dev --select`, set its env vars (including `CLERK_JWT_ISSUER_DOMAIN`), then point that worktree's clients at it — `VITE_CONVEX_URL` in `apps/web/.env.local`, and `ConvexService.deploymentUrl` for iOS Debug builds.

Dev-only design seed (plants sample thoughts + schedules real enrichment on them; fabricates one resurfacing for the given date — selection-log only, so no email is sent for it), from `packages/backend`:
`bunx convex run seed:run '{"date":"YYYY-MM-DD"}'` · undo with `bunx convex run seed:clear`
Both no-op unless the deployment sets `SEED_ALLOWED=1` (dev only, already set) — guards against an accidental `--prod` run.

One-time embedding catch-up for thoughts captured before enrichment existed: `bunx convex run enrichment:backfillEmbeddings`

Web env lives in `apps/web/.env.local` (see `.env.example`): `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`. The Convex deployment needs `CLERK_JWT_ISSUER_DOMAIN` set (Clerk JWT template named `convex`) and `OPENAI_API_KEY` (enrichment: embeddings + auto-linking — model routing in `convex/ai/models.ts`). The daily return email (phase 5) needs `RESEND_API_KEY` (without it delivery is dormant — selection still runs and the web shows the day's thought); optional: `DRFT_FROM_EMAIL` (defaults to the Resend sandbox `drft <onboarding@resend.dev>`, which can only send to the Resend account owner's address) and `DRFT_APP_URL` (link target in the email, defaults to `http://localhost:5173`). The send time is per-user in the `settings` table, written from web or iOS settings.

Account deletion (`convex/account.ts`, settings on web and iOS) needs `CLERK_SECRET_KEY` on the Convex deployment — the secret key of the same Clerk instance as `CLERK_JWT_ISSUER_DOMAIN` (a key from another instance is caught by comparing JWKS before a 404 is trusted). Revoking Sign in with Apple on iOS deletion needs `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the Sign in with Apple `.p8` key; `APPLE_CLIENT_ID` defaults to the bundle id `com.srinivasib.drft`); without them revocation is skipped and logged. Backend tests: `bun run test` in `packages/backend`.

## Production deployment

- Convex production is `optimistic-stork-701` (`https://optimistic-stork-701.convex.cloud`). Set its required env with `bunx convex env set --prod ...`, then deploy from `packages/backend` with `bunx convex deploy`; never set `SEED_ALLOWED` in production. Production data is separate from development and must not be migrated implicitly.
- Vercel project `drft` uses root directory `apps/web` and serves `trydrft.app` (`www` redirects to the apex). Its Production env must pair `VITE_CONVEX_URL` with the matching Clerk publishable key/Convex issuer. Vite env is build-time, so redeploy after changes from the repo root with `bunx vercel --prod --yes --archive=tgz`.
- Before the legacy `unseenQuestionCount` field is removed from the schema, run `bunx convex run migrations:clearPartnerData --prod` once after deploying, so no production row still carries partner data.
- Embeddings live in `thoughtEmbeddings`, connections carry their owner, and thoughts carry `lastReturnedAt`. Rows from before that keep working through legacy read paths (`convex/migrationState.ts`) until `bunx convex run migrations:backfillFastPaths` (add `--prod`) has run once on the deployment; `migrations:fastPathStatus` reports all three flags `true` when it has finished. Only after that may `thoughts.embedding`, its vector index and the legacy paths be removed.
- Deploy Convex before shipping an iOS build: `thoughts:capture` takes the queue's `clientId` and `createdAt`, and a backend without them rejects the call (the capture stays queued and retries).
- Production uses Clerk live keys (`clerk.trydrft.app`); iOS Debug builds use the development Clerk instance and Release builds production (`CLERK_PUBLISHABLE_KEY` build setting), matching the Convex split (`ConvexService.deploymentUrl`). Email sends from the verified Resend domain (`DRFT_FROM_EMAIL` = `drft <hello@trydrft.app>`).
- Sign in with Apple: native on iOS (`Clerk.shared.auth.signInWithApple`, entitlement in `drft.entitlements`), `oauth_apple` on web. Both Clerk instances use Services ID `app.trydrft.signin` and list the iOS app under Native applications. Mail to Hide My Email relay addresses only delivers from sources registered under Apple Developer → Sign in with Apple for Email Communication, and each must pass SPF there.

## Conventions

- Bun for packages and scripts; never npm/yarn.
- TypeScript: no `any`.
- Web UI follows Ember (`docs/vivid.html#ember`): the Stillness palette from `docs/design.html` with Geist, sentence-case labels (no tiny spaced capitals), Phosphor icons (`@phosphor-icons/react`), 10px surfaces and pill controls, and the vermilion as the accent for "now" (tokens in `apps/web/src/tokens.css`, which the landing site imports too, so the two never drift apart). iOS follows Ember too (tokens in `apps/ios/drft/Shared/Stillness`, components in `apps/ios/drft/Shared/Ember`).
- UI copy (web, iOS, email): never "done", "complete", "archive", "inbox", "process" or "task" — thoughts are *kept*, *revisited*, *held*, *set down* (`docs/experience.html`). No congratulating, streaks or nudges.
- Capture never fails visibly and never asks for anything: no error, spinner, retry or extra field on the capture path. Offline captures queue on-device and still confirm; the user's words are stored verbatim.
