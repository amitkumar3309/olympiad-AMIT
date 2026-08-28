import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { ImportBatch, Question } from '../src/models';
import {
  setGeminiClientFactory,
  type GeminiClient,
  type GeminiGenerateResult,
} from '../src/services/geminiQuestionGenerator';
import { OCR_STANDING_WARNING, mimeTypeFor } from '../src/services/imageImportParser';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, clearTestInbox } from './helpers/auth';
import { createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 21, Phase E — importing questions from photographs.
 *
 * **Nothing here touches the network.** `setGeminiClientFactory()` is the same test-only hook the
 * generator's suite uses, and it throws outside the test environment — so the whole image path is
 * exercised, including the failing branches, without a key and without a request leaving the
 * machine. That matters more here than for the generator: the interesting cases are a blurred page,
 * a page with no printed answer key, and a model that transcribes an answer letter that does not
 * match any option, and **none of those can be produced on demand against a real provider.**
 *
 * The property the suite circles hardest is the division of labour the parser is built on: the model
 * **transcribes what is printed**, and our own `lib/importAnswerText.ts` decides what the answer
 * *means*. So the schema asks for `answer: "B"` as a plain string and never for `isCorrect` flags,
 * and the tests assert both halves — that the model is asked for a transcription, and that the
 * answer key is derived from it by the same readers a spreadsheet goes through.
 *
 * The single most important refusal in the feature is also asserted here: **a question with no
 * printed answer must never acquire one.** A model that helpfully solved it would produce an answer
 * key indistinguishable from a printed one, and real children would be marked against it.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_KEY = config.ai.geminiApiKey;
const IMAGE_URL = `${API}/admin/questions/import/image`;
const ALIAS = '/api';

beforeEach(() => {
  config.ai.geminiApiKey = 'test-key-not-a-real-credential';
});

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  setGeminiClientFactory(null);
  config.ai.geminiApiKey = ORIGINAL_KEY;
});

// ---------------------------------------------------------------------------
// The fake provider
// ---------------------------------------------------------------------------

interface Spy {
  calls: number;
  /** Every request body, so a test can assert what was actually sent. */
  params: Array<Record<string, unknown>>;
  /** The last payload serialised, for assertions about the inline image part. */
  contents: string;
  /**
   * The prompt text itself, pulled out of the parts array.
   *
   * Kept separate from `contents` because `JSON.stringify` renders a real newline as the two
   * characters `\` and `n`, so a pattern spanning a wrapped line never matches the serialised
   * form — which made an assertion about the most important instruction in the prompt fail while
   * the instruction was present and correct. Asserting on the prompt means asserting on the prompt.
   */
  prompt: string;
  model: string;
  /** The `temperature` of the last call — low for transcription, unlike generation. */
  temperature: number | null;
}

/** Every `text` part of a multi-part payload, joined — i.e. the prompt as the model reads it. */
function promptTextOf(contents: unknown): string {
  if (typeof contents === 'string') return contents;
  if (!Array.isArray(contents)) return '';
  return contents
    .flatMap((entry) => {
      const parts = (entry as { parts?: Array<{ text?: unknown }> }).parts ?? [];
      return parts.map((part) => (typeof part.text === 'string' ? part.text : ''));
    })
    .join('\n');
}

function geminiClient(reply: (spy: Spy) => GeminiGenerateResult): Spy {
  const spy: Spy = { calls: 0, params: [], contents: '', prompt: '', model: '', temperature: null };
  const client: GeminiClient = {
    generateContent: (params) => {
      spy.calls += 1;
      const row = params as unknown as Record<string, unknown>;
      spy.params.push(row);
      spy.contents = typeof row.contents === 'string' ? row.contents : JSON.stringify(row.contents);
      spy.prompt = promptTextOf(row.contents);
      spy.model = String(row.model ?? '');
      const cfg = row.config as Record<string, unknown> | undefined;
      spy.temperature = typeof cfg?.temperature === 'number' ? cfg.temperature : null;
      return Promise.resolve(reply(spy));
    },
    listModels: () => Promise.resolve([]),
  };
  setGeminiClientFactory(() => client);
  return spy;
}

/** The model transcribes this payload. */
function transcribing(payload: unknown): Spy {
  return geminiClient(() => ({ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }));
}

/** The provider refuses. `status` is what the SDK attaches to its own error. */
function geminiFailing(message: string, status?: number): Spy {
  return geminiClient(() => {
    const error: Error & { status?: number } = new Error(message);
    if (status !== undefined) error.status = status;
    throw error;
  });
}

