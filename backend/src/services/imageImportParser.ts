import type { Schema } from '@google/genai' with { 'resolution-mode': 'import' };
import { config } from '../config';
import { logger } from '../lib/logger';
import { QUESTION_TYPES, type QuestionType } from '../models/Question';
import {
  inferType,
  readAcceptedAnswers,
  readBoolean,
  readCorrectOptions,
} from '../lib/importAnswerText';
import { requestGeminiJson } from './geminiQuestionGenerator';
import type {
  ImportDefaults,
  ImportParser,
  ImportedCandidate,
  ParseFailure,
  ParseInput,
  ParseOutcome,
} from '../lib/importTypes';

/**
 * Reading questions off a photograph (Milestone 21, Phase E).
 *
 * ## Why a model here, when DOCX deliberately refuses one
 *
 * The Phase D ADR declined AI for Word documents because a `.docx` *is text we already have* — a
 * model would add cost, latency and a third party to recover something already recoverable. A
 * photograph is the opposite case: **there is no text at all**, and OCR is the only way in. So this
 * is not a reversal of that decision, it is the case that decision was drawn around.
 *
 * It follows that the image path is the **only** importer that is not deterministic, that spends
 * provider quota, and that reports `extraction: 'model'`. All three are stated as facts rather than
 * smoothed over: `Question.provenance` records `image_import` **and** `generatorKind: 'model'` with
 * the model's name, because "this came from a photograph" and "a model produced this text" are two
 * different things somebody will eventually need to ask about.
 *
 * ## The model transcribes; our own code decides what the answer means
 *
 * This is the important design decision, and it is what keeps the format from needing a validator
 * of its own. The response schema asks for **what is printed on the page** — the question, the
 * option texts, and the answer *as written* (`"B"`, `"TRUE"`, `"60"`, `"3.14"`) as a plain string.
 * It does **not** ask the model to fill in `booleanAnswer`, `numericAnswer` or `isCorrect` flags.
 *
 * Those are then interpreted by `lib/importAnswerText.ts` — the same readers a spreadsheet cell and
 * an `Answer: B` line in Word go through. So "the answer is B" means the same thing in all three
 * formats, and this phase needed **no new answer reading at all**, which is exactly what that
 * module's existence promised. It also narrows the model's job to the one thing it is good at
 * (reading pixels) and keeps the thing that must not be wrong (what counts as correct) in code.
 *
 * ## Honest about what OCR cannot promise
 *
 * `lib/questionQuality.ts` annotates and never rejects, and the same rule governs here — but this
 * parser goes further and attaches a **standing warning to every image import**, because
 * mathematical notation is precisely where OCR is least reliable: a lost exponent, a misread minus,
 * a fraction flattened into a division all produce a question that reads plausibly and is wrong.
 * Nothing in this module may imply the transcription is verified. The review step is not a
 * formality here; it is the only thing standing between a photograph and a wrong answer key.
 *
 * **Diagrams cannot be imported in any format** — `Question` has no image field — so a question
 * whose meaning depends on a figure is flagged rather than half-imported.
 *
 * ## No student data, and no second client
 *
 * The payload is an image the examiner chose plus a fixed instruction. Nothing about any child is
 * sent, and there is a test asserting it. The call goes through `requestGeminiJson()` — the one
 * Gemini call in the codebase — so the client, the retry policy, the shared deadline, the
 * redaction and the error phrasing are all the generator's, not a copy of them.
 */

export const IMAGE_PARSER_ID = 'gemini-vision';

/**
 * The most questions one photograph may yield.
 *
 * A page of an exam paper holds perhaps a dozen; a generous ceiling bounds a runaway reply without
 * refusing a densely-printed page. It also sizes the output budget below.
 */
const MAX_PER_IMAGE = 30;

/** Room for the reply. Scaled like the generator's, and for the same MAX_TOKENS reason. */
function outputBudget(count: number): number {
  return Math.min(32_768, 4_096 + 1_200 * count);
}

// ---------------------------------------------------------------------------
// The response shape
// ---------------------------------------------------------------------------

/**
 * What the model is asked to return: **a transcription, not an answer key.**
 *
 * Every field here is something printed on the page. There is deliberately no `type`, no
 * `isCorrect`, no `booleanAnswer` and no `numericAnswer` — those are conclusions, and they are
 * drawn by `lib/importAnswerText.ts` from the transcribed answer text instead. What is not in the
 * schema cannot come back to be misinterpreted.
 *
 * `marks` is absent for the same reason it is absent from the generator's schema, and more sharply:
 * a misread "(4 marks)" changes a child's score, and the examiner is setting the marks for the
 * upload anyway.
 */
