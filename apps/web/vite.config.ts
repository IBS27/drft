import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

const landingRoot = fileURLToPath(new URL('../landing', import.meta.url))
const landingDist = path.join(landingRoot, 'dist')

// Same paths middleware.ts routes to the landing in production.
const LANDING_PATHS = /^\/(_astro\/|robots\.txt$)/

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

// Dev mirror of middleware.ts: signed-out "/" gets the Astro landing page,
// "/_astro/*" and "/robots.txt" serve its build assets, and "/?signin"
// bypasses the landing so its CTA reaches the app's sign-in screen. The
// landing is served from apps/landing/dist — built when this dev server
// starts, rebuilt (then page-reloaded) when apps/landing sources change.
// Astro's own dev-module URLs (/src/*, /@vite/*) would collide with this
// server's, so the built output is what production-faithful dev serving
// requires; for focused landing work with HMR, run `bun dev` in apps/landing.
function landingSite(): Plugin {
  let building: Promise<boolean> = Promise.resolve(false)

  const build = (server: ViteDevServer): Promise<boolean> => {
    building = new Promise((resolve) => {
      const child = spawn('bun', ['run', 'build'], { cwd: landingRoot, stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('exit', (code) => {
        if (code !== 0) server.config.logger.error(`landing build failed (exit ${code}) — run \`bun run build\` in apps/landing for details`)
        resolve(code === 0)
      })
    })
    return building
  }

  return {
    name: 'drft:landing-site',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('building landing site (apps/landing)…')
      void build(server)

      const watched = [path.join(landingRoot, 'src'), path.join(landingRoot, 'public'), path.join(landingRoot, 'astro.config.mjs')]
      server.watcher.add(watched)
      let timer: ReturnType<typeof setTimeout> | undefined
      server.watcher.on('all', (_event, file) => {
        if (!watched.some((w) => file === w || file.startsWith(w + path.sep))) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          void build(server).then((ok) => {
            if (!ok) return
            server.config.logger.info('landing rebuilt — reloading')
            server.ws.send({ type: 'full-reload', path: '*' })
          })
        }, 300)
      })

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const landingHome =
          url.pathname === '/' && !url.searchParams.has('signin') && !isSignedIn(req.headers.cookie)
        if (!landingHome && !LANDING_PATHS.test(url.pathname)) return next()

        const file = path.normalize(path.join(landingDist, decodeURIComponent(landingHome ? '/index.html' : url.pathname)))
        if (!file.startsWith(landingDist + path.sep)) return next()

        void building.then(async () => {
          try {
            let body = await readFile(file)
            if (landingHome) {
              // Hook the page into this server's HMR socket so landing
              // rebuilds can trigger a full reload.
              body = Buffer.from(
                body.toString().replace('</head>', '<script type="module" src="/@vite/client"></script></head>'),
              )
            }
            res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
            res.end(body)
          } catch {
            res.statusCode = landingHome ? 503 : 404
            res.end(landingHome ? 'landing site not built — check the dev server log' : 'not found')
          }
        })
      })
    },
  }
}

// Keep in sync with isSignedIn in middleware.ts.
function isSignedIn(cookieHeader: string | undefined): boolean {
  const uat = cookieHeader?.match(/(?:^|;\s*)__client_uat=([^;]*)/)?.[1]
  return uat !== undefined && uat !== '' && uat !== '0'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), landingSite()],
})
