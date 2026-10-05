import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seo } from './vite.seo.ts'
import { prerender } from './vite.prerender.ts'

/**
 * The development proxy for `/api` (production rewrites it in `vercel.json`).
 *
 * `API_PROXY_TARGET` overrides the default backend address, so two checkouts — the main
 * one and a worktree — can each run their own backend on their own port without one
 * of them taking the other's. `vite preview` uses the same proxy (its default), which is
 * how the browser end-to-end suite serves a production build against its own backend.
 * The proxy plays no part in a build's output.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8081'

interface VercelConfig {
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
}

/**
 * The headers production sends with every page — read from `vercel.json`, so there is one
 * copy — for `vite preview` to send too (Milestone 30, Phase 6).
 *
 * That is what makes the browser end-to-end suite run under the real Content Security
 * Policy: a page that loads something the policy refuses logs a console error, and the
 * link crawler fails on any console error. Not the dev server, where Vite's own client
 * needs more than production allows.
 */
function productionHeaders(): Record<string, string> {
  const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as VercelConfig
  const everyPage = vercel.headers?.find((rule) => rule.source === '/(.*)')
  return Object.fromEntries((everyPage?.headers ?? []).map(({ key, value }) => [key, value]))
}

export default defineConfig({
  // `seo()`: the title, share tags and structured data in index.html, and the generated
  // robots.txt, sitemap.xml and manifest.json (Milestone 30, Phase 6 — see vite.seo.ts).
  // `prerender()`: the homepage drawn into index.html at build time, and app.html for
  // every other route (see vite.prerender.ts).
  plugins: [react(), seo(), prerender()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: productionHeaders(),
  },
})
