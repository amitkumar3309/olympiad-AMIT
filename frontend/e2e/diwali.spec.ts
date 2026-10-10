/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test'
import { DIWALI_EDITION } from '../src/lib/season.ts'
import { BACKEND, E2E_ADMIN, expectAccessible, fillSignIn, resetBackend, seedQuiz, signIn, waitForApp, test } from './fixtures.ts'

/**
 * Milestone 30 Phase 7 — the Diwali edition (`src/lib/season.ts`, `public/boot.js`).
 *
 * The edition is keyed on the **device's** date, which `page.clock` sets before the page's own
 * scripts run: boot.js reads it before the first paint and puts `data-season` on <html>. The
 * server's clock is untouched (the countdown and the archive read that one).
 */

// This file tests the edition itself: its pages follow the dates each test pins, not the suite's
// everyday default (fixtures.ts).
test.use({ everyday: false })

const DIWALI_WEEK = new Date('2026-11-09T10:00:00+05:30')
/** An ordinary day — clear of the week and of any trial — for a test that needs the everyday site. */
const EVERYDAY = new Date('2026-12-01T10:00:00+05:30')

async function at(page: Page, when: Date) {
  await page.clock.setFixedTime(when)
}

const seasonOf = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-season'))
const introOf = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-intro'))
/** The night sky behind every page, and — only while they burst — the fireworks' canvas in it. */
const sky = (page: Page) => page.locator('[data-fireworks]')
const fireworks = (page: Page) => page.locator('[data-fireworks][data-running="true"] canvas')

/** Opens the homepage and returns as soon as the intro is playing, without waiting for `load`. */
async function openToIntro(page: Page) {
  await page.goto('/', { waitUntil: 'commit' })
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-intro') === 'play' && document.getElementById('amit-intro') !== null,
  )
}

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

/**
 * A page still drawing the fireworks is slow for this harness to close — seconds, once over a
 * minute, against a tenth of a second for a still one — so every test leaves its page first. A
 * reader never meets it: a reload during the edition measures a quarter of a second.
 */
async function leave(page: Page) {
  await page.goto('about:blank')
}

test.afterEach(async ({ page }) => {
  await leave(page)
})

test.describe('the edition switches itself on and off', () => {
  test.use({ reducedMotion: 'reduce' })

  test('from 12:00 AM on 8 November to the end of 15 November, India time — and not a second either side', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Dates, not layout: checked once.')
    const cases: Array<[string, string | null]> = [
      ['2026-11-07T23:59:59+05:30', null],
      ['2026-11-08T00:00:00+05:30', 'diwali'],
      ['2026-11-15T23:59:59+05:30', 'diwali'],
      ['2026-11-16T00:00:00+05:30', null],
    ]
    for (const [when, expected] of cases) {
      await at(page, new Date(when))
      await page.goto('/')
      expect(await seasonOf(page), when).toBe(expected)
      const block = page.getByText('Launched this', { exact: true })
      if (expected) await expect(block).toBeVisible()
      else await expect(block).toBeHidden()
    }
  })

  test('a trial turns the same edition on for its hours only, under its own name', async ({ page }, testInfo) => {
    const trial = DIWALI_EDITION.trial
    test.skip(!trial, 'No trial is set in src/lib/season.ts.')
    test.skip(testInfo.project.name !== 'desktop', 'Dates, not layout: checked once.')
    const minute = 60_000
    const cases: Array<[number, string | null]> = [
      [Date.parse(trial!.startsAt) - minute, null],
      [Date.parse(trial!.startsAt), trial!.id],
      [Date.parse(trial!.endsAt) - minute, trial!.id],
      [Date.parse(trial!.endsAt), null],
      // The real week is still the real week's.
      [DIWALI_WEEK.getTime(), DIWALI_EDITION.id],
    ]
    for (const [when, expected] of cases) {
      await at(page, new Date(when))
      await page.goto('/')
      const label = new Date(when).toISOString()
      expect(await seasonOf(page), label).toBe(expected ? 'diwali' : null)
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-season-id')), label).toBe(expected)
    }
  })

  test('?season=diwali previews it for the session, and ?season=off hides it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    // An ordinary day, so "auto" below means the everyday site whenever the suite runs.
    await at(page, EVERYDAY)
    await page.goto('/?season=diwali')
    expect(await seasonOf(page)).toBe('diwali')
    await page.goto('/leaderboard')
    expect(await seasonOf(page)).toBe('diwali')
    await page.goto('/?season=off')
    expect(await seasonOf(page)).toBeNull()
    await page.goto('/?season=auto')
    expect(await seasonOf(page)).toBeNull() // an ordinary day
  })
})

