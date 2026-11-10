# drft web

The workspace: the collection, the thought view (the thought, its
connections, rest/wake), search, and settings. Vite + React +
TypeScript + TanStack Router + Convex + Clerk; styled with Tailwind
against the Stillness tokens in `docs/design.html`.

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
- A thought's connections arrive through the reactive
  `api.thoughts.view` query — background enrichment writes them after
  capture, so they simply appear; dismissing one is an optimistic
  mutation with undo.
- Keyboard: `⌘K` or `/` opens search; on a thought, `j`/`k` move through
  the collection and `Esc` returns to it.
- Production routing is the rewrites in `vercel.json` (mirrored in dev by
  `landingSite` in `vite.config.ts`): signed-out `/` serves the landing
  page, `/?signin` bypasses it, everything else falls back to the app
  shell, which `build:deploy` ships as `app.html` — as `index.html` it
  would be served for `/` before any rewrite ran.
- `/assets/` and `/_astro/` are cached immutably, so only content-hashed
  files belong there (not `public/assets/`).
