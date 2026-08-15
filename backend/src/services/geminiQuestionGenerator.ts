import { config } from '../config';
import { logger } from '../lib/logger';
import type { GeneratedCandidate, GenerationRequest, QuestionGenerator } from '../lib/questionGeneratorTypes';

/**
 * Question drafting with Google Gemini — the only place a language model is called
 * from this codebase.
 *
 * ## Why a model is right here, when it was wrong for recommendations
 *
 * Milestone 16 declined an LLM for performance recommendations and that still stands:
 * those are questions about counts, and arithmetic answers them exactly while a model
 * could only paraphrase it and get it wrong. Drafting a question is the opposite kind
 * of task — it is *writing*, there is nothing to compute, and the alternative is a
 * human typing it from scratch.
 *
 * The privacy objection does not transfer either. **No student data is sent.** The
 * whole payload is a subject name, chapter names, a class level, a difficulty, the
 * examiner's own instruction, and the text of questions already in the bank (which the
 * examiner wrote or approved). Nothing about any child leaves this system, and there is
 * a test asserting the request body contains no student fields.
 *
 * ## No SDK
 *
 * `fetch` against the REST endpoint. An SDK would add a dependency, a supply-chain
 * surface and a version to chase to save about twenty lines, and the retries it brings
 * are actively unwanted against a metered free tier — a failed generation should tell
 * the examiner immediately, not silently spend three more requests.
 *
 * ## The key is a header, not a query parameter
 *
 * `?key=` is documented and works, but a URL is the thing most likely to end up in a
 * log line, an error message or a proxy's access log. `x-goog-api-key` is not.
 */

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** A model call must never outlive a serverless invocation. */
const REQUEST_TIMEOUT_MS = 60_000;

export const GEMINI_GENERATOR_ID = 'gemini';

// ---------------------------------------------------------------------------
// The transport, and the test seam
// ---------------------------------------------------------------------------

export type GeminiTransport = (url: string, init: RequestInit) => Promise<Response>;

const realTransport: GeminiTransport = (url, init) => fetch(url, init);

let transport: GeminiTransport = realTransport;

/**
 * Test-only. Throws outside the test environment so it cannot be reached in production.
 *
 * A seam rather than a direct `fetch`, for the same reason `lib/email.ts` has
 * `failNextDeliveries()`: the paths worth testing are the failing ones — a spent quota,
 * a truncated reply, prose where JSON was asked for — and none of them can be produced
 * on demand against a real provider, or at all in a suite that must run offline.
 */