/** One transcribed question as the schema describes it, with every field present. */
function transcribed(overrides: Record<string, unknown> = {}) {
  return {
    questionNumber: '7',
    questionText: 'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?',
    options: ['$x = 3$', '$x = 2$', '$x = -3$', '$x = 6$'],
    answer: 'A',
    solution: 'Factorise as $(x-2)(x-3)=0$, so the larger root is $3$.',
    referencesFigure: false,
    unreadable: false,
    uncertainty: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Image fixtures
// ---------------------------------------------------------------------------

/**
 * A byte sequence with a real image signature.
 *
 * It does not need to decode: nothing in this pipeline renders it, and the fake provider never
 * looks at it. What matters is that it passes the magic-byte check in `uploadSchemas.ts`, which is
 * the gate a genuinely fake image has to clear.
 */
function pngBytes(size = 512): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(size, 0x21),
  ]);
}

function jpegBytes(size = 512): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(size, 0x22)]);
}

function webpBytes(size = 512): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP'),
    Buffer.alloc(size, 0x23),
  ]);
}

function imageDataUrl(bytes: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

interface PreviewBody {
  success: boolean;
  batchId: string;
  parser: { id: string; extraction: string };
  questions: Array<Record<string, unknown>>;
  rejected: Array<{ index: number; reason: string }>;
  duplicates: Array<{ index: number; reason: string }>;
  failures: Array<{ sourceRef: string; reason: string }>;
  batchWarnings: Array<{ code: string; message: string }>;
  files: Array<Record<string, unknown>>;
  examined: number;
}

async function adminSetup(): Promise<{ cookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies } = await createAdminSession(app);
  const taxonomy = await createTaxonomy(app, cookies);
  return { cookies, taxonomy };
}

async function upload(
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  files: Array<{ name: string; content: string }> = [{ name: 'page-1.png', content: imageDataUrl(pngBytes()) }],
  overrides: Record<string, unknown> = {},
  expectStatus = 200,
): Promise<PreviewBody> {
  const res = await request(app)
    .post(IMAGE_URL)
    .set('Cookie', cookieHeader(cookies))
    .send({
      topic: taxonomy.topicId,
      classLevel: 'Class 8',
      difficulty: 'Medium',
      marks: 4,
      negativeMarks: 1,
      files,
      ...overrides,
    })
    .expect(expectStatus);
  return res.body as PreviewBody;
}

function warningTexts(body: PreviewBody): string {
  return body.batchWarnings.map((w) => w.message).join(' || ');
}

function noteTexts(question: Record<string, unknown>): string {
  return (question.warnings as Array<{ message: string }>).map((w) => w.message).join(' || ');
}

// ---------------------------------------------------------------------------
// What the model is asked
// ---------------------------------------------------------------------------

