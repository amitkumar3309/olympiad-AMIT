/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { resetBackend, seedQuiz, signIn } from './fixtures.ts'

/**
 * What a reader meets when something fails (Milestone 30, Phase 6 — brief §10, "Reliability"),
 * at desktop width and at 390px:
 *
 *  - a page whose file cannot be downloaded — what a tab opened before a deploy meets — shows
 *    the crash page with "Reload the page", never a blank screen, and reloading recovers;
 *  - a session check that fails once at page load is tried again, so a signed-in student on a
 *    weak connection stays on their own page rather than being sent to sign in (audit D17).
 */

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
  await seedQuiz(request)
})

test('a page that cannot be downloaded shows the reload page, and reloading recovers', async ({ page }) => {
  await page.goto('/')
  // The leaderboard is a separate file (`lazy()`); refuse it, as a deploy that replaced it would.
  await page.route('**/assets/Leaderboard-*.js', (route) => route.abort())
  await page.evaluate(() => {
    window.history.pushState({}, '', '/leaderboard')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  await expect(page.getByRole('heading', { level: 1, name: 'A new version of the site is ready' })).toBeVisible()

  // Moving to another page clears it — back to the homepage, which renders as normal — and the
  // broken page, opened again, still says so.
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: /Olympiad/ })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { level: 1, name: 'A new version of the site is ready' })).toBeVisible()

  const reload = page.getByRole('button', { name: 'Reload the page' })
  await expect(reload).toBeVisible()

  await page.unroute('**/assets/Leaderboard-*.js')
  await reload.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeVisible()
})

test('a session check that fails once is retried, not read as signed out', async ({ page }) => {
  await signIn(page)
  let refused = 0
  await page.route('**/api/v1/auth/session', async (route) => {
    if (refused === 0) {
      refused += 1
      await route.abort('internetdisconnected')
      return
    }
    await route.continue()
  })

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  expect(refused).toBe(1)
  expect(new URL(page.url()).pathname).toBe('/dashboard')
})