function responseSchema(): Schema {
  // Built with plain string literals rather than the SDK's `Type` enum so this module needs no
  // runtime import of the SDK at all — the one `require` of it stays in the generator.
  return {
    type: 'ARRAY',
    maxItems: String(MAX_PER_IMAGE),
    items: {
      type: 'OBJECT',
      properties: {
        questionNumber: {
          type: 'STRING',
          description: 'The question number exactly as printed (e.g. "7", "Q7", "12(a)"). Empty string if none is visible.',
        },
        questionText: {
          type: 'STRING',
          description:
            'The question exactly as printed, with all mathematics transcribed as LaTeX between single dollar signs, e.g. $x^2 + 5x + 6 = 0$. Do not solve it, do not rephrase it, do not correct it.',
        },
        options: {
          type: 'ARRAY',
          description:
            'The answer options as printed, in order, WITHOUT their (a)/(b) markers. An empty array if the question has no printed options.',
          items: { type: 'STRING' },
          maxItems: '8',
        },
        answer: {
          type: 'STRING',
          description:
            'The correct answer EXACTLY as printed on the page — an option letter such as "B", or "TRUE", or a number such as "60". Empty string if no answer is printed anywhere on the page. Never work the answer out yourself.',
        },
        solution: {
          type: 'STRING',
          description: 'The printed solution or explanation, if the page shows one. Empty string otherwise.',
        },
        referencesFigure: {
          type: 'BOOLEAN',
          description:
            'True if answering this question requires a diagram, figure, graph, table or picture. Judge this from the question itself, not from whether one is visible.',
        },
        unreadable: {
          type: 'BOOLEAN',
          description: 'True if this question is cut off, blurred, obscured or otherwise not fully legible.',
        },
        uncertainty: {
          type: 'STRING',
          description:
            'What you were unsure about while transcribing this question — a symbol you had to guess, faint text, an ambiguous exponent. Empty string if the whole question was clearly legible.',
        },
      },
      required: [
        'questionNumber',
        'questionText',
        'options',
        'answer',
        'solution',
        'referencesFigure',
        'unreadable',
        'uncertainty',
      ],
      propertyOrdering: [
        'questionNumber',
        'questionText',
        'options',
        'answer',
        'solution',
        'referencesFigure',
        'unreadable',
        'uncertainty',
      ],
    },
  } as Schema;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The instruction the model is held to.
 *
 * Its whole thrust is **transcribe, do not think**. Every failure mode worth guarding against here
 * is the model being *helpful*: solving a question whose answer is not printed, correcting a typo,
 * rephrasing a clumsy sentence, or filling in an option it could not read. Each of those produces
 * something that looks right and is not what is on the page — and unlike a generated question,
 * which a reviewer reads on its own merits, a transcription is checked *against an original* the
 * reviewer may not have to hand.
 *
 * There is no examiner-supplied text in this prompt at all, so the prompt-injection ordering the
 * generator has to worry about does not arise. The image itself is untrusted input, but nothing it
 * contains is treated as an instruction — anything the model returns goes through
 * `createQuestionSchema` like every other candidate.
 */
function buildPrompt(): string {
  return [
    'You are transcribing questions from a photograph of a mathematics examination paper for an Indian school competition.',
    '',
    'Your job is to TRANSCRIBE what is printed, not to answer, improve or interpret it.',
    '',
    'Rules:',
    '  - Copy each question exactly as printed. Do not rephrase, correct, shorten or translate it.',
    '  - Transcribe ALL mathematics as LaTeX between single dollar signs: $x^2 + 5x + 6 = 0$,',
    '    $\\frac{3}{4}$, $\\sqrt{49}$, $30^\\circ$. Take care with exponents, fractions, minus signs',
    '    and roots — these are the marks most often misread.',
    '  - Do NOT use \\href, \\url, \\includegraphics, \\input, \\include, \\def or \\newcommand, and no',
    '    HTML, markdown or code fences anywhere.',
    '  - Give the options as printed, in order, WITHOUT their (a)/(b)/(c) markers.',
    '  - For "answer", copy the answer key EXACTLY as printed — "B", "TRUE", "60", "3.14".',
    '    **If no answer is printed anywhere on the page, return an empty string.** Never work out',
    '    the answer yourself: an answer you calculated is indistinguishable from one that was',
    '    printed, and it will be marked as correct for real students.',
    '  - Set "unreadable" true for any question that is cut off, blurred or obscured. Do not guess',
    '    at missing words to fill the gap.',
    '  - Set "referencesFigure" true if the question cannot be answered without a diagram, graph or',
    '    table. Say so even if the figure is clearly visible in the image.',
    '  - Put anything you had to guess at in "uncertainty". An honest note there is far more useful',
    '    than a confident transcription.',
    '  - Ignore page furniture: headings, marks allocations, instructions, page numbers, watermarks.',
    '',
    'Return every question visible in the image. If the image contains no questions at all, return an empty array.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Reading the reply
// ---------------------------------------------------------------------------

/** One transcribed question, before any interpretation. */
interface Transcribed {
  questionNumber: string;
  questionText: string;
  options: string[];
  answer: string;
  solution: string;
  referencesFigure: boolean;
  unreadable: boolean;
  uncertainty: string;
}

/**
 * Coerces the reply into the transcription shape **without validating it**.
 *
 * Permissive on purpose, exactly like `toCandidate()` in the generator: this is a shape adapter and
 * the real gate is `createQuestionSchema`, applied by the import service. Two gates in two places
 * would be two things to disagree, and the model-facing one would be the weaker.
 */
function toTranscribed(value: unknown): Transcribed {
  const row = (value ?? {}) as Record<string, unknown>;
  const str = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string).trim() : '');

  return {
    questionNumber: str('questionNumber'),
    questionText: str('questionText'),
    options: Array.isArray(row.options)
      ? row.options.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).slice(0, 8)
      : [],
    answer: str('answer'),
    solution: str('solution'),
    referencesFigure: row.referencesFigure === true,
    unreadable: row.unreadable === true,
    uncertainty: str('uncertainty'),
  };
}

