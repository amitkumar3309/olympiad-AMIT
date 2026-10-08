/// <reference lib="dom" />
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { resetBackend, seedQuiz, waitForApp } from './fixtures.ts'

/**
 * The homepage arrives drawn (Milestone 30, Phase 6 — `vite.prerender.ts`, `public/boot.js`):
 *
 *  - it can be read before the app's script has run, already in the reader's theme;
 *  - the app then takes it over, and a keyboard reader keeps their place;
 *  - every other route arrives as the empty shell, never as a copy of the homepage — here
 *    from `vite preview`, which serves what `vercel.json` makes Vercel serve.
 *
 * Desktop width only: none of this depends on the layout.
 */

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The drawn page is checked once, at desktop width.')
  await resetBackend(request)
  await seedQuiz(request)
})

/** Keeps the app's script from running, so whatever is on screen is the HTML alone. */
async function withoutTheApp(page: Page) {
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort())
}

test('the homepage can be read before the app has run, in the theme the device asks for', async ({ page }) => {
  await withoutTheApp(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /A\.M\.I\.T\. Olympiad/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Register for free' })).toHaveAttribute('href', '/register')
  // boot.js, not React, applied the dark theme: the app never ran.
  expect(await page.evaluate(() => document.documentElement.classList.contains('theme-dark'))).toBe(true)
  // The dark page token, as the minified stylesheet spells it.
  expect(['#000', '#000000']).toContain(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()))
  expect(await page.evaluate(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__react')))).toBe(false)
})

test('a stored choice of theme wins over the device before the app has run', async ({ page }) => {
  await withoutTheApp(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => window.localStorage.setItem('amit-theme', 'light'))
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.classList.contains('theme-dark'))).toBe(false)

  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => window.localStorage.setItem('amit-theme', 'dark'))
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.classList.contains('theme-dark'))).toBe(true)
})

test('the app takes over the drawn homepage, and a keyboard reader keeps their place', async ({ page }) => {
  // Hold the app back until the reader has tabbed into the drawn page, then let it in.
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Skip to content')

  release()
  // The live page: one heading, the focus where the reader left it, and a control that answers.
  await waitForApp(page)
  await expect(page.locator('h1')).toHaveCount(1)
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Skip to content')

  await page.getByRole('button', { name: 'I already have an account' }).click()
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible()
})

test('only the homepage is drawn: every other route arrives as the empty shell', async ({ request }) => {
  const home = await (await request.get('/', { headers: { accept: 'text/html' } })).text()
  expect(home).toContain('id="hero-title"')
  // The app starts after the first paint: its script is on boot.js's tag, not in the HTML.
  expect(home).toMatch(/<script src="\/boot\.js" data-entry="\/assets\/index-[^"]+\.js"/)
  expect(home).not.toContain('<script type="module"')

  for (const path of ['/leaderboard', '/dashboard', '/register?ref=ABC123', '/no-such-page']) {
    const html = await (await request.get(path, { headers: { accept: 'text/html' } })).text()
    expect(html, path).toContain('<div id="root"></div>')
    expect(html, path).not.toContain('hero-title')
    expect(html, path).toContain('<script type="module"')
  }

  // And what Vercel is told: `/` is the drawn page, everything else the shell.
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    rewrites: Array<{ source: string; destination: string }>
  }
  expect(vercel.rewrites).toContainEqual({ source: '/', destination: '/index.html' })
  expect(vercel.rewrites.at(-1)).toEqual({ source: '/(.*)', destination: '/app.html' })
})
