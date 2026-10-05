import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { build, type Plugin, type ResolvedConfig } from 'vite'

/**
 * The homepage drawn into `index.html` at build time (Milestone 30, Phase 6 — brief §10,
 * "LCP ≤ 2.5 s").
 *
 * Until this, every page arrived as an empty `<div id="root">` and nothing could be painted
 * until the browser had downloaded and run React and the app. On a phone on a slow
 * connection that put the homepage's heading at 3.3 s. Now `vite build` also renders `/` —
 * `src/prerender.tsx`, the same tree the browser renders — and writes the HTML into the root,
 * so the heading paints when the HTML and the stylesheets arrive.
 *
 * Two pages come out of a build:
 *
 *  - **`index.html`** — the drawn homepage. Vercel serves it for `/` only (vercel.json names it,
 *    and a file wins over a rewrite anyway). Its app script is not in its HTML: the script and
 *    its preloads move onto `public/boot.js`'s tag, which adds them once the first frame has
 *    been drawn — 120 KB of script downloading beside the stylesheets is what the first paint
 *    waited behind on a slow phone, and the drawn page needs none of it to be read.
 *  - **`app.html`** — the empty shell, exactly as `index.html` was. `vercel.json`'s fallback
 *    rewrite serves it for every other route, so `/dashboard` never shows the homepage first.
 *    `vite preview` does the same here (`configurePreviewServer`), so the browser suite runs
 *    against what Vercel serves.
 *
 * React does **not** hydrate the drawn page; `src/main.tsx` renders over it. Hydrating would
 * oblige the HTML to match the first client render exactly — and a mismatch in an attribute
 * is not repaired in a production build, so a `?ref=` on the Register link (read from the URL,
 * which a build cannot know) would silently be dropped. Rendering over it has no such case.
 *
 * The build fails, rather than shipping a broken first paint, if the rendered page has no hero
 * heading, more or fewer than one `h1`, or a CSS-module class the stylesheets do not define.
 */

/** The page every route except `/` is served — vercel.json's fallback rewrite names it. */
export const APP_SHELL = 'app.html'

const ENTRY = 'src/prerender.tsx'
const EMPTY_ROOT = '<div id="root"></div>'
/** public/boot.js, as index.html loads it. */
const BOOT_TAG = '<script src="/boot.js"></script>'
const MODULE_SCRIPT = /<script type="module" crossorigin src="([^"]+)"><\/script>/g
const MODULE_PRELOAD = /<link rel="modulepreload" crossorigin href="([^"]+)">/g

/**
 * The drawn page loads the app after its first paint, not beside it: the module script and
 * its preloads move from the HTML onto boot.js's tag, which adds them once a frame has been
 * drawn (see public/boot.js). The stylesheets stay — the drawn page needs them to paint.
 */
function startAppAfterPaint(html: string): string {
  const scripts = [...html.matchAll(MODULE_SCRIPT)]
  if (scripts.length !== 1) throw new Error(`prerender: expected one module script in index.html, found ${scripts.length}`)
  if (!html.includes(BOOT_TAG)) throw new Error(`prerender: ${BOOT_TAG} not found in index.html`)
  const preloads = [...html.matchAll(MODULE_PRELOAD)].map((match) => match[1]!)
  const bootTag = `<script src="/boot.js" data-entry="${scripts[0]![1]}" data-preload="${preloads.join(' ')}"></script>`
  return html.replace(MODULE_SCRIPT, '').replace(MODULE_PRELOAD, '').replace(BOOT_TAG, bootTag)
}

/** A CSS-module class as this build names them: `_hero_ojpae_11`. */
const MODULE_CLASS = /^_[A-Za-z][\w-]*_[a-z0-9]{5}_\d+$/

function cssOf(outDir: string): string {
  const assets = join(outDir, 'assets')
  return readdirSync(assets)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(assets, name), 'utf8'))
    .join('\n')
}

/** What is wrong with the drawn page, if anything. */
function problemsWith(page: string, css: string): string[] {
  const problems: string[] = []
  if (!page.includes('id="hero-title"')) problems.push('no hero heading (#hero-title) — did the homepage render?')
  const headings = page.match(/<h1[\s>]/g)?.length ?? 0
  if (headings !== 1) problems.push(`${headings} h1 elements — a page has exactly one`)
  const classes = new Set(
    [...page.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/)).filter((name) => MODULE_CLASS.test(name)),
  )
  const missing = [...classes].filter((name) => !css.includes(`.${name}`))
  if (missing.length > 0) problems.push(`CSS-module classes no stylesheet defines: ${missing.slice(0, 8).join(', ')}`)
  return problems
}

export function prerender(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'amit-prerender',
    // The client build (not the nested Node build below), and `vite preview`.
    apply: (_config, env) => env.isPreview === true || (env.command === 'build' && !env.isSsrBuild),
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      if (config.command !== 'build') return
      const outDir = resolve(config.root, config.build.outDir)
      const indexPath = join(outDir, 'index.html')
      const shell = readFileSync(indexPath, 'utf8')
      if (!shell.includes(EMPTY_ROOT)) throw new Error(`prerender: ${EMPTY_ROOT} not found in ${indexPath}`)

      // The same app built for Node, in a fresh temporary directory, its dependencies bundled in
      // so it needs no node_modules beside it. No config file, so this plugin is not loaded twice.
      const serverOut = mkdtempSync(join(tmpdir(), 'amit-prerender-'))
      await build({
        configFile: false,
        root: config.root,
        mode: config.mode,
        logLevel: 'warn',
        plugins: [react()],
        ssr: { noExternal: true },
        build: {
          ssr: ENTRY,
          outDir: serverOut,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          rollupOptions: { output: { entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' } },
        },
      })
      const entry = readdirSync(serverOut).find((name) => name === 'prerender.mjs')
      if (!entry) throw new Error(`prerender: the Node build of ${ENTRY} wrote no prerender.mjs`)
      const { renderHome } = (await import(`${pathToFileURL(join(serverOut, entry)).href}?t=${Date.now()}`)) as {
        renderHome: () => string
      }
      const page = renderHome()

      const problems = problemsWith(page, cssOf(outDir))
      if (problems.length > 0) throw new Error(`prerender: the drawn homepage is not fit to ship:\n  - ${problems.join('\n  - ')}`)

      writeFileSync(join(outDir, APP_SHELL), shell)
      writeFileSync(indexPath, startAppAfterPaint(shell).replace(EMPTY_ROOT, `<div id="root">${page}</div>`))
      rmSync(serverOut, { recursive: true, force: true })
      config.logger.info(`prerender: / drawn into index.html (${(page.length / 1024).toFixed(1)} KiB); every other route gets ${APP_SHELL}`)
    },
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir)
      // Mirror vercel.json: a page route other than `/` that is not a file gets the shell.
      server.middlewares.use((req, _res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!.split('#')[0]!)
        const wantsPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
        const file = join(outDir, path)
        const isFile = existsSync(file) && statSync(file).isFile()
        if (wantsPage && path !== '/' && path !== '/index.html' && !path.startsWith('/api/') && !isFile) {
          req.url = `/${APP_SHELL}`
        }
        next()
      })
    },
  }
}
