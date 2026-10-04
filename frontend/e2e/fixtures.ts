import type { APIRequestContext, Page } from '@playwright/test'

/**
 * Shared facts for the end-to-end suite. The student below is a **test account on a throwaway
 * in-memory database** (`backend/scripts/e2e-server.ts`): it exists only while the suite runs,
 * and the `/__e2e/*` hooks that create it refuse any database not named `*-e2e`.
 */

export const BACKEND_PORT = 8092
export const FRONTEND_PORT = 5181
export const BACKEND = `http://localhost:${BACKEND_PORT}`

export const E2E_STUDENT = {
  email: 'e2e.student@amit.test',
  mobile: '9000000123',
  password: 'E2e-Quiz-Student-9',
  firstName: 'Esha',
  lastName: 'Tester',
  classLevel: 'Class 9',
} as const

/** Empties the database and puts the server clock back. */
export async function resetBackend(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/__e2e/reset`)
  if (!res.ok()) throw new Error(`E2E reset failed: ${res.status()} ${await res.text()}`)
}

/** One verified Class 9 student and today's quiz for Classes 9–12 (2⁵ = 32). */
export async function seedQuiz(request: APIRequestContext): Promise<{ correctOptionText: string }> {
  const res = await request.post(`${BACKEND}/__e2e/seed`, {
    data: { student: E2E_STUDENT, quiz: { classMin: 9, classMax: 12 } },
  })
  if (!res.ok()) throw new Error(`E2E seed failed: ${res.status()} ${await res.text()}`)
  const body = (await res.json()) as { quiz: { correctOptionText: string } }
  return { correctOptionText: body.quiz.correctOptionText }
}

/** Moves the server's quiz clock forward by whole days. Sessions are unaffected. */
export async function advanceDays(request: APIRequestContext, days: number): Promise<void> {
  const res = await request.post(`${BACKEND}/__e2e/clock`, { data: { advanceDays: days } })
  if (!res.ok()) throw new Error(`E2E clock failed: ${res.status()} ${await res.text()}`)
}

/** Signs the seeded student in through the one sign-in dialog, opened as a visitor opens it. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Mobile number or email').fill(E2E_STUDENT.email)
  await dialog.locator('input[type="password"]').fill(E2E_STUDENT.password)
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/dashboard')
}
