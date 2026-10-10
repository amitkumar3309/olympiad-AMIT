/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test'
import { BACKEND, E2E_ADMIN, resetBackend, seedQuiz, signIn, waitForApp, test } from './fixtures.ts'

/**
 * Everything works from the keyboard alone (Milestone 30, Phase 6 — brief §10, "Accessibility":
 * "everything keyboard-operable (tabs, modals, option tiles, menus); visible focus; focus trap in
 * modals"). axe checks what is on the page; this checks what a keyboard can do with it.
 *
 * Desktop width only: a keyboard on a phone is rare, and every control here is the same
 * component at both widths.
 */

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard use is checked once, at desktop width.')
  await resetBackend(request)
  await seedQuiz(request)
})

/** What has the focus: its name, whether a focus ring is drawn, and where it sits. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const style = getComputedStyle(el)
    return {
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none',
      inMain: el.closest('#main-content') !== null,
      inDialog: el.closest('[role="dialog"]') !== null,
    }
  })
}

test('the first Tab reaches "Skip to content", and it jumps past the header', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  await page.keyboard.press('Tab')
  expect((await focused(page))?.name).toBe('Skip to content')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  expect((await focused(page))?.inMain).toBe(true)
})

test('every keyboard stop shows a focus ring — on the homepage and on the dashboard', async ({ page }) => {
  for (const start of ['/', '/dashboard']) {
    if (start === '/dashboard') await signIn(page)
    await page.goto(start)
    await waitForApp(page)
    for (let stop = 1; stop <= 30; stop += 1) {
      await page.keyboard.press('Tab')
      const now = await focused(page)
      if (now === null) continue
      expect(now.ring, `${start}, stop ${stop}: "${now.name}" has no visible focus`).toBe(true)
    }
  }
})

test('the sign-in dialog opens, keeps focus inside and closes with the keyboard', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  const trigger = page.getByRole('button', { name: 'I already have an account' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect((await focused(page))?.inDialog).toBe(true)
  for (let press = 1; press <= 15; press += 1) {
    await page.keyboard.press('Tab')
    expect((await focused(page))?.inDialog, `Tab ${press} left the dialog`).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('the Daily Quiz can be played with the keyboard alone', async ({ page }) => {
  await signIn(page)
  await page.goto('/daily-quiz')
  await page.getByRole('button', { name: 'Start the quiz' }).focus()
  await page.keyboard.press('Enter')

  // The options are a real radio group: Space chooses, the arrow keys move the choice.
  const options = page.getByRole('radio')
  await expect(options).toHaveCount(4)
  await options.first().focus()
  await page.keyboard.press('Space')
  await expect(options.first()).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toBeChecked()
  await expect(options.nth(1)).toBeFocused()

  // The confirm dialog takes the focus; Escape backs out and keeps the choice.
  const submit = page.getByRole('button', { name: 'Submit answer' })
  await submit.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect((await focused(page))?.inDialog).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(options.nth(1)).toBeChecked()

  await submit.focus()
  await page.keyboard.press('Enter')
  await dialog.getByRole('button', { name: /^Submit option/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /^(Correct!|Not this time)$/ })).toBeVisible()
})

test('the account menu opens, moves and closes with the keyboard', async ({ page }) => {
  await signIn(page)
  // Let the dashboard finish arriving: a re-render while it loads can take the focus away
  // from the trigger before the key reaches it.
  await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const trigger = page.getByRole('button', { name: /^Account menu for Esha/ })
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', { name: /^Account menu for Esha/ })
  await expect(menu).toBeVisible()
  const items = menu.getByRole('menuitem')
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('tabs move with the arrow keys and show their panel', async ({ page }) => {
  // The admin analytics page is the product's `ui/Tabs` in the ARIA tabs pattern.
  const provisioned = await page.request.post(`${BACKEND}/api/v1/auth/admin/login`, {
    data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password },
  })
  expect(provisioned.ok()).toBe(true)
  await page.goto('/admin/analytics')
  const tabs = page.getByRole('tab')
  await expect(tabs.first()).toBeVisible()
  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  const panel = await tabs.nth(1).getAttribute('aria-controls')
  expect(panel).toBeTruthy()
  await expect(page.locator(`#${panel}`)).toBeVisible()
})
