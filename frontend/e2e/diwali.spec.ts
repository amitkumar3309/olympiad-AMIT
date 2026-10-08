/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, resetBackend, seedQuiz, signIn, waitForApp } from './fixtures.ts'

/**
 * Milestone 30 Phase 7 — the Diwali edition (`src/lib/season.ts`, `public/boot.js`).
 *
 * The edition is keyed on the **device's** date, which `page.clock` sets before the page's own
 * scripts run: boot.js reads it before the first paint and puts `data-season` on <html>. The
 * server's clock is untouched (the countdown and the archive read that one).
 */

const DIWALI_WEEK = new Date('2026-11-09T10:00:00+05:30')

async function at(page: Page, when: Date) {
  await page.clock.setFixedTime(when)
}

const seasonOf = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-season'))
const introOf = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-intro'))

/**
 * Opens the homepage and returns as soon as the intro is playing. The intro lasts 2.1 s at most,
 * and waiting for the page's `load` can take most of that, so these tests catch it at the start.
 */
async function openToIntro(page: Page) {
  await page.goto('/', { waitUntil: 'commit' })
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-intro') === 'play' && document.getElementById('amit-intro') !== null,
  )
}

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
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

  test('?season=diwali previews it for the session, and ?season=off hides it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Checked once.')
    await page.goto('/?season=diwali')
    expect(await seasonOf(page)).toBe('diwali')
    await page.goto('/leaderboard')
    expect(await seasonOf(page)).toBe('diwali')
    await page.goto('/?season=off')
    expect(await seasonOf(page)).toBeNull()
    await page.goto('/?season=auto')
    expect(await seasonOf(page)).toBeNull() // the real date is not Diwali week
  })
})

test.describe('the intro', () => {
  test.use({ reducedMotion: 'no-preference' })

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
    // No input at all: the timer ends it, whether or not its animation ran.
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-intro'), null, { timeout: 4000 })

    // A context made here does not inherit the config's `use`, so the address is passed on.
    const fresh = async (options: Parameters<typeof browser.newContext>[0], path: string) => {
      const context = await browser.newContext({ ...options, baseURL: testInfo.project.use.baseURL })
      const other = await context.newPage()
      await other.clock.setFixedTime(DIWALI_WEEK)
      await other.goto(path)
      const state = { season: await seasonOf(other), intro: await introOf(other) }
      await context.close()
      return state
    }
    expect(await fresh({ reducedMotion: 'reduce' }, '/')).toEqual({ season: 'diwali', intro: null })
    expect(await fresh({}, '/#login')).toEqual({ season: 'diwali', intro: null })
    expect(await fresh({}, '/?next=/daily-quiz')).toEqual({ season: 'diwali', intro: null })
    expect(await fresh({}, '/leaderboard')).toEqual({ season: 'diwali', intro: null })
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
