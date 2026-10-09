import { AxeBuilder } from '@axe-core/playwright'
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Shared facts for the end-to-end suite. The student below is a **test account on a throwaway
 * in-memory database** (`backend/scripts/e2e-server.ts`): it exists only while the suite runs,
 * and the `/__e2e/*` hooks that create it refuse any database not named `*-e2e`.
 */

/**
 * The suite's `test`: **every page is the everyday site** unless a test asks for a festive edition
 * (2026-10-09). An edition's dates — and a trial of one on the live site — are read by
 * `public/boot.js` from the real clock, so a test that quietly assumed an ordinary day failed on the
 * days one was on (the 24-hour trial broke four). This opens every page with `?season=off`'s own
 * switch already set for the tab, which boot.js honours before the first paint. A test of the
 * edition itself says `test.use({ everyday: false })` and pins its own date with `page.clock`.
 */
export const test = base.extend<{ everyday: boolean }>({
  everyday: [true, { option: true }],
  page: async ({ page, everyday }, use) => {
    if (everyday) {
      await page.addInitScript(() => {
        try {
          window.sessionStorage.setItem('amit-season', 'off')
        } catch {
          // Storage blocked: the dates decide, as they do for a visitor.
        }
      })
    }
    await use(page)
  },
})

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

/**
 * Every serious or critical WCAG 2.1 A/AA violation axe finds in what is on screen now
 * (Milestone 30, Phase 6 — brief §10: "zero serious or critical violations"), one line each.
 */
export async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => {
      const where = violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join(', ')
      return `axe ${violation.impact}: ${violation.id} — ${violation.help} (${violation.nodes.length}× e.g. ${where})`
    })
}

/** Fails the test on any serious or critical violation in the state the page is in. */
export async function expectAccessible(page: Page, state: string): Promise<void> {
  expect(await seriousViolations(page), `accessibility of ${state}`).toEqual([])
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
/**
 * Waits for the app to own the page (Milestone 30, Phase 6). The homepage arrives drawn
 * (vite.prerender.ts) and the app replaces it a moment later: until then a button in it looks
 * right and does nothing, and an element found in it is detached when the app arrives. Every
 * other route arrives empty, so there this returns as soon as the app has drawn anything.
 *
 * React marks every node it creates with a `__reactFiber…` key; the drawn page has none.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const first = document.getElementById('root')?.firstElementChild
    return first != null && Object.keys(first).some((key) => key.startsWith('__reactFiber'))
  })
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  await waitForApp(page)
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