describe('what is sent to the provider', () => {
  it('sends the image inline, alongside a transcription instruction', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const spy = transcribing([transcribed()]);
    const bytes = pngBytes();

    await upload(cookies, taxonomy, [{ name: 'page-1.png', content: imageDataUrl(bytes) }]);

    expect(spy.calls).toBe(1);
    const payload = JSON.parse(spy.contents) as Array<{
      parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
    }>;
    const parts = payload[0]!.parts;

    expect(parts[0]!.text).toMatch(/transcribe what is printed/i);
    expect(parts[1]!.inlineData!.mimeType).toBe('image/png');
    expect(parts[1]!.inlineData!.data).toBe(bytes.toString('base64'));
  });

  it('asks for a transcription and never for an answer key', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const spy = transcribing([transcribed()]);

    await upload(cookies, taxonomy);

    const cfg = spy.params[0]!.config as { responseSchema: unknown };
    const schema = JSON.stringify(cfg.responseSchema);

    // The model reports what is printed. It is never asked which option is correct, nor for a
    // typed answer field — those are conclusions, drawn by our own readers from `answer`.
    expect(schema).toContain('questionText');
    expect(schema).toContain('answer');
    expect(schema).not.toContain('isCorrect');
    expect(schema).not.toContain('booleanAnswer');
    expect(schema).not.toContain('numericAnswer');
    // Nor for the marks: a misread "(4 marks)" changes a child's score.
    expect(schema).not.toContain('marks');
  });

  it('forbids the model from working out an answer that is not printed', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const spy = transcribing([transcribed()]);

    await upload(cookies, taxonomy);

    // The single most consequential instruction in the prompt. Read from `spy.prompt` rather than
    // the serialised payload, and with a whitespace-tolerant pattern, because the instruction
    // wraps across two lines.
    expect(spy.prompt).toMatch(/never work out\s+the answer yourself/i);
    expect(spy.prompt).toMatch(/if no answer is printed anywhere on the page, return an empty string/i);
  });

  it('uses a low temperature, because transcription has one right answer', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const spy = transcribing([transcribed()]);

    await upload(cookies, taxonomy);

    // Generation deliberately uses 0.9 for variety between runs. Variety is the opposite of what
    // is wanted from an OCR pass.
    expect(spy.temperature).toBeLessThanOrEqual(0.2);
  });

  it('sends no student data at all', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const spy = transcribing([transcribed()]);

    // A real student exists, so the assertion is about what is *sent* rather than about an empty
    // database — the same property the generator's suite pins.
    await registerVerifyLogin(app, { email: 'pupil.image@example.com', mobile: '9800000921' });
    await upload(cookies, taxonomy);

    const sent = JSON.stringify(spy.params).toLowerCase();
    for (const forbidden of ['pupil.image@example.com', '9800000921', 'studentid', 'passwordhash', 'amit_']) {
      expect(sent).not.toContain(forbidden);
    }
  });

  it('describes the image from its bytes, not from what the client claimed', async () => {
    // A `.png` saved as `.jpg` is what cameras and messaging apps produce constantly. Describing it
    // by its claim would have the provider refuse a perfectly good image.
    expect(mimeTypeFor(pngBytes(), 'image/jpeg')).toBe('image/png');
    expect(mimeTypeFor(jpegBytes(), 'image/png')).toBe('image/jpeg');
    expect(mimeTypeFor(webpBytes(), 'image/png')).toBe('image/webp');
  });

  it('makes one call per image, which is the cost worth knowing', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const spy = transcribing([transcribed()]);

    await upload(cookies, taxonomy, [
      { name: 'page-1.png', content: imageDataUrl(pngBytes()) },
      { name: 'page-2.png', content: imageDataUrl(pngBytes(600)) },
      { name: 'page-3.jpg', content: imageDataUrl(jpegBytes(), 'image/jpeg') },
    ]);

    // Three photographs is three model calls. This is why `importLimiter` sits ahead of the
    // permission check on this route.
    expect(spy.calls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Turning a transcription into a candidate
// ---------------------------------------------------------------------------

describe('deriving the answer key from the transcription', () => {
  it('reads an option letter into the correct option', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ answer: 'C' })]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions).toHaveLength(1);
    const options = body.questions[0]!.options as Array<{ text: string; isCorrect: boolean }>;
    expect(options.map((o) => o.isCorrect)).toEqual([false, false, true, false]);
    // Nothing is saved by uploading — the property every phase re-asserts.
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('reads the answer with the same readers a spreadsheet goes through', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // `(b)` and `b` and `Option B` are one statement, and this phase added no new reading of it.
    transcribing([
      transcribed({ answer: '(b)' }),
      transcribed({
        questionNumber: '8',
        questionText: 'Which of these are prime?',
        options: ['$17$', '$21$', '$23$'],
        answer: 'A and C',
        solution: 'Neither has another divisor.',
      }),
    ]);

    const body = await upload(cookies, taxonomy);

    const first = body.questions[0]!.options as Array<{ isCorrect: boolean }>;
    expect(first.map((o) => o.isCorrect)).toEqual([false, true, false, false]);
    expect(body.questions[1]!.type).toBe('multiple_choice');
    const second = body.questions[1]!.options as Array<{ isCorrect: boolean }>;
    expect(second.map((o) => o.isCorrect)).toEqual([true, false, true]);
  });

  it('infers the other question types from what was printed', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([
      transcribed({
        questionNumber: '1',
        questionText: 'The angle sum of a triangle is $180$ degrees.',
        options: [],
        answer: 'TRUE',
        solution: 'True in Euclidean geometry.',
      }),
      transcribed({
        questionNumber: '2',
        questionText: 'A train covers $180$ km in $3$ hours. Find its speed in km/h.',
        options: [],
        answer: '60',
        solution: '$180 \\div 3 = 60$.',
      }),
      transcribed({
        questionNumber: '3',
        questionText: 'The value of $\\pi$ to two decimal places is ____.',
        options: [],
        answer: '3.14 | 3.14 approx',
        solution: '$\\pi = 3.14159\\ldots$',
      }),
    ]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions.map((q) => q.type)).toEqual(['true_false', 'numeric', 'fill_blank']);
    expect(body.questions[0]!.booleanAnswer).toBe(true);
    expect(body.questions[1]!.numericAnswer).toBe(60);
    expect(body.questions[2]!.acceptedAnswers).toEqual(['3.14', '3.14 approx']);
  });

  it("names a question by the page's own number", async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ questionNumber: '12(a)' })]);

    const body = await upload(cookies, taxonomy);

    // So a message points at something the examiner can find by looking at the photograph.
    expect(body.questions[0]!.sourceRef).toBe('page-1.png — Question 12(a)');
  });

  it('takes marks and class from the upload, never from the page', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);

    const body = await upload(cookies, taxonomy, undefined, {
      classLevel: 'Class 10',
      difficulty: 'Hard',
      marks: 6,
      negativeMarks: 2,
    });

    expect(body.questions[0]).toMatchObject({
      classLevel: 'Class 10',
      difficulty: 'Hard',
      marks: 6,
      negativeMarks: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// The refusal that matters most
// ---------------------------------------------------------------------------

describe('a question with no printed answer', () => {
  it('is refused rather than given one', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ answer: '' })]);

    const body = await upload(cookies, taxonomy);

    // The whole point: an answer nobody printed must never be invented. A calculated answer is
    // indistinguishable from a printed one, and real children would be marked against it.
    expect(body.questions).toHaveLength(0);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]!.reason).toMatch(/no answer is printed/i);
    expect(body.failures[0]!.reason).toMatch(/add the answer by hand/i);
  });

  it('does not lose the questions on the page that do have one', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([
      transcribed({ answer: '' }),
      transcribed({
        questionNumber: '8',
        questionText: 'What is $9 \\times 9$?',
        options: ['$81$', '$72$'],
        answer: 'A',
        solution: 'Nine nines.',
      }),
    ]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions).toHaveLength(1);
    expect(body.failures).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Extraction warnings the spec asks for
// ---------------------------------------------------------------------------

describe('extraction warnings', () => {
  it('always warns that a model read the images, on every import', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);

    const body = await upload(cookies, taxonomy);

    // Not boilerplate: OCR of mathematical notation fails quietly, and a reviewer who has not been
    // told this will skim.
    expect(warningTexts(body)).toContain(OCR_STANDING_WARNING);
    expect(warningTexts(body)).toMatch(/least reliable/i);
  });

  it('says it once for ten images, not ten times', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);

    const body = await upload(cookies, taxonomy, [
      { name: 'a.png', content: imageDataUrl(pngBytes()) },
      { name: 'b.png', content: imageDataUrl(pngBytes(600)) },
      { name: 'c.png', content: imageDataUrl(pngBytes(700)) },
    ]);

    const standing = body.batchWarnings.filter((w) => w.message === OCR_STANDING_WARNING);
    expect(standing).toHaveLength(1);
  });

  it('refuses a question the model reported as unreadable', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ unreadable: true })]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions).toHaveLength(0);
    expect(body.failures[0]!.reason).toMatch(/cut off, blurred or obscured/i);
    expect(body.failures[0]!.reason).toMatch(/re-photograph/i);
  });

  it("passes on the model's own uncertainty as a note", async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ uncertainty: 'The exponent on the second term was faint; it may be 2 or 3.' })]);

    const body = await upload(cookies, taxonomy);

    // Still a candidate — an honest note is far more useful than a refusal, and the reviewer is
    // the one who can compare it with the page.
    expect(body.questions).toHaveLength(1);
    expect(noteTexts(body.questions[0]!)).toMatch(/exponent on the second term was faint/i);
  });

  it('flags a question that needs a diagram, because there is nowhere to put one', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ referencesFigure: true })]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions).toHaveLength(1);
    expect(noteTexts(body.questions[0]!)).toMatch(/need a diagram or figure/i);
    expect(noteTexts(body.questions[0]!)).toMatch(/stores text and LaTeX only/i);
  });

  it('notes a missing solution and a missing option set appropriately', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([
      transcribed({ solution: '' }),
      // Read as a choice question by the option count, but with no options transcribed at all it
      // cannot be one.
      transcribed({ questionNumber: '9', questionText: 'Pick the even number below.', options: [], answer: 'B' }),
    ]);

    const body = await upload(cookies, taxonomy);

    expect(noteTexts(body.questions[0]!)).toMatch(/cannot be published/i);
    // `B` with no options is not a number and not a boolean, so it reads as fill-in-the-blank and
    // the screener has the final word on whether that is acceptable.
    expect(body.failures.length + body.rejected.length + body.questions.length).toBe(2);
  });

  it('reports an image that yielded nothing at all', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions).toHaveLength(0);
    // Actionable rather than "extraction failed".
    expect(body.failures[0]!.reason).toMatch(/in focus, right way up/i);
  });

  it('reports an answer letter that matches no transcribed option', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ answer: 'E' })]);

    const body = await upload(cookies, taxonomy);

    expect(body.failures[0]!.reason).toMatch(/does not match any of the options/i);
    expect(body.failures[0]!.reason).toMatch(/check the photograph against the answer key/i);
  });
});