function parseReply(raw: string): Transcribed[] {
  let text = raw.trim();

  // With `responseSchema` set a fenced reply is close to impossible rather than merely unlikely,
  // but the stripping costs two lines and the alternative when it happens is a lost image.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The model did not return usable JSON for this image. Try again, or upload a clearer photograph.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('The model returned JSON that was not a list of questions.');
  }
  return parsed.map(toTranscribed);
}

// ---------------------------------------------------------------------------
// Transcription to candidate
// ---------------------------------------------------------------------------

type ItemOutcome =
  | { kind: 'candidate'; candidate: ImportedCandidate }
  | { kind: 'failure'; failure: ParseFailure };

/**
 * Turns one transcription into a candidate, or names why it cannot be one.
 *
 * The type and the answer key are worked out **here**, by the shared readers, from the answer text
 * the model copied off the page — see the note at the top of this file for why that division
 * matters.
 */
export function toCandidateFrom(
  item: Transcribed,
  position: number,
  defaults: ImportDefaults,
): ItemOutcome {
  // The page's own number where there was one, so a message points at something the examiner can
  // find by looking at the photograph.
  const label = item.questionNumber.length > 0 ? `Question ${item.questionNumber}` : `Question ${position + 1}`;
  const sourceRef = label;
  const fail = (reason: string): ItemOutcome => ({ kind: 'failure', failure: { sourceRef, reason } });

  if (item.unreadable) {
    return fail('The model reported this question as cut off, blurred or obscured. Re-photograph the page and try again.');
  }
  if (item.questionText.length === 0) {
    return fail('No question text could be read here.');
  }
  if (item.answer.length === 0) {
    // The single most important refusal in this parser. A question with no printed answer must
    // never acquire one — see the prompt, which forbids the model from working it out.
    return fail(
      'No answer is printed on the page for this question, so there is nothing to mark against. Add the answer by hand after importing, or upload a page that includes the answer key.',
    );
  }

  const notes: string[] = [];

  // ---- Type: the examiner's default, or inferred from the transcription ----
  let type: QuestionType;
  if (defaults.questionType) {
    type = defaults.questionType;
  } else {
    const inferred = inferType(item.options.length, item.answer);
    type = inferred.type;
    notes.push(inferred.note);
  }

  const answer = readAnswerFor(type, item.answer, item.options, notes);
  if ('reason' in answer) return fail(answer.reason);

  if (item.uncertainty.length > 0) {
    notes.push(`The model was unsure about part of this question: ${item.uncertainty}`);
  }
  if (item.referencesFigure) {
    // Not a refusal: the *text* may still be worth keeping and the examiner may be able to reword
    // it. But it cannot be imported as-is, because there is nowhere to put the figure.
    notes.push(
      'This question appears to need a diagram or figure. The question bank stores text and LaTeX only, so it cannot be imported complete — reword it to be answerable from its text, or leave it out.',
    );
  }
  if (item.solution.length === 0) {
    notes.push('No solution was printed. The question can be saved as a draft but cannot be published until one is added.');
  }

  return {
    kind: 'candidate',
    candidate: {
      content: {
        questionText: item.questionText,
        type,
        options: answer.options,
        booleanAnswer: answer.booleanAnswer,
        numericAnswer: answer.numericAnswer,
        tolerance: null,
        acceptedAnswers: answer.acceptedAnswers,
        solution: item.solution.length > 0 ? item.solution : null,
        // Never read off the page: a misread "(4 marks)" changes a child's score, and the examiner
        // is setting the price for this upload anyway.
        marks: defaults.marks,
        negativeMarks: defaults.negativeMarks,
        tags: [],
      },
      /**
       * A photograph is asked for **no taxonomy at all**, so every field is null and the examiner's
       * upload defaults apply. Reading "Class 8" off a page header is exactly the kind of plausible
       * misreading that would file a question under the wrong cohort — and unlike a spreadsheet
       * column, a printed header is not a per-question statement anyway.
       */
      taxonomy: { classLevel: null, topicName: null, subtopicName: null, difficulty: null },
      sourceRef,
      notes,
    },
  };
}

