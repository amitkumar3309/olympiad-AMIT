/// <reference lib="dom" />
import { deflateSync } from 'node:zlib'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { advanceDays, BACKEND, E2E_ADMIN, E2E_STUDENT, expectAccessible, fillSignIn, resetBackend, signIn, waitForApp, test } from './fixtures.ts'

/**
 * Picture questions (Milestone 30 Phase 7b — PLAN.md Q19): the uploaded picture **is** the
 * question. The rules — the description is required, a picture's key is the permission to fetch it,
 * the solution's picture only from the reveal, the metadata stripped — are the backend's tests
 * (`questionImages.test.ts`, `dailyQuiz.test.ts`). This is the browser pass the new pages need: a
 * picture chosen in the editor is shrunk before upload, described and saved; pictures import as
 * questions on the review screen; and a student meets the picture in the Daily Quiz.
 */

test.beforeEach(async ({ request }) => {
  await resetBackend(request)
})

// ---------------------------------------------------------------------------------------------
// A real PNG, made here: a solid colour, any size
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A `width` × `height` PNG of one colour. Solid, so even a large one deflates to a few KB. */
function png(width: number, height: number, rgb: [number, number, number] = [37, 99, 235]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------------------------
// Setting up
// ---------------------------------------------------------------------------------------------

/** The suite's administrator, signed in through the one sign-in box. */
async function signInAsAdmin(page: Page, request: APIRequestContext) {
  // The root administrator is provisioned by its first sign-in at /auth/admin/login.
  const provisioned = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
  expect(provisioned.ok()).toBe(true)
  await page.goto('/')
  await waitForApp(page)
  await page.getByRole('button', { name: 'I already have an account' }).click()
  await fillSignIn(page, E2E_ADMIN.email, E2E_ADMIN.password)
  await page.waitForURL('**/admin', { timeout: 30_000 })
}

/** The seeded student, a chapter ("Algebra") and today's quiz for Classes 9–12 — a text question. */
async function seed(request: APIRequestContext): Promise<{ groupId: string }> {
  const res = await request.post(`${BACKEND}/__e2e/seed`, { data: { student: E2E_STUDENT, quiz: { classMin: 9, classMax: 12 } } })
  expect(res.ok(), await res.text()).toBe(true)
  return { groupId: ((await res.json()) as { quiz: { groupId: string } }).quiz.groupId }
}

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

test('a picture chosen in the question editor is made smaller, described and saved with the question', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'An admin page: checked once, at desktop width.')
  await seed(request)
  await signInAsAdmin(page, request)

  await page.goto('/admin/questions/new')
  await page.getByLabel(/^Chapter/).selectOption({ label: 'Algebra' })

  // 2,400 × 1,200: the browser should store it at 1,600 × 800.
  const questionPicture = page.getByRole('group', { name: 'Picture of the question' })
  await questionPicture.locator('input[type="file"]').setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: png(2400, 1200) })
  await expect(questionPicture.getByRole('img', { name: 'The chosen picture, not yet described' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel(/^Question text/)).not.toHaveAttribute('required', '')

  const description = 'A blue rectangle twice as wide as it is tall; what is its width if its height is 4 cm?'
  await questionPicture.getByRole('textbox', { name: /Describe the picture/ }).fill(description)
  for (const [index, text] of ['4 cm', '6 cm', '8 cm', '16 cm'].entries()) {
    await page.getByLabel(`Option ${index + 1} text`).fill(text)
  }
  await page.getByLabel('Option 3 is correct').check()
  await page.getByLabel('Worked solution', { exact: true }).fill('Twice the height: $2 \\times 4 = 8$ cm.')

  // The preview shows the picture as students will.
  await expect(page.locator('aside').getByRole('img', { name: description })).toBeVisible()
  await expectAccessible(page, 'the question editor with a picture')

  await page.getByRole('button', { name: 'Create draft' }).click()
  await page.waitForURL('**/admin/questions')
  // The editor stays on screen while the bank's page loads: wait for the bank itself.
  await expect(page.getByRole('heading', { level: 1, name: 'Question Bank' })).toBeVisible()
  await expect(page.getByRole('img', { name: description })).toBeVisible()

  // Stored as the browser made it: 1,600 pixels across, WebP, from this site.
  const listed = await page.evaluate(async () => {
    const res = await fetch('/api/v1/admin/questions?limit=5', { credentials: 'include' })
    return (await res.json()) as { questions: Array<{ image: { url: string; width: number; height: number; alt: string } | null }> }
  })
  const image = listed.questions.find((question) => question.image)?.image
  expect(image).toMatchObject({ width: 1600, height: 800, alt: description })
  const served = await page.request.get(image!.url)
  expect(served.headers()['content-type']).toBe('image/webp')
  expect(served.headers()['cache-control']).toContain('immutable')
})

