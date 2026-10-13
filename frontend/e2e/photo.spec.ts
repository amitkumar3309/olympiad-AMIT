import { expect } from '@playwright/test'
import { test } from './fixtures.ts'

/**
 * A phone photo is accepted at registration (2026-10-13). It used to be refused over 2 MB — an
 * ordinary phone photo is 3–6 MB — and is now redrawn in the browser to at most 900 px and 400 KB
 * before it is sent (`lib/photo.ts`).
 */
test('a 4000 × 3000 phone-sized photo is accepted and made small before upload', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByRole('heading', { level: 1, name: 'Register' })).toBeVisible()

  // A large, hard-to-compress JPEG made in the page: random pixels at high quality.
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4000
    canvas.height = 3000
    const context = canvas.getContext('2d')!
    const block = context.createImageData(4000, 300)
    for (let i = 0; i < block.data.length; i += 4) {
      block.data[i] = Math.random() * 255
      block.data[i + 1] = Math.random() * 255
      block.data[i + 2] = Math.random() * 255
      block.data[i + 3] = 255
    }
    for (let y = 0; y < 3000; y += 300) context.putImageData(block, 0, y)
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  })
  const buffer = Buffer.from(base64, 'base64')
  expect(buffer.length).toBeGreaterThan(3 * 1024 * 1024)

  await page.locator('input[type="file"]').setInputFiles({ name: 'IMG_20261013.jpg', mimeType: 'image/jpeg', buffer })
  const preview = page.getByAltText('The photograph you chose')
  await expect(preview).toBeVisible()
  const size = await page.locator('text=/^\\d+ KB$/').first().textContent()
  expect(Number(size!.replace(' KB', ''))).toBeLessThanOrEqual(400)
  const natural = await preview.evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight))
  expect(natural).toBeLessThanOrEqual(900)
})