// ---------------------------------------------------------------------------
// Provider failures
// ---------------------------------------------------------------------------

describe('when the provider fails', () => {
  it('answers 503 naming the variable when no key is configured', async () => {
    const { cookies, taxonomy } = await adminSetup();
    config.ai.geminiApiKey = undefined;

    const res = await request(app)
      .post(IMAGE_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [{ name: 'page-1.png', content: imageDataUrl(pngBytes()) }],
      });

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(500);
    // The rest of the importer must keep working without a model credential, so this failure has
    // to be specific to the image path and has to say what to set.
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("surfaces a spent quota in the provider's own words, per image", async () => {
    const { cookies, taxonomy } = await adminSetup();
    geminiFailing('Quota exceeded for this project', 429);

    const body = await upload(cookies, taxonomy);

    expect(body.success).toBe(true);
    expect(body.questions).toHaveLength(0);
    // A spent quota, an expired key and a blocked prompt need three different fixes, and only the
    // provider knows which happened.
    expect(body.files[0]!.error).toMatch(/quota/i);
  });

  it('keeps the images that worked when one call fails', async () => {
    const { cookies, taxonomy } = await adminSetup();
    let call = 0;
    geminiClient(() => {
      call += 1;
      if (call === 1) throw new Error('Gemini is temporarily unavailable');
      return { text: JSON.stringify([transcribed()]) };
    });

    const body = await upload(cookies, taxonomy, [
      { name: 'bad.png', content: imageDataUrl(pngBytes()) },
      { name: 'good.png', content: imageDataUrl(pngBytes(600)) },
    ]);

    // The spec's requirement: a failure for one image must not discard the remaining valid imports.
    expect(body.questions).toHaveLength(1);
    expect(body.files[0]!.error).toBeTruthy();
    expect(body.files[1]!.error).toBeNull();
  });

  it('reports prose where JSON was asked for, without a 500', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing('I could not read that image, sorry!');

    const body = await upload(cookies, taxonomy);

    expect(body.success).toBe(true);
    expect(body.files[0]!.error).toMatch(/usable JSON/i);
  });

  it('reports a blocked prompt', async () => {
    const { cookies, taxonomy } = await adminSetup();
    geminiClient(() => ({ promptFeedback: { blockReason: 'SAFETY' } }));

    const body = await upload(cookies, taxonomy);

    expect(body.files[0]!.error).toMatch(/blocked/i);
  });

  it('reports a truncated reply with the remedy for this route', async () => {
    const { cookies, taxonomy } = await adminSetup();
    geminiClient(() => ({ candidates: [{ finishReason: 'MAX_TOKENS' }] }));

    const body = await upload(cookies, taxonomy);

    // The generator says "ask for fewer questions"; here the fix is a different one, which is why
    // `requestGeminiJson` takes the hint as a parameter.
    expect(body.files[0]!.error).toMatch(/fewer questions per photograph|crop the page/i);
  });
});