/**
 * The owner's upload form (2026-10-09): what is being uploaded, the class, the question type and an
 * optional topic — no chapter to choose. Each photo's card asks for the answer its type needs, and
 * saving puts it in the chosen class, adding the typed topic as a chapter.
 */
test('photos upload as questions: class, type and topic on the form, each answered on its card, saved to that class', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'An admin page: checked once, at desktop width.')
  await seed(request)
  await signInAsAdmin(page, request)

  await page.goto('/admin/questions/import')
  await page.getByRole('button', { name: 'Photo' }).click()
  await expect(page.getByText('Students see each photo exactly as you upload it. Nothing reads it.')).toBeVisible()
  await page.getByLabel('2. Class *').selectOption('Class 7')
  await page.locator('#imp-files').setInputFiles([
    { name: 'question-1.png', mimeType: 'image/png', buffer: png(900, 600, [220, 38, 38]) },
    { name: 'question-2.png', mimeType: 'image/png', buffer: png(600, 900, [22, 163, 74]) },
  ])
  const upload = page.getByRole('button', { name: 'Upload the photos' })
  // Nothing is uploaded until the question type is chosen.
  await expect(upload).toBeDisabled()
  await page.getByLabel('3. Question type *').selectOption('single_choice')
  await page.getByLabel('4. Topic (optional)').fill('Mensuration')
  await upload.click()

  await expect(page.getByRole('heading', { name: 'Review 2 questions for Class 7' })).toBeVisible({ timeout: 30_000 })
  const cards = page.locator('[data-picked]')
  const first = cards.first()
  // Each card says where it goes; the topic is new, so saving will add it.
  await expect(first.getByText('Class 7 · Mensuration')).toBeVisible()
  await expect(first.getByText('new topic')).toBeVisible()
  // Nothing on a photo's card is filled in yet, so it opens ready to describe and answer.
  await first.getByRole('textbox', { name: /Describe the photo/ }).fill('A red rectangle three wide and two tall; what is its area?')
  for (const [index, text] of ['5', '6', '9', '12'].entries()) {
    await first.getByRole('textbox', { name: `Option ${String.fromCharCode(65 + index)}`, exact: true }).fill(text)
  }
  // Single correct: one choice among the options.
  await first.getByRole('radio', { name: 'Option B is the correct answer' }).check()
  await first.getByRole('textbox', { name: 'Worked solution' }).fill('Three times two is $6$.')
  await expectAccessible(page, 'the photo upload review')

  // The second is not ready, so it is set aside rather than saved.
  await cards.nth(1).getByRole('checkbox', { name: 'Save question 2' }).uncheck()
  await page.getByRole('button', { name: 'Check before saving' }).click()
  await expect(page.getByText('Checked: all 1 would save.')).toBeVisible()
  await page.getByRole('button', { name: 'Save 1 question to Class 7' }).click()
  await expect(page.getByRole('heading', { name: 'Saved 1 question to Class 7 as draft.' })).toBeVisible()
  await expect(page.getByText('New topic added: Mensuration.')).toBeVisible()

  // "It should reflect in the respective chosen class": the bank opens on that class.
  const bank = page.getByRole('link', { name: 'See Class 7’s questions in the question bank' })
  await expect(bank).toHaveAttribute('href', '/admin/questions?source=picture_import&classLevel=Class+7')
  await bank.click()
  await expect(page.getByLabel('Filter by class')).toHaveValue('Class 7')
})

