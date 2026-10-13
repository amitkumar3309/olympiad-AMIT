import { expect } from '@playwright/test'
import { BACKEND, E2E_ADMIN, expectAccessible, fillSignIn, resetBackend, waitForApp, test } from './fixtures.ts'

/**
 * The Contact page's form (owner, 2026-10-13): a visitor is told what is missing, sends a
 * message, and the administrator reads it at Admin → Messages and marks it handled.
 */
test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

test('a visitor sends a message from the Contact page, and staff read it in Messages', async ({ page, request }, testInfo) => {
  await page.goto('/contact')
  await expect(page.getByRole('heading', { level: 2, name: 'Send us a message' })).toBeVisible()

  // Every problem at once, on its field.
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Tell us your name.')).toBeVisible()
  await expect(page.getByText('Enter an email address we can reply to.')).toBeVisible()
  await expect(page.getByText('Choose what your message is about.')).toBeVisible()
  await expect(page.getByText(/at least 10 characters/)).toBeVisible()

  await page.getByLabel('Your name').fill('Meera Iyer')
  await page.getByLabel('Your email').fill('meera.parent@example.com')
  await page.getByLabel('What is it about?').selectOption('payment')
  await page.getByLabel('Your message').fill('My payment went through but the dashboard still says unpaid.')
  await expectAccessible(page, 'the contact form, filled in')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Message sent')).toBeVisible()
  await expect(page.getByText(/reached us/)).toBeVisible()

  if (testInfo.project.name !== 'desktop') return
  const provisioned = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
  expect(provisioned.ok()).toBe(true)
  await page.goto('/')
  await waitForApp(page)
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await fillSignIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.waitForURL('**/admin', { timeout: 30_000 })

  await page.goto('/admin/messages')
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Meera Iyer' })).toBeVisible()
  await expect(page.getByText('My payment went through but the dashboard still says unpaid.')).toBeVisible()
  await expectAccessible(page, 'Admin → Messages')
  await page.getByRole('button', { name: 'Mark handled' }).click()
  await expect(page.getByText('Nothing to answer')).toBeVisible()
})
