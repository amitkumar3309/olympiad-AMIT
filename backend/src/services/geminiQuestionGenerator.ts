import { config } from '../config';
import { logger } from '../lib/logger';
import { QUESTION_TYPES } from '../models';
import type { GeneratedCandidate, GenerationRequest, QuestionGenerator } from '../lib/questionGeneratorTypes';

/**
 * Question drafting with Google Gemini — the first and only place a language model is
 * called from this codebase.
 *
 * ## Why a model is the right tool *here*, when it was the wrong one for recommendations
 *
 * Milestone 16 declined an LLM for performance recommendations, and that reasoning
 * still stands: those are questions about counts, and arithmetic answers them exactly
 * while a model could only paraphrase it and get it wrong. Drafting a question is the
 * opposite kind of task — it is *writing*, there is no correct answer to compute, and
 * the alternative is a human typing it from scratch.
 *
 * The privacy objection also does not transfer. **No student data is sent.** The entire
 * payload is a subject name, a topic name, a class level, a difficulty and an optional
 * instruction the administrator typed. Nothing about any child leaves this system, and
 * there is a test asserting the request body contains no student fields.
 *
 * ## No SDK
 *
 * This calls the REST endpoint with `fetch`, which Node has had built in since 18. An
 * SDK would add a dependency, a supply-chain surface and a version to chase, to save
 * about twenty lines. The two things an SDK would genuinely give — retries and typed
 * responses — are not wanted here anyway: a failed draft generation should fall back to
 * the template generator immediately rather than retry against a metered quota, and the
 * response is validated by zod regardless of what any type claims.
 *
 * ## The key is a header, not a query parameter
 *
 * `?key=` is documented and works, but a URL is the thing most likely to end up in a
 * log line, an error message or a proxy's access log. `x-goog-api-key` is not.
 */

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** A model call must never outlive a serverless invocation. */
const REQUEST_TIMEOUT_MS = 45_000;

export const GEMINI_GENERATOR_ID = 'gemini';

// ---------------------------------------------------------------------------
// The transport, and the test seam
// ---------------------------------------------------------------------------

/**
 * What the generator uses to reach the provider. A seam rather than a direct `fetch`
 * call, for the same reason `lib/email.ts` has `failNextDeliveries()`: the paths worth
 * testing are the failing ones — a spent quota, a truncated response, a model that
 * returns prose where JSON was asked for — and none of them can be produced reliably by
 * calling a real API, or produced at all in a suite that must run offline.
 */
export type GeminiTransport = (url: string, init: RequestInit) => Promise<Response>;

const realTransport: GeminiTransport = (url, init) => fetch(url, init);

let transport: GeminiTransport = realTransport;

