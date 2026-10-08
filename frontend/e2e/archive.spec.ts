/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { advanceDays, BACKEND, expectAccessible, resetBackend, seedQuiz, waitForApp } from './fixtures.ts'

/**
 * Milestone 30 Phase 7 — the public archive of past Daily Quizzes (`/daily-quiz/archive`).
 * The link crawler visits the page at both widths as a guest; this checks what it shows.
 */

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

test('the archive lists a quiz only once its answer has unlocked, with the answer behind a disclosure', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The crawler covers the page at 390px.')
  await seedQuiz(request)
  // Today's quiz is the prize question: not in the archive, whatever `before` says.
  for (const query of ['?group=9-12', '?group=9-12&before=2099-12-31']) {
    const res = await request.get(`${BACKEND}/api/v1/daily-quiz/archive${query}`)
    expect((await res.json()).problems).toEqual([])
  }

  await advanceDays(request, 1)
  await page.goto('/daily-quiz/archive')
  await waitForApp(page)
  await expect(page.locator('h1')).toHaveText('Past Daily Quizzes')
  await page.getByRole('button', { name: 'Classes 9–12' }).click()
  const problem = page.getByRole('article')
  await expect(problem).toHaveCount(1)
  await expect(problem.getByText('What is the value of')).toBeVisible()
  // The answer waits behind "Show the answer", so a reader can try first.
  await expect(problem.getByText(/^Answer [A-D]$/)).toBeHidden()
  await problem.getByText('Show the answer').click()
  await expect(problem.getByText(/^Answer [A-D]$/)).toBeVisible()
  await expect(problem.getByText('Solution', { exact: true })).toBeVisible()
  await expectAccessible(page, 'the archive with an answer open')
})
