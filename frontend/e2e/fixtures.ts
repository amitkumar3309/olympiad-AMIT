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

/**
 * The suite's root administrator — test values for the throwaway database, handed to the
 * e2e backend by `playwright.config.ts` (it hashes the password at start-up).
 */
export const E2E_ADMIN = {
  email: 'e2e-admin@amit.test',
  password: 'E2e-Admin-Pass-9',
} as const

/** Empties the database and puts the server clock back. */
export async function resetBackend(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/__e2e/reset`)
  if (!res.ok()) throw new Error(`E2E reset failed: ${res.status()} ${await res.text()}`)
}

/**
 * Empties the server's rate limiters and nothing else. The link crawler calls it before each
 * page — one browser following every link makes far more requests than a person, and the
 * general limiter would otherwise refuse the second half of the crawl.
 */
export async function resetRateLimits(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${BACKEND}/__e2e/rate-limits/reset`)
  if (!res.ok()) throw new Error(`E2E rate-limit reset failed: ${res.status()} ${await res.text()}`)
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

/**
 * Signs the seeded student in through the one sign-in dialog, opened as a visitor opens it —
 * the homepage's "I already have an account", which is a button at every width (the header's
 * Sign in is inside the menu on a phone).
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await fillSignIn(page, E2E_STUDENT.email, E2E_STUDENT.password)
  await page.waitForURL('**/dashboard')
}

/** Fills and submits the open sign-in dialog. */
export async function fillSignIn(page: Page, identifier: string, password: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Sign in' })
  await dialog.getByLabel('Mobile number or email').fill(identifier)
  await dialog.locator('input[type="password"]').fill(password)
  await dialog.getByRole('button', { name: 'Sign in' }).click()
}

/** The link in the newest verification email to `to` — what a real inbox would receive. */
export async function lastVerificationLink(request: APIRequestContext, to: string): Promise<string> {
  const res = await request.get(`${BACKEND}/__e2e/last-link?to=${encodeURIComponent(to)}`)
  if (!res.ok()) throw new Error(`E2E last-link failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as { link: string }).link
}

/** A 1×1 JPEG, for the registration photograph — the server checks the bytes, not the name. */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)
