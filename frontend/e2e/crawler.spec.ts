/// <reference lib="dom" />
import { writeFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { SUPPORT, SUPPORT_TEL_HREF } from '../src/lib/brand.ts'
import { BACKEND, E2E_ADMIN, FRONTEND_PORT, fillSignIn, resetBackend, resetRateLimits, seedQuiz, signIn } from './fixtures.ts'

/**
 * The link crawler (Milestone 30, Phase 5 — brief §9): every internal link, followed as a guest
 * from the homepage, as a student from the homepage and the dashboard, and as an administrator
 * from `/admin`, at desktop width and at 390px.
 *
 * Every page reached must
 *  - render a real page — not the 404, and for a guest a signed-in page must hand over to the
 *    sign-in dialog (`/?next=…#login`), which is the expected redirect;
 *  - log **no console error**, throw **no uncaught exception** (an unhandled rejection is one),
 *    and make **no failed or 4xx/5xx request** to this app;
 *  - carry no dead link (`href="#"`, `javascript:`) and no new-tab link without
 *    `rel="noopener noreferrer"`;
 *  - and, on the phone layout, give every button at least a 44×44px target.
 *
 * Every rendered link and button must have an accessible name, and every `tel:` and `mailto:`
 * met on the way must carry the owner's contact details.
 * Problems are collected across the whole crawl and reported together, page by page.
 */

test.use({ reducedMotion: 'reduce' })
test.setTimeout(8 * 60_000)

const ORIGIN = `http://localhost:${FRONTEND_PORT}`
/** A ceiling, not a target: the site has about sixty routes. */
const MAX_PAGES = 150

/** A same-origin page worth visiting — never an API call, a download or a test hook. */
function pagePath(href: string): string | null {
  if (!href || /^(mailto|tel):/i.test(href)) return null
  let url: URL
  try {
    url = new URL(href, ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== ORIGIN) return null
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__e2e')) return null
  // The hash only scrolls within a page this crawl visits anyway.
  return url.pathname + url.search
}

const sameOrigin = (url: string) => url.startsWith(ORIGIN)

interface Crawl {
  problems: string[]
  visited: string[]
  /** How long each page took to load and settle, in visiting order — for diagnosing a slow crawl. */
  timings: string[]
  contacts: Set<string>
}

async function crawl(page: Page, request: APIRequestContext, starts: string[], options: { touchTargets: boolean }): Promise<Crawl> {
  const errors: string[] = []
  let requests = 0
  page.on('request', () => {
    requests += 1
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console error: ${message.text().slice(0, 200)}`)
  })
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message.slice(0, 200)}`))
  page.on('requestfailed', (request) => {
    // A navigation away from a page cancels its in-flight requests — that is not a failure.
    const reason = request.failure()?.errorText ?? ''
    if (sameOrigin(request.url()) && !/ABORTED/i.test(reason)) {
      errors.push(`request failed: ${request.method()} ${request.url()} (${reason})`)
    }
  })
  page.on('response', (response) => {
    if (sameOrigin(response.url()) && response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`)
    }
  })

  const queue = [...starts]
  const seen = new Set<string>()
  const problems: string[] = []
  const timings: string[] = []
  const contacts = new Set<string>()

  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    errors.length = 0
    requests = 0
    // A fresh rate-limit budget per page: a crawl is one address making hundreds of requests,
    // which no person does. Each page still meets the limiters live.
    await resetRateLimits(request)

    const started = Date.now()
    const response = await page.goto(path)
    // Bounded: a page that keeps a connection open is still checked below, and an unbounded
    // wait let one slow page spend the whole crawl's budget.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
      /* checked below regardless */
    })
    timings.push(`${path}\t${Date.now() - started}ms\t${requests} requests`)
    // Late console errors (a rejected effect) land after the network goes quiet.
    await page.waitForTimeout(250)

    const found = [...errors]
    if (!response || response.status() >= 400) found.push(`the page itself answered ${response?.status() ?? 'nothing'}`)
    if ((await page.getByRole('heading', { level: 1, name: 'This page does not exist' }).count()) > 0) {
      found.push('rendered the 404 page — a link to a route that does not exist')
    }
    const dead = await page.locator('a[href="#"], a[href^="javascript:" i]').count()
    if (dead > 0) found.push(`${dead} dead link(s)`)
    const unsafe = await page.$$eval('a[target="_blank"]', (links) =>
      links
        .filter((a) => {
          const rel = a.getAttribute('rel') ?? ''
          return !/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)
        })
        .map((a) => a.getAttribute('href') ?? ''),
    )
    if (unsafe.length > 0) found.push(`new-tab link(s) without noopener noreferrer: ${unsafe.join(', ')}`)
    // An accessible name on every rendered control: aria-label, aria-labelledby, its text, an
    // image's alt or a title — an approximation of the browser's own computation that can miss
    // a nameless control (text inside aria-hidden still counts here) but never invents one.
    const unnamed = await page.$$eval('a[href], button, [role="button"], summary', (elements) =>
      elements
        .filter((el) => {
          const box = el.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) return false
          if (el.closest('[aria-hidden="true"], [inert]')) return false
          const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ')
            .trim()
          const alt = [...el.querySelectorAll('img[alt]')].map((img) => img.getAttribute('alt')?.trim() ?? '').join(' ').trim()
          const name = (el.getAttribute('aria-label') ?? '').trim() || labelledBy || (el.textContent ?? '').trim() || alt || (el.getAttribute('title') ?? '').trim()
          return name === ''
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    )
    if (unnamed.length > 0) found.push(`control(s) with no accessible name: ${unnamed.join(' | ')}`)
    for (const href of await page.$$eval('a[href^="tel:"], a[href^="mailto:"]', (links) => links.map((a) => a.getAttribute('href') ?? ''))) {
      contacts.add(href)
    }
    if (options.touchTargets) {
      const small = await page.$$eval('button, [role="button"], summary', (elements) =>
        elements
          .filter((el) => {
            const box = el.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) return false
            if (el.closest('[aria-hidden="true"], .sr-only, [inert]')) return false
            return box.width < 44 || box.height < 44
          })
          .map((el) => {
            const box = el.getBoundingClientRect()
            const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
            return `"${name}" ${Math.round(box.width)}×${Math.round(box.height)}`
          }),
      )
      if (small.length > 0) found.push(`button(s) under 44×44px: ${small.join('; ')}`)
    }

    if (found.length > 0) problems.push(`${path} → ${new URL(page.url()).pathname}${new URL(page.url()).hash}\n      ${found.join('\n      ')}`)

    for (const href of await page.$$eval('a[href]', (links) => links.map((a) => a.getAttribute('href') ?? ''))) {
      const next = pagePath(href)
      if (next && !seen.has(next) && !queue.includes(next)) queue.push(next)
    }
  }

  return { problems, visited: [...seen], timings, contacts }
}

/** Every page reached and how long it took, beside the test's results — what the audit's Final column rests on. */
function recordVisited(testInfo: TestInfo, { visited, timings }: Pick<Crawl, 'visited' | 'timings'>) {
  writeFileSync(testInfo.outputPath('visited.txt'), visited.join('\n') + '\n')
  writeFileSync(testInfo.outputPath('timings.txt'), timings.join('\n') + '\n')
}

function expectContactsAreTheOwners(contacts: Set<string>) {
  for (const href of contacts) {
    if (href.startsWith('tel:')) expect(href, 'every tel: link dials the helpline').toBe(SUPPORT_TEL_HREF)
    else expect(href.toLowerCase(), 'every mailto: link writes to support').toMatch(new RegExp(`^mailto:${SUPPORT.email.replace(/\./g, '\\.')}(\\?|$)`))
  }
}

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
  await seedQuiz(request)
})

test('a guest can follow every link from the homepage', async ({ page, request }, testInfo) => {
  const { problems, visited, timings, contacts } = await crawl(page, request, ['/'], { touchTargets: testInfo.project.name === 'mobile-390' })
  recordVisited(testInfo, { visited, timings })
  expect(problems, `\n${problems.join('\n')}\n`).toEqual([])
  expect(visited.length).toBeGreaterThan(15)
  expect(contacts.size).toBeGreaterThan(0)
  expectContactsAreTheOwners(contacts)
})

test('a student can follow every link from the homepage and the dashboard', async ({ page, request }, testInfo) => {
  await signIn(page)
  const { problems, visited, timings, contacts } = await crawl(page, request, ['/dashboard', '/'], { touchTargets: testInfo.project.name === 'mobile-390' })
  recordVisited(testInfo, { visited, timings })
  expect(problems, `\n${problems.join('\n')}\n`).toEqual([])
  expect(visited.length).toBeGreaterThan(25)
  expectContactsAreTheOwners(contacts)
})

test('an administrator can follow every link from the admin dashboard', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The admin crawl runs once, at desktop width.')
  // The root administrator is provisioned by its first sign-in at /auth/admin/login, and the
  // one sign-in dialog only reaches that route for an account that already exists — as it
  // does in production. Provision it the way it first was, then sign in as a person would.
  // (A brand-new database cannot provision it from the dialog: audit D10.)
  const provisioned = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
  expect(provisioned.ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await fillSignIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.waitForURL('**/admin', { timeout: 30_000 })
  const { problems, visited, timings } = await crawl(page, request, ['/admin'], { touchTargets: false })
  recordVisited(testInfo, { visited, timings })
  expect(problems, `\n${problems.join('\n')}\n`).toEqual([])
  expect(visited.length).toBeGreaterThan(20)
})
