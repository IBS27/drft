# drft

A space for unfinished thoughts — instant capture on iOS, an AI thinking-partner workspace on the web.

- `apps/web` — Vite + React + TypeScript SPA (bun)
- `apps/ios` — native Swift/SwiftUI app (planned, outside the Bun workspace)
- `packages/backend` — Convex backend (schema, capture mutation, Clerk auth config)
- `docs/overview.html` — product & tech overview
- `docs/experience.html` — the experience: moment-by-moment product spec (capture rules, return loop, partner contract, lifecycle)
- `docs/design.html` — the design: "Stillness" (light + dark)

## Commands

From `apps/web`: `bun dev` · `bun run build` · `bun run lint` · `bun run typecheck`
From `packages/backend`: `bun run dev` (convex dev) · `bun run typecheck`

Dev-only design seed (plants sample thoughts + schedules real enrichment on them; fakes only the resurfacing until phase 5), from `packages/backend`:
`bunx convex run seed:run '{"date":"YYYY-MM-DD"}'` · undo with `bunx convex run seed:clear`
Both no-op unless the deployment sets `SEED_ALLOWED=1` (dev only, already set) — guards against an accidental `--prod` run.

One-time embedding catch-up for thoughts/messages captured before phase 3: `bunx convex run enrichment:backfillEmbeddings`

Web env lives in `apps/web/.env.local` (see `.env.example`): `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`. The Convex deployment needs `CLERK_JWT_ISSUER_DOMAIN` set (Clerk JWT template named `convex`) and `OPENAI_API_KEY` (phase 3: partner sessions, enrichment, embeddings — model routing in `convex/ai/models.ts`).

## Conventions

- Bun for packages and scripts; never npm/yarn.
- TypeScript: no `any`.
- Follow the Stillness design tokens in `docs/design.html` for all UI.
