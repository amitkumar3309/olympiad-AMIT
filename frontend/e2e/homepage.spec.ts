/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test'
import { BACKEND, E2E_STUDENT, TINY_JPEG, advanceDays, expectAccessible, fillSignIn, lastVerificationLink, resetBackend, seedQuiz, waitForApp, test } from './fixtures.ts'

/**
 * The homepage's way into the Daily Quiz (Milestone 30, Phase 3 — brief §7.3), end to end, at
 * desktop width and at 390px:
 *
 *  - a guest presses the floating button, meets the Login Gate, signs in, and lands on the quiz;
 *  - a new student goes gate → "Create free account" → registers → opens the link in their
 *    verification email → signs in → lands on the quiz, the destination kept the whole way;
 *  - a guest who opens a signed-in page is asked to sign in and taken back to it (D2);
 *  - "Can you crack this?" is a real Daily Quiz problem once its answer is public, never today's.
 *
 * Reduced motion is on so the floating button holds still — its idle float would otherwise keep
 * it from ever being "stable" enough to click — which also exercises the reduced-motion styles.
 */

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

async function openGateFromFab(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /winners get a surprise gift and cash/ }).click()
  const gate = page.getByRole('dialog', { name: 'Log in to play today’s Daily Quiz' })
  await expect(gate).toBeVisible()
  return gate
}

test('a guest goes from the floating button through the Login Gate to today’s quiz', async ({ page, request }) => {
  await seedQuiz(request)
  const gate = await openGateFromFab(page)

  // The prize line is the owner's setting, not text typed into the page.
  await expect(gate).toContainText('Every month, the top scorer in each class band wins:')
  await expect(gate.getByRole('link', { name: 'How rewards work' })).toHaveAttribute('href', '/rewards/rules')
  await expectAccessible(page, 'the Login Gate')

  await gate.getByRole('button', { name: 'Sign in' }).click()
  await fillSignIn(page, E2E_STUDENT.email, E2E_STUDENT.password)

  await page.waitForURL('**/daily-quiz')
  await expect(page.getByRole('heading', { name: 'Today’s question is ready' })).toBeVisible()
})

test('a new student registers from the gate, verifies, and lands on the quiz', async ({ page, request }) => {
  await seedQuiz(request)
  const gate = await openGateFromFab(page)
  await gate.getByRole('link', { name: 'Create free account' }).click()
  await page.waitForURL('**/register?next=%2Fdaily-quiz')

  const email = 'new.student@amit.test'
  const password = 'New-Student-Pass-9'
  await page.getByLabel('First name').fill('Nisha')
  await page.getByLabel('Last name').fill('Verma')
  await page.getByLabel("Father's name").fill('Rakesh Verma')
  await page.getByLabel("Mother's name").fill('Sunita Verma')
  await page.getByLabel('Date of birth').fill('2011-06-15')
  await page.getByLabel('Class', { exact: false }).first().selectOption('Class 9')
  await page.getByLabel('Current school').fill('Springfield Public School')
  await page.getByLabel('Full address').fill('12 Example Road, Jaipur, Rajasthan 302001')
  await page.getByLabel('Mobile number').fill('9000000456')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel(/^Password/).fill(password)
  await page.getByLabel(/^Confirm password/).fill(password)
  await page.locator('input[type="file"]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG })
  await page.getByLabel("Parent or guardian's phone").fill('9000000999')
  await expectAccessible(page, 'the registration form')

  // A parent or guardian's agreement is required (Phase 6), and the form says so on the box.
  await page.getByRole('button', { name: 'Review and continue' }).click()
  const consent = page.getByRole('checkbox', { name: /I am the parent\/guardian, or I have my parent\/guardian’s permission/ })
  await expect(consent).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('#reg-guardianConsent-error')).toContainText('A parent or guardian has to agree')
  await expectAccessible(page, 'the registration form with a missing agreement')
  await consent.check()

  await page.getByRole('button', { name: 'Review and continue' }).click()
  await expectAccessible(page, 'the registration review')
  await page.getByRole('button', { name: 'Create my account' }).click()
  await expect(page.getByRole('heading', { name: /Check your email/ })).toBeVisible()

  // The link in the email carries the destination.
  const link = await lastVerificationLink(request, email)
  expect(link).toContain('next=%2Fdaily-quiz')

  await page.goto(link)
  await page.getByRole('button', { name: 'Sign in to play today’s Daily Quiz' }).click()
  await fillSignIn(page, email, password)

  await page.waitForURL('**/daily-quiz')
  await expect(page.getByRole('heading', { name: 'Today’s question is ready' })).toBeVisible()
})

test('a guest opening a signed-in page is asked to sign in, then taken back to it', async ({ page, request }) => {
  await seedQuiz(request)
  await page.goto('/practice')

  // Not a bare homepage: the sign-in dialog, with the page kept as ?next=.
  await expect(page).toHaveURL(/\/\?next=%2Fpractice#login$/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectAccessible(page, 'the sign-in dialog')
  await fillSignIn(page, E2E_STUDENT.email, E2E_STUDENT.password)
  await page.waitForURL('**/practice')
})

test('“Can you crack this?” is a real Daily Quiz problem once its answer is public — never today’s', async ({ page, request }) => {
  await seedQuiz(request)

  // While the quiz is live it is a prize question, and the homepage's source does not have it.
  // Asked of the API rather than the page, so the browser never caches the empty answer.
  const live = await request.get(`${BACKEND}/api/v1/daily-quiz/past`)
  expect(live.ok()).toBe(true)
  expect(JSON.stringify(await live.json())).not.toContain('What is the value of')

  // The next day its answer is public, and it is the problem on the homepage — marked at once.
  await advanceDays(request, 1)
  await page.goto('/')
  await waitForApp(page)
  // The section loads as the reader nears it (Phase 6), so scroll to where it sits.
  await page.locator('#crack').scrollIntoViewIfNeeded()
  const card = page.getByRole('region', { name: 'Can you crack this?' })
  await expect(card).toContainText('What is the value of')
  await expect(card).toContainText('Classes 9–12')
  await card.locator('label').filter({ has: page.getByRole('radio', { name: '32', exact: true }) }).click()
  await card.getByRole('button', { name: 'Submit answer' }).click()
  await expect(card).toContainText('Correct — well cracked!')
  await expect(card).toContainText('Solution')
  await expect(card.getByRole('button', { name: 'Play today’s Daily Quiz and win prizes' })).toBeVisible()
})

test('the homepage renders every section without scrolling sideways', async ({ page }) => {
  await page.goto('/')
  for (const heading of ['Can you crack this?', 'Four ways to prepare, all of them free', 'From registering to being ranked', 'Top Scholars', 'Before you register', 'Ready to sit the paper?']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }
  // Nothing has been revealed on an empty database: the section says so instead of inventing a question.
  await expect(page.getByText('the first is on its way')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
