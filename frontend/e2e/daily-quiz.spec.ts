import { expect } from '@playwright/test'
import { advanceDays, expectAccessible, resetBackend, seedQuiz, signIn, test } from './fixtures.ts'

/**
 * The Daily Quiz, end to end (brief §6.8): start → submit → result → profile history shows the
 * attempt with the answer locked → the server clock moves to the next day → the solution is
 * visible. Runs at desktop width and at 390px (`playwright.config.ts`).
 */

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

test('a student plays today’s quiz, and its solution unlocks the next day', async ({ page, request }) => {
  const { correctOptionText } = await seedQuiz(request)
  await signIn(page)

  // Not started: the facts, and no question yet.
  await page.goto('/daily-quiz')
  await expect(page.getByRole('heading', { name: 'Today’s question is ready' })).toBeVisible()
  await expect(page.getByText('One attempt only')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)

  // In progress: the question, four options, a running timer.
  await page.getByRole('button', { name: 'Start the quiz' }).click()
  await expect(page.getByRole('radio')).toHaveCount(4)
  await expect(page.getByRole('timer', { name: 'Time since you pressed Start' })).toBeVisible()
  await expectAccessible(page, 'the quiz in progress')
  const submit = page.getByRole('button', { name: 'Submit answer' })
  await expect(submit).toBeDisabled()

  // Choose the right answer, confirm, and see the result.
  await page.locator('label').filter({ has: page.getByRole('radio', { name: correctOptionText, exact: true }) }).click()
  await expect(submit).toBeEnabled()
  await submit.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('You get one attempt.')
  await expectAccessible(page, 'the confirm dialog')
  await dialog.getByRole('button', { name: /^Submit option/ }).click()
  await expect(page.getByRole('heading', { name: 'Correct!' })).toBeVisible()
  await expectAccessible(page, 'the result')
  await expect(page.getByText('+20 XP', { exact: false })).toBeVisible()
  await expect(page.getByRole('timer', { name: 'Time until the answer unlocks' })).toBeVisible()

  // A reload keeps the submitted state: the answer is on the server, not in the page.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Correct!' })).toBeVisible()

  // History: the attempt is there, and its answer is locked.
  await page.goto('/profile#daily-quiz-history')
  const history = page.locator('#daily-quiz-history')
  await expect(history.getByText('Answer and solution unlock tomorrow at 12:00 AM.')).toBeVisible()
  await expect(history.getByText('View solution')).toHaveCount(0)

  // The next day: the correct answer and the worked solution are there.
  await advanceDays(request, 1)
  await page.reload()
  await history.getByText('View solution').click()
  const solution = history.locator('details[open]')
  await expect(solution.getByText('Correct answer:')).toBeVisible()
  await expect(solution).toContainText('32')
  // The worked solution is rendered maths, not raw LaTeX.
  await expect(solution.locator('.katex').first()).toBeVisible()
})

test('a second submission never changes the first', async ({ page, request }) => {
  await seedQuiz(request)
  await signIn(page)

  await page.goto('/daily-quiz')
  await page.getByRole('button', { name: 'Start the quiz' }).click()
  // A wrong answer this time.
  await page.locator('label').filter({ has: page.getByRole('radio', { name: '16', exact: true }) }).click()
  await page.getByRole('button', { name: 'Submit answer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Submit option/ }).click()
  await expect(page.getByRole('heading', { name: 'Not this time' })).toBeVisible()

  // The API refuses to re-mark it, whatever is sent.
  const replay = await page.evaluate(async () => {
    const res = await fetch('/api/v1/me/daily-quiz/submit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedOptionId: 'o0000000000' }),
    })
    return (await res.json()) as { alreadySubmitted?: boolean; result?: { isCorrect: boolean | null } }
  })
  expect(replay.alreadySubmitted).toBe(true)
  expect(replay.result?.isCorrect).toBe(false)
})
