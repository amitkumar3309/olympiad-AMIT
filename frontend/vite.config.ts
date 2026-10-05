import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seo } from './vite.seo.ts'

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

export default defineConfig({
  // `seo()`: the title, share tags and structured data in index.html, and the generated
  // robots.txt, sitemap.xml and manifest.json (Milestone 30, Phase 6 — see vite.seo.ts).
  plugins: [react(), seo()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