test.describe('the intro', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('a browser that saw a trial’s intro still sees the real week’s', async ({ page }, testInfo) => {
    const trial = DIWALI_EDITION.trial
    test.skip(!trial, 'No trial is set in src/lib/season.ts.')
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    await at(page, new Date(Date.parse(trial!.startsAt) + 60_000))
    await openToIntro(page)
    await page.keyboard.press('Escape')
    await expect.poll(() => introOf(page)).toBeNull()
    // The week comes: the same browser is shown the launch moment after all.
    await at(page, DIWALI_WEEK)
    await openToIntro(page)
  })

  test('plays once per browser, and any key ends it at once', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    await at(page, DIWALI_WEEK)
    await openToIntro(page)
    // One look, in one tick: it covers the page, hides nothing from a screen reader, holds no control.
    expect(
      await page.evaluate(() => {
        const intro = document.getElementById('amit-intro')!
        return {
          shown: getComputedStyle(intro).display !== 'none',
          ariaHidden: intro.getAttribute('aria-hidden'),
          controls: intro.querySelectorAll('a, button, input, select, textarea, [tabindex]').length,
        }
      }),
    ).toEqual({ shown: true, ariaHidden: 'true', controls: 0 })

    await page.keyboard.press('Shift')
    expect(await introOf(page)).toBeNull()
    await expect(page.locator('#amit-intro')).toBeHidden()

    // Seen: not again on this browser.
    await page.goto('/')
    expect(await introOf(page)).toBeNull()
  })

  test('ends by itself, and never covers the page for a hidden tab, a link with a purpose or a reader who asked for less motion', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    await at(page, DIWALI_WEEK)
    await openToIntro(page)
    // No input at all: the timer ends it (7.3 s), whether or not its animation ran.
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-intro'), null, { timeout: 10_000 })

    // A context made here does not inherit the config's `use`, so the address is passed on.
    const fresh = async (options: Parameters<typeof browser.newContext>[0], path: string) => {
      const context = await browser.newContext({ ...options, baseURL: testInfo.project.use.baseURL })
      const other = await context.newPage()
      await other.clock.setFixedTime(DIWALI_WEEK)
      await other.goto(path)
      const state = { season: await seasonOf(other), intro: await introOf(other) }
      await leave(other)
      await context.close()
      return state
    }
    expect(await fresh({ reducedMotion: 'reduce' }, '/')).toEqual({ season: 'diwali', intro: null })
    expect(await fresh({}, '/#login')).toEqual({ season: 'diwali', intro: null })
    expect(await fresh({}, '/?next=/daily-quiz')).toEqual({ season: 'diwali', intro: null })
    expect(await fresh({}, '/leaderboard')).toEqual({ season: 'diwali', intro: null })
  })

  test('a signed-in student sees it once that week in the student area, and never again', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    await seedQuiz(request)
    await at(page, DIWALI_WEEK)
    // Signed in without it, as from a link with a purpose; then straight into the student area.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await signIn(page)
    expect(await introOf(page)).toBeNull()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/dashboard')
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-intro') === 'play' && document.getElementById('amit-intro') !== null,
    )
    expect(
      await page.evaluate(() => {
        const intro = document.getElementById('amit-intro')!
        return {
          ariaHidden: intro.getAttribute('aria-hidden'),
          controls: intro.querySelectorAll('a, button, input, select, textarea, [tabindex]').length,
        }
      }),
    ).toEqual({ ariaHidden: 'true', controls: 0 })

    await page.keyboard.press('Shift')
    expect(await introOf(page)).toBeNull()
    await expect(page.locator('#amit-intro')).toHaveCount(0)

    // Seen: not on the next page, nor on the homepage.
    await page.goto('/leaderboard')
    await waitForApp(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await introOf(page)).toBeNull()
    await page.goto('/')
    expect(await introOf(page)).toBeNull()
  })
})