test('a student sees today’s picture question from Start, and its solution picture only from the next day', async ({ page, request }) => {
  const { groupId } = await seed(request)
  const admin = await request.post(`${BACKEND}/api/v1/auth/admin/login`, { data: { email: E2E_ADMIN.email, password: E2E_ADMIN.password } })
  expect(admin.ok()).toBe(true)

  // A picture question and a picture of its solution, written through the API as staff.
  const upload = async (buffer: Buffer) => {
    const res = await request.post(`${BACKEND}/api/v1/admin/question-images`, {
      data: { image: `data:image/png;base64,${buffer.toString('base64')}` },
    })
    expect(res.status(), await res.text()).toBe(201)
    return ((await res.json()) as { image: { key: string } }).image.key
  }
  const questionKey = await upload(png(800, 500, [124, 58, 237]))
  const solutionKey = await upload(png(800, 300, [234, 88, 12]))
  const topics = (await (await request.get(`${BACKEND}/api/v1/topics?parent=root`)).json()) as { topics: Array<{ id: string; name: string }> }
  const algebra = topics.topics.find((topic) => topic.name === 'Algebra')!
  const created = await request.post(`${BACKEND}/api/v1/admin/questions`, {
    data: {
      questionText: '',
      image: { key: questionKey, alt: 'A purple card with the number 7 on it; what is 7 squared?' },
      type: 'single_choice',
      options: [
        { text: '14', isCorrect: false },
        { text: '49', isCorrect: true },
        { text: '77', isCorrect: false },
        { text: '21', isCorrect: false },
      ],
      solution: null,
      solutionImage: { key: solutionKey, alt: 'Seven times seven, worked on paper: 49.' },
      topic: algebra.id,
      classLevel: 'Class 9',
      difficulty: 'Easy',
      marks: 1,
      negativeMarks: 0,
      tags: [],
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const questionId = ((await created.json()) as { question: { id: string } }).question.id
  // Today's seeded quiz is pointed at it — allowed until somebody starts it.
  const changed = await request.put(`${BACKEND}/api/v1/admin/daily-quiz/${groupId}`, { data: { questionId } })
  expect(changed.ok(), await changed.text()).toBe(true)

  await signIn(page)
  await page.goto('/daily-quiz')
  await expect(page.getByRole('img', { name: /purple card/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start the quiz' }).click()
  const picture = page.getByRole('img', { name: 'A purple card with the number 7 on it; what is 7 squared?' })
  await expect(picture).toBeVisible()
  await expect(picture).toHaveAttribute('width', '800')
  await expect(picture).toHaveAttribute('height', '500')
  await expectAccessible(page, 'a picture question in the Daily Quiz')

  await page.locator('label').filter({ has: page.getByRole('radio', { name: '49', exact: true }) }).click()
  await page.getByRole('button', { name: 'Submit answer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Submit option/ }).click()
  await expect(page.getByRole('heading', { name: 'Correct!' })).toBeVisible()
  // The solution's picture waits for the reveal, like the written solution.
  await expect(page.getByRole('img', { name: /Seven times seven/ })).toHaveCount(0)

  await advanceDays(request, 1)
  await page.goto('/profile#daily-quiz-history')
  const history = page.locator('#daily-quiz-history')
  await history.getByText('View solution').click()
  await expect(history.getByRole('img', { name: 'Seven times seven, worked on paper: 49.' })).toBeVisible()
})