// ---------------------------------------------------------------------------
// The shared gates
// ---------------------------------------------------------------------------

describe('the shared screener still applies', () => {
  it('rejects a transcription with two correct options on a single-choice question', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed({ answer: 'A, B' })]);

    const body = await upload(cookies, taxonomy, undefined, { questionType: 'single_choice' });

    expect(body.questions).toHaveLength(0);
    expect(body.rejected[0]!.reason).toMatch(/exactly one correct option/i);
  });

  it('rejects unbalanced LaTeX through the shared math validator', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // Exactly the sort of thing a misread page produces.
    transcribing([transcribed({ questionText: 'Solve for $x$: $x^2 - 5x + 6 = 0. What is the larger root?' })]);

    const body = await upload(cookies, taxonomy);

    expect(body.questions).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
  });

  it('detects the same question transcribed from two photographs', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);

    // Two pictures of the same page, which is exactly what happens when somebody photographs a
    // paper twice.
    const body = await upload(cookies, taxonomy, [
      { name: 'page-1.png', content: imageDataUrl(pngBytes()) },
      { name: 'page-1-again.png', content: imageDataUrl(pngBytes(600)) },
    ]);

    expect(body.questions).toHaveLength(1);
    expect(body.duplicates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Provenance — the one field worth lying about
// ---------------------------------------------------------------------------

describe('approving what an image produced', () => {
  it('stamps image_import AND records that a model produced the text', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);
    const preview = await upload(cookies, taxonomy);

    await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(201);

    const saved = await Question.findOne({});
    // Two separate facts, and both are needed: how it entered the bank, and that a model wrote the
    // text. Collapsing them would lose one or the other.
    expect(saved!.provenance.source).toBe('image_import');
    expect(saved!.provenance.generatorKind).toBe('model');
    expect(saved!.provenance.modelName).toBe(config.ai.geminiModel);
    expect(saved!.provenance.generatorId).toBe('gemini-vision');
    // Importing is not publishing.
    expect(saved!.status).toBe('draft');
  });

  it('records the batch as a model-read import', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);
    const preview = await upload(cookies, taxonomy);

    const batch = await ImportBatch.findById(preview.batchId);
    expect(batch).toMatchObject({ kind: 'image', extraction: 'model', accepted: 1 });
    expect(batch!.modelName).toBe(config.ai.geminiModel);
  });

  it('cannot be told it was hand-written', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);
    const preview = await upload(cookies, taxonomy);

    await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      // The one field worth lying about. It is read back from our own batch row, and a schema that
      // does not mention it means it cannot reach the handler at all.
      .send({
        batchId: preview.batchId,
        questions: preview.questions,
        provenance: { source: 'human' },
        source: 'human',
      })
      .expect(201);

    const saved = await Question.findOne({});
    expect(saved!.provenance.source).toBe('image_import');
  });
});

