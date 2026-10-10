import { expect } from '@playwright/test'
import { BACKEND, E2E_ADMIN, fillSignIn, resetBackend, waitForApp, test } from './fixtures.ts'

/**
 * Staff have no student area (owner, 2026-10-10): an administrator sees the admin panel, never a
 * student menu, dashboard or profile, and changes their password on Admin → My account.
 */
test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

test('an administrator has no student area: no account menu, student pages lead to the admin panel', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Once, at desktop width.')
  // Provisioned the way the root administrator first is (see crawler.spec.ts).
  const provisioned = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
  expect(provisioned.ok()).toBe(true)

  await page.goto('/')
  await waitForApp(page)
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await fillSignIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.waitForURL('**/admin', { timeout: 30_000 })

  // The homepage: the admin panel and Sign out — no student menu, no quiz button.
  await page.goto('/')
  await waitForApp(page)
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: 'Admin' })).toBeVisible()
  await expect(header.getByRole('button', { name: /^Account menu/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Go to the admin panel' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toHaveCount(0)

  // Every student page sends staff to the admin panel.
  for (const path of ['/dashboard', '/profile', '/practice', '/daily-quiz']) {
    await page.goto(path)
    await page.waitForURL('**/admin', { timeout: 15_000 })
  }

  // Their own account page instead of a profile.
  await page.goto('/admin/account')
  await expect(page.getByRole('heading', { level: 1, name: 'My account' })).toBeVisible()
  await expect(page.getByText(E2E_ADMIN.email)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin-account.png'), fullPage: true })
})