test.describe('the whole site at night', () => {
  test.use({ reducedMotion: 'reduce' })

  test('every page is the night in either theme, with no switch left to press — and the everyday site after', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Tokens, not layout: checked once.')
    await seedQuiz(request)
    // A reader who chose the light theme: during the edition it is the night all the same.
    await page.addInitScript(() => window.localStorage.setItem('amit-theme', 'light'))
    // The page's colour, a card's (resolved through an element, as a card paints it) and the
    // colour scheme the browser draws its own controls in.
    const look = () =>
      page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('div'))
        probe.style.background = 'var(--surface)'
        const card = getComputedStyle(probe).backgroundColor
        probe.remove()
        return { page: getComputedStyle(document.body).backgroundColor, card, scheme: getComputedStyle(document.documentElement).colorScheme }
      })
    const themeSwitches = page.getByRole('button', { name: /^Switch to (dark|light) mode$/ })

    await at(page, DIWALI_WEEK)
    await signIn(page)
    // The page is see-through to the sky, the cards are the night's blue, the browser's own
    // controls are dark — and the switch is gone, because it would change nothing.
    expect(await look()).toEqual({ page: 'rgba(0, 0, 0, 0)', card: 'rgb(18, 30, 71)', scheme: 'dark' })
    await expect(sky(page)).toBeVisible()
    await expect(themeSwitches).toHaveCount(0)
    // Still, for a reader who asked for less motion: the night, and no fireworks.
    await expect(sky(page).locator('canvas')).toHaveCount(0)

    await at(page, new Date('2026-11-16T00:00:00+05:30'))
    await page.goto('/dashboard')
    await waitForApp(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await look()).toEqual({ page: 'rgb(244, 248, 254)', card: 'rgb(255, 255, 255)', scheme: 'light' })
    await expect(sky(page)).toBeHidden()
    await expect(themeSwitches.filter({ visible: true })).not.toHaveCount(0)
  })
})

test.describe('the fireworks', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('burst behind the page for a reader who is fine with motion, and keep still on staff pages', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    await at(page, DIWALI_WEEK)
    await page.addInitScript(() => window.localStorage.setItem('amit-intro', 'diwali-2026'))
    await page.goto('/')
    await waitForApp(page)
    await expect(fireworks(page)).toHaveCount(1)
    // Drawing: with everything but the sky hidden, the screen is not the same a second later.
    await page.addStyleTag({
      content: 'body * { visibility: hidden !important } [data-fireworks], [data-fireworks] * { visibility: visible !important }',
    })
    const first = await page.screenshot()
    await page.waitForTimeout(1500)
    expect(first.equals(await page.screenshot()), 'the sky did not change in 1.5 s').toBe(false)

    // An administrator's pages are the night, and still.
    const provisioned = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
    expect(provisioned.ok()).toBe(true)
    await page.goto('/')
    await waitForApp(page)
    await page.getByRole('button', { name: 'I already have an account' }).click()
    await fillSignIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
    await page.waitForURL('**/admin', { timeout: 30_000 })
    await expect(sky(page)).toBeVisible()
    await expect(sky(page).locator('canvas')).toHaveCount(0)
  })
})

test.describe('during the edition', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the homepage keeps one heading, does not shift, counts down by the server and passes axe', async ({ page, request }) => {
    await seedQuiz(request)
    await page.addInitScript(() => {
      ;(window as unknown as { __shifts: number }).__shifts = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) (window as unknown as { __shifts: number }).__shifts += entry.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })
    await at(page, DIWALI_WEEK)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.locator('h1')).toHaveCount(1)
    // Nothing festive may push the page sideways — the lights once did.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Earn the Diwali 2026 badge' })).toBeVisible()
    // A quiz is on today on the server's clock, so the countdown is to its close.
    await expect(page.getByRole('timer', { name: 'Today’s Daily Quiz closes in' })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __shifts: number }).__shifts)).toBeLessThan(0.01)
    await expectAccessible(page, 'the Diwali homepage')
  })

  test('the student area wears the lights and the greeting', async ({ page, request }) => {
    await seedQuiz(request)
    await at(page, DIWALI_WEEK)
    await signIn(page)
    expect(await seasonOf(page)).toBe('diwali')
    await expect(page.getByText('Happy Diwali').first()).toBeAttached()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await expectAccessible(page, 'the dashboard during the edition')
  })
})