// ---------------------------------------------------------------------------
// Availability and authorization
// ---------------------------------------------------------------------------

describe('availability and authorization', () => {
  it('reports itself available and model-backed when a key is set', async () => {
    const { cookies } = await adminSetup();

    const res = await request(app)
      .get(`${API}/admin/questions/import`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    const image = (res.body.parsers as Array<{ kind: string; available: boolean; extraction: string }>).find(
      (p) => p.kind === 'image',
    );
    expect(image).toMatchObject({ available: true, extraction: 'model' });
  });

  it('reports itself unavailable with no key, while the other formats stay available', async () => {
    const { cookies } = await adminSetup();
    config.ai.geminiApiKey = undefined;

    const res = await request(app)
      .get(`${API}/admin/questions/import`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    const parsers = res.body.parsers as Array<{ kind: string; available: boolean }>;
    expect(parsers.find((p) => p.kind === 'image')!.available).toBe(false);
    // The rule that matters: no other feature may depend on an AI credential.
    expect(parsers.find((p) => p.kind === 'excel')!.available).toBe(true);
    expect(parsers.find((p) => p.kind === 'docx')!.available).toBe(true);
  });

  it('refuses a student on both URL prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app, { email: 'noimage@example.com', mobile: '9800000922' });

    for (const prefix of [API, ALIAS]) {
      const res = await request(app)
        .post(`${prefix}/admin/questions/import/image`)
        .set('Cookie', cookieHeader(cookies))
        .send({});
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(500);
    }
  });

  it('refuses a file that merely claims to be an image', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);

    const res = await request(app)
      .post(IMAGE_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        // Right MIME type, right extension, bytes that are not an image.
        files: [{ name: 'page.png', content: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` }],
      })
      .expect(400);

    expect(res.body.error).toMatch(/not a valid JPEG, PNG or WebP/i);
  });

  it('accepts all three image formats', async () => {
    const { cookies, taxonomy } = await adminSetup();
    transcribing([transcribed()]);

    const body = await upload(cookies, taxonomy, [
      { name: 'a.png', content: imageDataUrl(pngBytes()) },
      { name: 'b.jpg', content: imageDataUrl(jpegBytes(), 'image/jpeg') },
      { name: 'c.webp', content: imageDataUrl(webpBytes(), 'image/webp') },
    ]);

    expect(body.files).toHaveLength(3);
    for (const file of body.files) expect(file.error).toBeNull();
  });
});