/** The answer fields for one type, or the reason the transcription could not supply them. */
function readAnswerFor(
  type: QuestionType,
  answerText: string,
  options: readonly string[],
  notes: string[],
): { reason: string } | {
  options: Array<{ text: string; isCorrect: boolean }>;
  booleanAnswer: boolean | null;
  numericAnswer: number | null;
  acceptedAnswers: string[];
} {
  const empty = { options: [], booleanAnswer: null, numericAnswer: null, acceptedAnswers: [] };

  if (type === 'single_choice' || type === 'multiple_choice') {
    if (options.length === 0) {
      return { reason: `This was read as a ${type.replace('_', '-')} question but no options could be read from the image.` };
    }
    if (options.some((text) => text.length === 0)) {
      return { reason: 'One of the options could not be read from the image.' };
    }

    const { positions, unresolved } = readCorrectOptions(answerText, options);
    if (unresolved.length > 0) {
      return {
        reason: `The printed answer "${unresolved.join('", "')}" does not match any of the options that were read. Check the photograph against the answer key.`,
      };
    }
    if (positions.length === 0) {
      return { reason: `The printed answer "${answerText}" could not be matched to any option.` };
    }

    return { ...empty, options: options.map((text, index) => ({ text, isCorrect: positions.includes(index) })) };
  }

  if (options.length > 0) {
    notes.push(
      `Options were read from the image, but a ${type.replace('_', '/')} question has none, so they were ignored.`,
    );
  }

  if (type === 'true_false') {
    const booleanAnswer = readBoolean(answerText);
    if (booleanAnswer === null) {
      return { reason: `The printed answer "${answerText}" is not a true/false answer.` };
    }
    return { ...empty, booleanAnswer };
  }

  if (type === 'numeric') {
    const numericAnswer = Number(answerText.replace(/[\s,]/gu, ''));
    if (!Number.isFinite(numericAnswer)) {
      return { reason: `The printed answer "${answerText}" is not a number.` };
    }
    return { ...empty, numericAnswer };
  }

  const acceptedAnswers = readAcceptedAnswers(answerText);
  if (acceptedAnswers.length === 0) return { reason: 'No usable answer could be read.' };
  return { ...empty, acceptedAnswers };
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/**
 * The warning attached to **every** image import, without exception.
 *
 * Not a hedge, and not boilerplate to be trimmed later. OCR of mathematical notation is where
 * transcription is least reliable, and its failures are the quiet kind: a dropped exponent, a
 * minus read as a hyphen, a fraction flattened. The result reads plausibly and is wrong, which is
 * exactly the failure the whole review step exists to catch — and a reviewer who has not been told
 * this will skim.
 *
 * The first live run of the *generator* returned a well-formatted question with a wrong answer key,
 * which is why `lib/questionQuality.ts` keeps its claims narrow. The same caution applies here with
 * more force, because a transcription has to be checked against an original rather than merely read.
 */
export const OCR_STANDING_WARNING =
  'These questions were read from images by a language model. Mathematical notation is where that ' +
  'is least reliable — a lost exponent or a misread minus sign produces a question that looks ' +
  'right and is wrong. Check every question, and every answer, against the original page before ' +
  'approving it.';

export const imageImportParser: ImportParser = {
  descriptor: {
    id: IMAGE_PARSER_ID,
    label: 'Photographs of a question paper',
    kind: 'image',
    // The only importer for which this is `model`, and it is a statement of fact that
    // `Question.provenance.generatorKind` inherits and the UI prints.
    extraction: 'model',
    basis:
      'Read from your images by Google Gemini. No student data is sent. The model transcribes what ' +
      'is printed — it is instructed never to work out an answer that is not on the page — and every ' +
      'question is then checked by the same rules as a hand-written one. Nothing is saved until you ' +
      'approve it, and mathematical notation should be checked against the original.',
  },

  /** Unconfigured means unavailable, and the route says which variable to set. */
  isAvailable() {
    return Boolean(config.ai.geminiApiKey);
  },

  async parse(input: ParseInput): Promise<ParseOutcome> {
    const model = config.ai.geminiModel;

    /**
     * One model call per image, and the cost is worth being explicit about: ten photographs is ten
     * calls. That is why `importLimiter` sits ahead of the permission check on this route, and why
     * `MAX_IMPORT_FILES` is bounded.
     */
    const reply = await requestGeminiJson({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt() },
            {
              inlineData: {
                // The *validated* type from `uploadSchemas.ts`, derived from the magic bytes rather
                // than from whatever the client claimed.
                mimeType: mimeTypeFor(input.file.bytes, input.file.declaredType),
                data: input.file.bytes.toString('base64'),
              },
            },
          ],
        },
      ],
      responseSchema: responseSchema(),
      // Low, unlike generation: this is transcription, and there is exactly one right answer to
      // "what does the page say". Variety is the opposite of what is wanted.
      temperature: 0.1,
      maxOutputTokens: outputBudget(MAX_PER_IMAGE),
      truncationHint: 'Upload fewer questions per photograph, or crop the page.',
    });

    const transcribed = parseReply(reply).slice(0, Math.min(input.maxCandidates, MAX_PER_IMAGE));

    const candidates: ImportedCandidate[] = [];
    const failures: ParseFailure[] = [];

    for (const [position, item] of transcribed.entries()) {
      const outcome = toCandidateFrom(item, position, input.defaults);
      if (outcome.kind === 'failure') failures.push(outcome.failure);
      else candidates.push(outcome.candidate);
    }

    if (transcribed.length === 0) {
      failures.push({
        sourceRef: 'This image',
        reason:
          'No questions could be read from this image. Check that the page is in focus, right way up, and shows the questions rather than only a heading or an answer sheet.',
      });
    }

    logger.info(
      { file: input.file.name, model, read: transcribed.length, usable: candidates.length },
      'Transcribed questions from an image',
    );

    return {
      candidates,
      failures,
      examined: transcribed.length,
      // Every image import carries this, and the service de-duplicates it across the upload.
      notes: [OCR_STANDING_WARNING],
    };
  },
};

/**
 * The MIME type to hand the provider, taken from the **bytes** rather than the client's claim.
 *
 * `uploadSchemas.ts` has already proved the file really is a JPEG, PNG or WebP by its signature, so
 * re-deriving it here costs three comparisons and means a mislabelled-but-valid image (a `.png`
 * saved as `.jpg`, which cameras and messaging apps produce constantly) is described accurately
 * instead of being rejected by the provider.
 */
export function mimeTypeFor(bytes: Buffer, declared: string): string {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return declared;
}

/** What the upload page tells an examiner about photographing a paper. Data, not prose in a page. */
export const IMAGE_GUIDANCE: readonly string[] = [
  'Photograph the page straight on, in good light, with the text in focus',
  'One page per image; crop out anything that is not questions',
  'Include the answer key — a question with no printed answer cannot be imported',
  'Mathematical notation is where transcription is least reliable: check every formula against the original',
  'Questions that need a diagram cannot be imported, because the question bank stores text only',
  `Each image is read separately, so ${QUESTION_TYPES.length} question types and mixed pages are fine`,
];

/** Exported so a test can assert what the model is actually told. */
export { buildPrompt as buildImagePrompt, responseSchema as imageResponseSchema };
