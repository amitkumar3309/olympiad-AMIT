import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The development proxy for `/api` (production rewrites it in `vercel.json`).
 *
 * `API_PROXY_TARGET` overrides the default backend address, so two checkouts — the main
 * one and a worktree — can each run their own backend on their own port without one
 * of them taking the other's. Development only: this file plays no part in a build's
 * output.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8081'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