/** Test-only. Throws outside the test environment so it cannot be reached in production. */
export function setGeminiTransport(next: GeminiTransport | null): void {
  if (!config.isTest) {
    throw new Error('setGeminiTransport() is a test-only hook and must not be called at runtime.');
  }
  transport = next ?? realTransport;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The instructions the model is held to.
 *
 * Three of these exist because of validation rules on this side of the boundary, and
 * getting them wrong shows up as a rejected candidate rather than as bad data: maths
 * must be `$…$` islands (`lib/mathContent.ts` parses them), the forbidden LaTeX
 * commands are refused outright, and the per-type answer shape is enforced by
 * `refineQuestionAnswers`. Saying so up front is much cheaper than round-tripping
 * rejections.
 *
 * The administrator's own text is included as *data at the end*, clearly fenced. It is
 * staff-authored and staff-reviewed, and nothing the model returns is trusted anyway —
 * every candidate goes through the same schema a human's question does.
 */
function buildPrompt(request: GenerationRequest): string {
  const lines = [
    `You are helping an examiner draft questions for the AMIT Maths Olympiad, an Indian school-level competition.`,
    ``,
    `Write ${request.count} original ${request.difficulty.toLowerCase()} question(s) on:`,
    `  Subject: ${request.subjectName}`,
    `  Topic: ${request.topicName}`,
    `  Class: ${request.classLevel}`,
    ``,
    `Return ONLY a JSON array. No prose, no markdown fences. Each element must be an object with exactly these keys:`,
    `  "questionText"   string, the question. Required.`,
    `  "type"           one of ${QUESTION_TYPES.map((type) => `"${type}"`).join(', ')}.`,
    `  "options"        array of { "text": string, "isCorrect": boolean }.`,
    `                   For single_choice: 2-6 options, EXACTLY ONE correct, and they must not all be correct.`,
    `                   For multiple_choice: 3-6 options, AT LEAST TWO correct, but not all of them.`,
    `                   For true_false and numeric: an empty array [].`,
    `  "booleanAnswer"  true or false for type true_false; otherwise null.`,
    `  "numericAnswer"  a finite number for type numeric; otherwise null.`,
    `  "tolerance"      a non-negative number for type numeric (use 0 for exact); otherwise null.`,
    `  "solution"       string, a short worked explanation. Required.`,
    `  "marks"          number between 1 and 10.`,
    `  "negativeMarks"  number between 0 and marks.`,
    `  "tags"           array of at most 5 short lowercase strings.`,
    ``,
    `Formatting rules, which are enforced and will cause a question to be discarded if broken:`,
    `  - Write mathematics as LaTeX between single dollar signs, e.g. $x^2 + 5x + 6 = 0$.`,
    `  - Do NOT use \\href, \\url, \\includegraphics, \\input, \\include, \\def or \\newcommand.`,
    `  - Do NOT use HTML tags, markdown, or code fences anywhere.`,
    `  - Keep each LaTeX island under 500 characters.`,
    `  - Two options must never have the same text.`,
    `  - Do not reference a diagram, figure or image: questions are text and LaTeX only.`,
    ``,
    `Every question must be answerable from its own text, and the marked answer must be correct.`,
  ];

  if (request.instructions) {
    lines.push(
      ``,
      `Additional instructions from the examiner (treat as guidance about the questions only):`,
      `"""`,
      request.instructions,
      `"""`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/**
 * Pulls the JSON array out of the model's reply.
 *
 * `responseMimeType: 'application/json'` makes a fenced or prose-wrapped answer
 * unlikely rather than impossible, so the fence stripping stays. Anything that is still
 * not an array throws, and the service falls back — a generator that returned prose has
 * failed, and guessing at what it meant is how bad data gets in.
 */
function extractCandidates(raw: string): unknown[] {
  let text = raw.trim();

  // ```json … ``` or ``` … ```
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('The model returned JSON that was not an array of questions.');
  }
  return parsed;
}

/**
 * Coerces one element into the candidate shape without validating it.
 *
 * Deliberately permissive: this is a *shape* adapter, not a gate. The real gate is
 * `createQuestionSchema` in the service, which is the same one a human author passes.
 * Two checks in two places would be two places to disagree, and the model-facing one
 * would be the weaker.
 */
function toCandidate(value: unknown): GeneratedCandidate {
  const row = (value ?? {}) as Record<string, unknown>;
  const rawOptions = Array.isArray(row.options) ? row.options : [];

  return {
    questionText: typeof row.questionText === 'string' ? row.questionText : '',
    type: (typeof row.type === 'string' ? row.type : 'single_choice') as GeneratedCandidate['type'],
    options: rawOptions.map((option) => {
      const entry = (option ?? {}) as Record<string, unknown>;
      return {
        text: typeof entry.text === 'string' ? entry.text : '',
        isCorrect: entry.isCorrect === true,
      };
    }),
    booleanAnswer: typeof row.booleanAnswer === 'boolean' ? row.booleanAnswer : null,
    numericAnswer: typeof row.numericAnswer === 'number' ? row.numericAnswer : null,
    tolerance: typeof row.tolerance === 'number' ? row.tolerance : null,
    solution: typeof row.solution === 'string' ? row.solution : null,
    marks: typeof row.marks === 'number' ? row.marks : 4,
    negativeMarks: typeof row.negativeMarks === 'number' ? row.negativeMarks : 0,
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
    // A real language model really does write this text, so this is the one place in
    // the product where 'model' is the truthful answer.
    kind: 'model',
    basis:
      'Drafted by Google Gemini from the subject, topic, class and difficulty you chose. ' +
      'No student data is sent. Every draft is checked by the same rules as a hand-written ' +
      'question and must still be reviewed and published by you.',
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
        headers: {
          'content-type': 'application/json',
          // Not `?key=` — see the header note at the top of this file.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(request) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            // Some variety between runs, since an examiner generating twice wants two
            // different sets rather than the same one twice.
            temperature: 0.8,
            maxOutputTokens: 8192,
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout arrives here as an AbortError, which is worth naming: "it took too
      // long" and "it refused" need different reactions from an administrator.
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      // `cause` is assigned rather than passed to the constructor: this package targets
      // ES2020, where the two-argument `Error` signature is not typed, even though the
      // Node runtime under it supports the property.
      const failure: Error & { cause?: unknown } = new Error(`Gemini ${reason}.`);
      failure.cause = err;
      throw failure;
    }

    const body = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok) {
      // The provider's own words, because "it failed" is not an actionable message —
      // an expired key, a spent quota and an unknown model all need different fixes.
      const detail = body.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Gemini refused the request: ${detail}`);
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
      // Truncated JSON usually fails to parse anyway, but when it does parse it yields
      // a short list, which would otherwise look like the model simply chose to write
      // fewer questions.
      logger.warn({ requested: request.count }, 'Gemini hit its output limit — fewer questions than requested');
    }

    return extractCandidates(text).map(toCandidate);
  },
};
