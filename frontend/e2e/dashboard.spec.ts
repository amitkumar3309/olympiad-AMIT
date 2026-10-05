/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { resetBackend, seedQuiz, signIn } from './fixtures.ts'

/**
 * The student dashboard and its chrome (Milestone 30, Phase 4 — brief §8), at desktop width and
 * at 390px:
 *
 *  - every widget renders from the student's real data — the five figures, today's quiz, the
 *    journey, today's class board with their own row, the achievements — the page opens at its
 *    top after signing in from the foot of the homepage, and nothing scrolls sideways;
 *  - the bell's menu says today's quiz is live and leads to it, and the account menu signs out;
 *  - below 1024px the bottom bar holds the brief's five destinations and the drawer the rest,
 *    where a "Soon" item is a label, not a link.
 *
 * Reduced motion is on so the figures do not count up while they are being read.
 */

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

test('the dashboard shows the student’s real figures, journey, class board and achievements', async ({ page, request }) => {
  await seedQuiz(request)
  const photoRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/photo')) photoRequests.push(req.url())
  })
  await signIn(page)

  await expect(page.getByRole('heading', { level: 1, name: /Welcome back, Esha!/ })).toBeVisible()
  // On a phone `signIn` presses the homepage's closing button, at the foot of the page; the
  // dashboard must still open at its top (`ScrollToTop`), not 2,000px down.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  const figures = page.getByRole('region', { name: 'Your figures' })
  for (const label of ['Total XP', 'Global rank', 'Day streak', 'Questions solved', 'Accuracy']) {
    await expect(figures.getByText(label, { exact: true })).toBeVisible()
  }
  // Today's visit is their only XP: first of one. Nothing answered yet, so no accuracy — not 0%.
  await expect(figures).toContainText('#1')
  await expect(figures).toContainText('Answer a question to see it')

  await expect(page.getByRole('heading', { name: 'Today’s Daily Quiz' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your journey' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Today’s top 5 (Class 9)' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Today’s top five in Class 9' })).toContainText('(You)')
  await expect(page.getByRole('heading', { name: 'Achievements' })).toBeVisible()

  // The seeded student has no photograph, and the app never asks for one that is missing.
  expect(photoRequests).toEqual([])

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the bell says today’s quiz is live and leads to it; the account menu signs out', async ({ page, request }) => {
  await seedQuiz(request)
  await signIn(page)

  await page.getByRole('button', { name: /^Notifications/ }).click()
  const bell = page.getByRole('menu', { name: /^Notifications/ })
  const live = bell.getByRole('menuitem', { name: /Today’s Daily Quiz is live/ })
  await expect(live).toBeVisible()
  await expect(bell.getByRole('menuitem', { name: /View all notifications/ })).toBeVisible()
  await live.click()
  await page.waitForURL('**/daily-quiz')

  await page.getByRole('button', { name: /^Account menu for Esha/ }).click()
  const account = page.getByRole('menu', { name: /^Account menu for Esha/ })
  await expect(account.getByRole('menuitem', { name: 'My Profile' })).toBeVisible()
  await expect(account.getByRole('menuitem', { name: 'Help & Support' })).toBeVisible()
  await account.getByRole('menuitem', { name: 'Log out' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByRole('button', { name: 'I already have an account' })).toBeVisible()
})

test('below 1024px the bottom bar and the drawer reach everything — a Soon item is not a link', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The phone layout.')
  await seedQuiz(request)
  await signIn(page)

  const bar = page.getByRole('navigation', { name: 'Primary' })
  for (const item of ['Home', 'Quiz', 'Practice', 'Leaderboard', 'Profile']) {
    await expect(bar.getByRole('link', { name: item })).toBeVisible()
  }

  await page.getByRole('button', { name: 'Open menu' }).click()
  const drawer = page.getByRole('dialog', { name: 'Menu' })
  await expect(drawer.getByText('Previous Papers')).toBeVisible()
  await expect(drawer.getByRole('link', { name: /Previous Papers/ })).toHaveCount(0)
  await drawer.getByRole('link', { name: 'Activity' }).click()
  await page.waitForURL('**/activity')
  await expect(page.getByRole('heading', { level: 1, name: 'Your activity' })).toBeVisible()
})
