/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { BACKEND, E2E_ADMIN, expectAccessible, fillSignIn, resetBackend, waitForApp } from './fixtures.ts'

/**
 * The monthly winners (owner, 2026-10-09 — PLAN.md Q24): one winner a month in each class band.
 * The ranking, the refusals and the announcement are the backend's tests (`dailyQuiz.test.ts`);
 * this is the browser pass a new admin page needs — the tab, its four bands, and a month that has
 * not ended offering nothing to work out yet, saying why in the page.
 */

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

test('the monthly winners tab shows the four class bands and waits, in words, for the month to end', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'An admin page: checked once, at desktop width.')
  // The root administrator is provisioned by its first sign-in at /auth/admin/login (as the crawler does).
  const provisioned = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
  expect(provisioned.ok()).toBe(true)
  await page.goto('/')
  await waitForApp(page)
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await fillSignIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.waitForURL('**/admin', { timeout: 30_000 })

  // The server's clock is today's, before the first prize month has ended: November is shown, open.
  await page.goto('/admin/daily-quiz?tab=monthly')
  const panel = page.getByRole('tabpanel', { name: 'Monthly winners' })
  await expect(panel.getByRole('heading', { level: 2, name: 'Monthly winners — November 2026' })).toBeVisible()
  await expect(panel.getByText('November 2026 is not over yet')).toBeVisible()
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Classes 3–5', 'Classes 6–8', 'Classes 9–10', 'Classes 11–12'])
  await expect(panel.getByRole('button', { name: /Work out/ })).toHaveCount(0)
  await expect(panel.getByText('Answers count from Sun, 8 Nov 2026, the launch.')).toBeVisible()
  await expectAccessible(page, 'the monthly winners tab')
})