export function setGeminiTransport(next: GeminiTransport | null): void {
  if (!config.isTest) {
    throw new Error('setGeminiTransport() is a test-only hook and must not be called at runtime.');
  }
  transport = next ?? realTransport;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** The answer shape the model must produce, described per type. */
function answerContract(request: GenerationRequest): string[] {
  switch (request.questionType) {
    case 'single_choice':
      return [
        `  "options"        array of exactly ${request.optionCount} objects { "text": string, "isCorrect": boolean }.`,
        `                   EXACTLY ONE must have isCorrect true.`,
        `                   The wrong options must be plausible mistakes a student could really make`,
        `                   (a sign error, a swapped formula, an off-by-one) — never obviously silly,`,
        `                   never "none of the above", never joke answers.`,
        `  "booleanAnswer"  null.  "numericAnswer" null.  "tolerance" null.  "acceptedAnswers" [].`,
      ];
    case 'multiple_choice':
      return [
        `  "options"        array of exactly ${request.optionCount} objects { "text": string, "isCorrect": boolean }.`,
        `                   AT LEAST TWO correct, and NOT all of them.`,
        `                   Wrong options must be plausible, not filler.`,
        `  "booleanAnswer"  null.  "numericAnswer" null.  "tolerance" null.  "acceptedAnswers" [].`,
      ];
    case 'true_false':
      return [
        `  "options"        [] (empty).`,
        `  "booleanAnswer"  true or false — whether the STATEMENT in questionText is true.`,
        `  "numericAnswer"  null.  "tolerance" null.  "acceptedAnswers" [].`,
        `                   Do not write "True or False:" in the question text; just write the statement.`,
      ];
    case 'numeric':
      return [
        `  "options"        [] (empty).`,
        `  "numericAnswer"  the answer as a plain number (no units, no commas, no LaTeX).`,
        `  "tolerance"      absolute tolerance as a number; use 0 when the answer is exact.`,
        `                   Use a non-zero tolerance when the answer is irrational or rounded.`,
        `  "booleanAnswer"  null.  "acceptedAnswers" [].`,
        `                   State the required unit and rounding IN the question text, since only`,
        `                   the bare number is compared.`,
      ];
    case 'fill_blank':
      return [
        `  "options"        [] (empty).`,
        `  "acceptedAnswers" array of 1-6 strings: every spelling that should be marked correct.`,
        `                   Include the obvious variants a student would write, e.g. ["12 cm", "12cm"].`,
        `                   Matching ignores capitalisation, extra spaces and a trailing full stop,`,
        `                   so do NOT list those as separate entries.`,
        `  "booleanAnswer"  null.  "numericAnswer" null.  "tolerance" null.`,
        `                   Mark the blank in the question text with exactly one underscore run: ____`,
      ];
  }
}

/**
 * The instructions the model is held to.
 *
 * Several of these exist because of validation rules on *this* side of the boundary, and
 * getting them wrong shows up as a rejected candidate rather than as bad data: maths
 * must be `$…$` islands, the forbidden LaTeX commands are refused outright, and the
 * per-type answer shape is enforced by `refineQuestionAnswers`. Saying so up front is
 * much cheaper than round-tripping rejections against a metered quota.
 *
 * The examiner's own text goes at the end, fenced. It is staff-authored and
 * staff-reviewed, and nothing the model returns is trusted regardless.
 */
function buildPrompt(request: GenerationRequest): string {
  const chapters = request.chapters.map((chapter) => chapter.name).join(', ');

  const lines = [
    `You are an experienced examiner writing questions for the AMIT Maths Olympiad, a national-level competition for Indian school students.`,
    ``,
    `Write ${request.count} ORIGINAL, exam-quality question(s).`,
    ``,
    `  Subject:    ${request.subjectName}`,
    `  Chapter(s): ${chapters}`,
    `  Class:      ${request.classLevel}`,
    `  Difficulty: ${request.difficulty}`,
    `  Type:       ${request.questionType}`,
    `  Language:   ${request.language}`,
    `  Marks:      ${request.marks} per question`,
  ];

  if (request.bloomLevel) {
    lines.push(`  Cognitive level (Bloom's): ${request.bloomLevel} — the task the student must perform.`);
  }

  if (request.chapters.length > 1) {
    lines.push(``, `Spread the questions across the listed chapters rather than drawing them all from one.`);
  }

  lines.push(
    ``,
    `These are for a real examination paper. Every question must be complete, unambiguous,`,
    `solvable from its own text alone, and correct at ${request.classLevel} level. Do not write`,
    `placeholders, samples, templates or "example" text of any kind.`,
    ``,
    `Return ONLY a JSON array. No prose, no markdown fences. Each element is an object with exactly these keys:`,
    `  "questionText"   string, the question itself.`,
    ...answerContract(request),
    `  "solution"       string, a worked explanation showing HOW the answer is reached — not just`,
    `                   a restatement of it. Required.`,
    `  "marks"          ${request.marks}`,
    `  "negativeMarks"  ${request.negativeMarks}`,
    `  "tags"           array of at most 5 short lowercase topic tags.`,
    ``,
    `Formatting rules. These are enforced, and a question that breaks one is discarded:`,
    `  - Write ALL mathematics as LaTeX between single dollar signs: $x^2 + 5x + 6 = 0$.`,
    `  - Do NOT use \\href, \\url, \\includegraphics, \\input, \\include, \\def or \\newcommand.`,
    `  - Do NOT use HTML tags, markdown, or code fences anywhere.`,
    `  - Keep each LaTeX island under 500 characters.`,
    `  - Never refer to a diagram, figure, graph or image: questions are text and LaTeX only.`,
    `  - Two options must never have the same text.`,
  );

  if (request.language !== 'English') {
    lines.push(
      `  - Write the prose in ${request.language}. Keep mathematical notation in LaTeX as normal.`,
    );
  }

  if (request.avoid.length > 0) {
    lines.push(
      ``,
      `These questions ALREADY EXIST. Do not reproduce them, and do not write a question that`,
      `merely changes their numbers — write genuinely different ones:`,
      ...request.avoid.slice(0, 40).map((text) => `  - ${text.slice(0, 160)}`),
    );
  }

  if (request.instructions) {
    lines.push(``, `Additional instructions from the examiner:`, `"""`, request.instructions, `"""`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/**
 * Pulls the JSON array out of the model's reply.
 *
 * `responseMimeType: 'application/json'` makes a fenced or prose-wrapped answer unlikely
 * rather than impossible, so the fence stripping stays. Anything still not an array
 * throws: a generator that returned prose has failed, and guessing at what it meant is
 * how bad data gets in.
 */
function extractCandidates(raw: string): unknown[] {
  let text = raw.trim();

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('The model returned JSON that was not an array of questions.');
  }
  return parsed;
}

/**
 * Coerces one element into the candidate shape **without validating it**.
 *
 * Deliberately permissive: this is a shape adapter, not a gate. The real gate is
 * `createQuestionSchema` in the service — the same one a human author passes. Two gates
 * in two places would be two things to disagree, and the model-facing one would be the
 * weaker.
 */
function toCandidate(value: unknown, request: GenerationRequest): GeneratedCandidate {
  const row = (value ?? {}) as Record<string, unknown>;
  const rawOptions = Array.isArray(row.options) ? row.options : [];

  return {
    questionText: typeof row.questionText === 'string' ? row.questionText : '',
    // The requested type wins over whatever the model labelled it: the reviewer asked
    // for one shape, and a mislabelled candidate should fail validation loudly rather
    // than quietly become a different kind of question.
    type: request.questionType,
    options: rawOptions.map((option) => {
      const entry = (option ?? {}) as Record<string, unknown>;
      return { text: typeof entry.text === 'string' ? entry.text : '', isCorrect: entry.isCorrect === true };
    }),
    booleanAnswer: typeof row.booleanAnswer === 'boolean' ? row.booleanAnswer : null,
    numericAnswer: typeof row.numericAnswer === 'number' ? row.numericAnswer : null,
    tolerance: typeof row.tolerance === 'number' ? row.tolerance : null,
    acceptedAnswers: Array.isArray(row.acceptedAnswers)
      ? row.acceptedAnswers.filter((entry): entry is string => typeof entry === 'string').slice(0, 8)
      : [],
    solution: typeof row.solution === 'string' ? row.solution : null,
    // The paper's price, not the model's opinion of it.
    marks: request.marks,
    negativeMarks: request.negativeMarks,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 5) : [],
  };
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

export const geminiQuestionGenerator: QuestionGenerator = {
  descriptor: {
    id: GEMINI_GENERATOR_ID,
    label: 'Google Gemini',
    kind: 'model',
    basis:
      'Written by Google Gemini from the subject, chapters, class and difficulty you chose. ' +
      'No student data is sent. Every question is checked by the same rules as a hand-written ' +
      'one, and nothing is saved until you approve it.',
  },

  isAvailable() {
    return Boolean(config.ai.geminiApiKey);
  },

  async generate(request: GenerationRequest): Promise<GeneratedCandidate[]> {
    const apiKey = config.ai.geminiApiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

    const url = `${ENDPOINT_BASE}/${encodeURIComponent(config.ai.geminiModel)}:generateContent`;

    let response: Response;
    try {
      response = await transport(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(request) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            // Some variety between runs: an examiner who generates twice wants two
            // different sets, not the same one twice.
            temperature: 0.9,
            maxOutputTokens: 8192,
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout arrives as an AbortError, and it is worth naming separately: "it took
      // too long" and "it refused" need different reactions from an examiner.
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      const failure: Error & { cause?: unknown } = new Error(`Gemini ${reason}.`);
      failure.cause = err;
      throw failure;
    }

    const body = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok) {
      // The provider's own words: an expired key, a spent quota and an unknown model
      // all need different fixes, and "it failed" cannot be acted on.
      throw new Error(`Gemini refused the request: ${body.error?.message ?? `HTTP ${response.status}`}`);
    }

    if (body.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request (${body.promptFeedback.blockReason}).`);
    }

    const first = body.candidates?.[0];
    const text = first?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Gemini returned no content${first?.finishReason ? ` (${first.finishReason})` : ''}.`);
    }

    if (first?.finishReason === 'MAX_TOKENS') {
      logger.warn({ requested: request.count }, 'Gemini hit its output limit — expect fewer questions than requested');
    }

    return extractCandidates(text).map((value) => toCandidate(value, request));
  },
};
