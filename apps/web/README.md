# drft web

The thinking-partner workspace: the collection, the thought view with
the partner session, search, and settings. Vite + React + TypeScript +
TanStack Router + Convex + Clerk; styled with Tailwind against the
Stillness tokens in `docs/design.html`.

## Commands

```sh
bun dev            # assume it's already running
bun run typecheck
bun run lint
bun run build
```

## Env

`.env.local` (see `.env.example`): `VITE_CONVEX_URL`,
`VITE_CLERK_PUBLISHABLE_KEY`.

## Notes

- Routes are file-based in `src/routes/` (codegen in `src/routeTree.gen.ts`).
- Streaming partner replies arrive through the reactive
  `api.thoughts.view` query — the backend patches the message row as
  tokens land; there is no client-side streaming transport.
- Keyboard: `⌘K` or `/` opens search; on a thought, `j`/`k` move through
  the collection and `Esc` returns to it.
- `middleware.ts` is a Vercel edge middleware (production only) that
  rewrites signed-out `/` to the landing deployment; `/?signin` bypasses.
