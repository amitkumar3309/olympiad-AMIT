import { CLASS_LEVELS } from '../lib/classLevels';
import { QUESTION_TYPES, type QuestionType } from '../models/Question';
import { containsWordEquations, looksLikeWordDocument, looksLikeWorkbook } from '../lib/ooxml';
import {
  countAnswerTokens,
  inferType,
  normaliseLabel,
  readAcceptedAnswers,
  readBoolean,
  readCorrectOptions,
  readNumber,
  readQuestionType,
} from '../lib/importAnswerText';
import type {
  ImportDefaults,
  ImportParser,
  ImportedCandidate,
  ParseFailure,
  ParseInput,
  ParseOutcome,
} from '../lib/importTypes';

/**
 * Reading questions out of a Word document (Milestone 21, Phase D).
 *
 * ## The honest framing
 *
 * A `.docx` has **no schema.** A spreadsheet at least tells you which column is the answer; a Word
 * file is prose with conventions, and every examiner's conventions differ. So this parser is
 * unavoidably a heuristic, and the important design decision is what it does when it is unsure.
 *
 * **It never guesses quietly.** Three things follow from that, and they are the whole design:
 *
 *  1. Anything it had to interpret becomes a **note** on that candidate — shown beside the question
 *     on the review screen so a human compares it against the original. A DOCX-extracted question
 *     essentially always carries at least one.
 *  2. Anything it could not turn into a question becomes a **failure naming where it was**
 *     ("Question 7"), never a silently dropped block.
 *  3. If it cannot find questions at all, it says so with an explanation of what it looked for,
 *     rather than returning one enormous candidate containing the whole file.
 *
 * That is the spec's requirement — *"do not silently create incorrect questions; mark the extracted
 * item as requiring review"* — and it is also just the trust rule the rest of the importer follows:
 * nothing a parser produces is a question until a human approves it.
 *
 * ## No AI here, deliberately
 *
 * The spec allows AI-assisted extraction for complex documents "behind a provider abstraction". It
 * is not used, and that is a decision rather than an omission. A `.docx` is *text we already have*
 * — the structure is genuinely recoverable by reading it, a model would add cost, latency and a
 * third party to every import, and it would make a core format depend on a credential the product
 * is required to work without. The image path is different: there, OCR is the only way in.
 *
 * ## What is genuinely lost, and is warned about
 *
 * **Equations written with Word's equation editor.** `mammoth` drops OMML silently, so a question
 * built that way imports looking complete with the formula simply missing from the middle of the
 * sentence — the worst kind of failure, because it looks like success. `containsWordEquations()`
 * detects the markup and the file reports it. Mathematics has to be typed as `$…$` LaTeX, exactly
 * as it is everywhere else in this product.
 *
 * **Anything a diagram carries**, for the same reason the AI generator refuses to reference one:
 * the bank stores text and LaTeX, and there is no image field on `Question`.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS, like exceljs
const mammoth = require('mammoth') as typeof import('mammoth');

export const DOCX_PARSER_ID = 'docx';

/** Never read more paragraphs than this, however long the document is. */
const MAX_PARAGRAPHS = 20_000;

/** A stem longer than this is almost certainly two questions run together. */
const LONG_STEM_CHARS = 1_200;

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

/**
 * A question boundary: `1.`, `1)`, `Q1.`, `Q.1`, `Question 1:`, `Ques 3 -`.
 *
 * Requires a **terminator** after the number (`.`, `)`, `:`, `-`) or the `Q`/`Question` prefix, so a
 * question whose text merely opens with a number ("2020 was a leap year — true or false?") is not
 * mistaken for a marker.
 */
const QUESTION_MARKER = /^(?:Q(?:ues|uestion)?\s*\.?\s*)?(\d{1,3})\s*[.)\]:–-]\s*(.*)$/iu;

/**
 * The same, but with the terminator **optional** because the `Q` prefix is already unambiguous.
 *
 * Needed because `Q.1 What is…` and `Q1 What is…` are both common and neither has a terminator
 * after the digit — the first version of this parser matched only `Q1.` and so fell back to the
 * answer-splitting strategy on perfectly well-numbered papers.
 */
const EXPLICIT_QUESTION_MARKER = /^Q(?:ues|uestion)?\s*\.?\s*(\d{1,3})\s*[.)\]:–-]?\s*(.*)$/iu;

/** Either form of marker, preferring the explicit one so `Q.1` is matched without a terminator. */
function questionMarkerFor(line: string): RegExpExecArray | null {
  return EXPLICIT_QUESTION_MARKER.exec(line) ?? QUESTION_MARKER.exec(line);
}


/**
 * An option: `(a)`, `a)`, `A.`, `(1)`, `1)` — with the letter or digit in brackets or followed by a
 * terminator.
 *
 * **Bare `N.` is deliberately excluded** and this is the one real ambiguity in the format: `1.` at
 * the start of a line is a question marker in almost every paper and an option marker in a few. It
 * is read as a question, because getting that backwards merges every question in the document into
 * one, whereas the reverse produces a question whose options are missing — visibly wrong on the
 * review screen rather than invisibly wrong. Parenthesised digits `(1)`–`(8)` *are* options, since
 * nothing numbers its questions that way.
 */
const OPTION_MARKER = /^\(\s*([a-h1-8])\s*\)\s*(.*)$|^([a-h])\s*[.)\]]\s+(.*)$/iu;

/** `Answer: B`, `Ans - B`, `Correct option: (b)`, `Key: B`. */
const ANSWER_LINE = /^(?:correct\s*)?(?:ans(?:wer)?|key|correct\s*option|sol(?:ution)?\s*key)\s*[:.\-–]\s*(.*)$/iu;

/** `Solution:`, `Explanation:`, `Working:` — the rest of the line, and following lines, are it. */
const SOLUTION_LINE = /^(?:solution|explanation|expl|working|reason|hint|why)\s*[:.\-–]\s*(.*)$/iu;

/** `Class: 8`, `Topic - Algebra`, `Marks: 4`. */
const META_LINE = /^([A-Za-z][A-Za-z\s]{1,24}?)\s*[:\-–]\s*(.+)$/u;

/** The metadata labels that mean something, mapped to what they set. */
const META_KEYS: Record<string, 'class' | 'topic' | 'subtopic' | 'difficulty' | 'marks' | 'negativeMarks' | 'type' | 'tags'> = {
  class: 'class',
  classlevel: 'class',
  grade: 'class',
  standard: 'class',
  std: 'class',
  topic: 'topic',
  chapter: 'topic',
  subtopic: 'subtopic',
  subchapter: 'subtopic',
  concept: 'subtopic',
  difficulty: 'difficulty',
  level: 'difficulty',
  marks: 'marks',
  mark: 'marks',
  negativemarks: 'negativeMarks',
  negativemarking: 'negativeMarks',
  penalty: 'negativeMarks',
  type: 'type',
  questiontype: 'type',
  tags: 'tags',
  keywords: 'tags',
};

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** One question's worth of lines, before any interpretation. */
interface Block {
  /** What to call it in a message. The document's own number where there was one. */
  label: string;
  lines: string[];
}

/**
 * Splits the document into one block per question.
 *
 * Two strategies, tried in order, because **Word's automatic numbering does not survive text
 * extraction**. A document whose questions are numbered by Word's list feature arrives with no
 * numbers at all — the digits live in `numbering.xml`, not in the paragraph text — so a
 * marker-only parser would see one giant question. That is not an edge case; it is what happens
 * when somebody uses the toolbar.
 *
 *  1. **Explicit markers.** If the text really contains `Q1.` / `1.` / `Question 1:` at least
 *     twice, split there. Preferred whenever available because it is unambiguous and it preserves
 *     the document's own numbering in the messages.
 *  2. **Answer-terminated blocks.** Otherwise, a question ends after its answer (and any solution
 *     that follows it). This is what recovers an auto-numbered document, and it works because a
 *     paper that omits its numbers still states its answers.
 *
 * If neither yields anything, the caller reports what was looked for rather than inventing a
 * result.
 */
export function splitIntoBlocks(lines: readonly string[]): { blocks: Block[]; strategy: 'markers' | 'answers' | 'none' } {
  /**
   * **One** marker is enough, not two.
   *
   * The first version required two, to avoid a stray `1. Introduction` in prose triggering marker
   * mode. That was the wrong trade: it meant a document containing a *single* question fell through
   * to the answer-splitting strategy, which does not strip the marker — so the question imported
   * with `Q1.` still glued to the front of its text. Prose is excluded properly below instead, by
   * requiring the fallback to find at least one answer line.
   */
  const markerCount = lines.filter((line) => questionMarkerFor(line) !== null).length;

  if (markerCount >= 1) {
    const blocks: Block[] = [];
    let current: Block | null = null;

    for (const line of lines) {
      const marker = questionMarkerFor(line);
      if (marker) {
        if (current) blocks.push(current);
        current = { label: `Question ${marker[1]}`, lines: [] };
        // Whatever followed the marker on the same line is the start of the stem.
        const rest = (marker[2] ?? '').trim();
        if (rest.length > 0) current.lines.push(rest);
        continue;
      }
      if (current) current.lines.push(line);
      // Anything before the first marker is a title or a preamble, and is dropped.
    }

    if (current) blocks.push(current);
    if (blocks.length > 0) return { blocks, strategy: 'markers' };
  }

  // ---- Fallback: an answer ends a question --------------------------------

  /**
   * The fallback is *answer*-terminated, so with no answer line anywhere it has nothing to work
   * with — and it must say so rather than returning the whole document as one block.
   *
   * Without this guard, a file of ordinary prose (minutes, a syllabus, a covering letter) came back
   * as a single enormous "question", which is precisely the outcome the spec forbids: an examiner
   * would have been shown a candidate rather than told their document was not a question paper.
   */
  if (!lines.some((line) => ANSWER_LINE.test(line))) {
    return { blocks: [], strategy: 'none' };
  }

  const blocks: Block[] = [];
  let current: string[] = [];
  let seenAnswer = false;

  const flush = () => {
    if (current.some((line) => line.trim().length > 0)) {
      blocks.push({ label: `Question ${blocks.length + 1}`, lines: current });
    }
    current = [];
    seenAnswer = false;
  };

  for (const line of lines) {
    const isAnswer = ANSWER_LINE.test(line);
    const isSolution = SOLUTION_LINE.test(line);

    // A new question has started if we have already had an answer and this line is neither a
    // solution nor a continuation of one.
    if (seenAnswer && !isAnswer && !isSolution && !looksLikeContinuation(line)) {
      flush();
    }

    current.push(line);
    if (isAnswer) seenAnswer = true;
  }
  flush();

  if (blocks.length > 0) return { blocks, strategy: 'answers' };
  return { blocks: [], strategy: 'none' };
}

/**
 * Whether a line is more likely the tail of a solution than the start of a question.
 *
 * A lower-case opening or a line with no sentence-ending is usually a wrapped continuation. Only
 * used by the fallback strategy, where there are no markers to rely on.
 */
function looksLikeContinuation(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (OPTION_MARKER.test(trimmed)) return true;
  if (META_LINE.test(trimmed) && isKnownMeta(trimmed)) return true;
  return /^[a-z\\$(=]/u.test(trimmed);
}

function isKnownMeta(line: string): boolean {
  const meta = META_LINE.exec(line);
  return Boolean(meta?.[1] && META_KEYS[normaliseLabel(meta[1])]);
}

// ---------------------------------------------------------------------------
// One block
// ---------------------------------------------------------------------------

type BlockOutcome =
  | { kind: 'candidate'; candidate: ImportedCandidate }
  | { kind: 'failure'; failure: ParseFailure };

/**
 * Turns one block of lines into a candidate.
 *
 * Like the Excel parser this is a **shape adapter, not a gate**: it decides what the examiner
 * appears to have written, and `createQuestionSchema` — through the one shared screener — decides
 * whether that may become a question. So a block with two correct options is built faithfully and
 * refused later, in the words a hand-authoring examiner would read.
 */
export function readBlock(block: Block, defaults: ImportDefaults): BlockOutcome {
  const fail = (reason: string): BlockOutcome => ({ kind: 'failure', failure: { sourceRef: block.label, reason } });

  const stem: string[] = [];
  const options: string[] = [];
  const solution: string[] = [];
  let answerText = '';
  let statedType: string | null = null;
  const meta: Record<string, string> = {};

  /** Where we are: appending to the stem, to an option, or to the solution. */
  let mode: 'stem' | 'options' | 'solution' = 'stem';

  for (const raw of block.lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const answer = ANSWER_LINE.exec(line);
    if (answer) {
      // Only the first answer statement counts. A second is a document that says it twice, and
      // taking the later one silently would be a coin toss.
      if (answerText.length === 0) answerText = (answer[1] ?? '').trim();
      mode = 'solution';
      continue;
    }

    const solutionStart = SOLUTION_LINE.exec(line);
    if (solutionStart) {
      const rest = (solutionStart[1] ?? '').trim();
      if (rest.length > 0) solution.push(rest);
      mode = 'solution';
      continue;
    }

    const option = OPTION_MARKER.exec(line);
    if (option && mode !== 'solution') {
      // Group 2 is the bracketed form's text, group 4 the `a.` form's.
      options.push(((option[2] ?? option[4]) ?? '').trim());
      mode = 'options';
      continue;
    }

    const metaMatch = META_LINE.exec(line);
    const metaKey = metaMatch?.[1] ? META_KEYS[normaliseLabel(metaMatch[1])] : undefined;
    if (metaMatch && metaKey && metaMatch[2]) {
      if (metaKey === 'type') statedType = metaMatch[2].trim();
      else meta[metaKey] = metaMatch[2].trim();
      continue;
    }

    if (mode === 'solution') {
      solution.push(line);
      continue;
    }
    if (mode === 'options' && options.length > 0) {
      // A wrapped option: Word breaks a long option across paragraphs.
      options[options.length - 1] = `${options[options.length - 1]} ${line}`.trim();
      continue;
    }
    stem.push(line);
  }

  const questionText = stem.join(' ').trim();
  if (questionText.length === 0) {
    return fail('No question text was found in this block — only options, an answer or metadata.');
  }

  const notes: string[] = [];

  // ---- Type ---------------------------------------------------------------
  let type: QuestionType;
  if (statedType) {
    const resolved = readQuestionType(statedType);
    if (!resolved) {
      return fail(`"${statedType}" is not a question type. Use one of: ${QUESTION_TYPES.join(', ')}.`);
    }
    type = resolved;
  } else if (defaults.questionType) {
    type = defaults.questionType;
  } else {
    const inferred = inferType(options.length, answerText);
    type = inferred.type;
    notes.push(inferred.note);
  }

  // ---- Marks --------------------------------------------------------------
  const marksRead = readNumber(meta.marks ?? '');
  if (marksRead === undefined) return fail(`"${meta.marks}" is not a number of marks.`);
  const negativeRead = readNumber(meta.negativeMarks ?? '');
  if (negativeRead === undefined) return fail(`"${meta.negativeMarks}" is not a number of negative marks.`);

  // ---- The answer ---------------------------------------------------------
  if (answerText.length === 0) {
    return fail(
      'No answer was found. Add a line reading "Answer: B" (or the correct value) beneath the question.',
    );
  }

  const answer = readAnswerFor(type, answerText, options, notes);
  if ('reason' in answer) return fail(answer.reason);

  const solutionText = solution.join(' ').trim();
  if (solutionText.length === 0) {
    notes.push('No solution was found. The question can be saved as a draft but cannot be published until one is added.');
  }

  if (questionText.length > LONG_STEM_CHARS) {
    // The commonest symptom of a boundary the parser got wrong, and much easier to see here than
    // by reading a 1,500-character question on the review screen.
    notes.push(
      'This question is unusually long, which often means two questions were run together. Check it against the original document.',
    );
  }

  return {
    kind: 'candidate',
    candidate: {
      content: {
        questionText,
        type,
        options: answer.options,
        booleanAnswer: answer.booleanAnswer,
        numericAnswer: answer.numericAnswer,
        tolerance: null,
        acceptedAnswers: answer.acceptedAnswers,
        solution: solutionText.length > 0 ? solutionText : null,
        marks: marksRead ?? defaults.marks,
        negativeMarks: negativeRead ?? defaults.negativeMarks,
        tags: (meta.tags ?? '')
          .split(/[,;|]/u)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
          .slice(0, 20),
      },
      /**
       * Names as the document wrote them, never ids — the service resolves them against the live
       * taxonomy, so a Word file cannot file a question anywhere by asserting an id and cannot
       * create a chapter by naming one.
       */
      taxonomy: {
        classLevel: meta.class ?? null,
        topicName: meta.topic ?? null,
        subtopicName: meta.subtopic ?? null,
        difficulty: meta.difficulty ?? null,
      },
      sourceRef: block.label,
      notes,
    },
  };
}

/** The answer fields for one type, or the reason the block could not supply them. */
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
    const present = options.filter((text) => text.length > 0);
    if (present.length === 0) {
      return { reason: 'This looks like a choice question but no options were found. Options should be on their own lines as (a), (b), (c).' };
    }
    if (present.length !== options.length) {
      return { reason: 'One of the options is empty. Check the option lines in the document.' };
    }

    const { positions, unresolved } = readCorrectOptions(answerText, options);
    if (unresolved.length > 0) {
      return {
        reason: `The answer "${unresolved.join('", "')}" does not match any option. Use the option letter (A, B, C…) or the exact option text.`,
      };
    }
    if (positions.length === 0) {
      return { reason: `The answer "${answerText}" could not be matched to any option.` };
    }

    return { ...empty, options: options.map((text, index) => ({ text, isCorrect: positions.includes(index) })) };
  }

  if (options.length > 0) {
    // Not fatal: the options simply are not part of this kind of question, and the validator would
    // refuse them. Dropping them *with a note* is the honest middle — the examiner is told.
    notes.push(
      `Lines that looked like options were found, but a ${type.replace('_', '/')} question has no options, so they were ignored.`,
    );
  }

  if (type === 'true_false') {
    const booleanAnswer = readBoolean(answerText);
    if (booleanAnswer === null) return { reason: `"${answerText}" is not a true/false answer. Use TRUE or FALSE.` };
    return { ...empty, booleanAnswer };
  }

  if (type === 'numeric') {
    const numericAnswer = Number(answerText.replace(/[\s,]/gu, ''));
    if (!Number.isFinite(numericAnswer)) {
      return { reason: `"${answerText}" is not a number. State the unit in the question text and give the bare number as the answer.` };
    }
    return { ...empty, numericAnswer };
  }

  const acceptedAnswers = readAcceptedAnswers(answerText);
  if (acceptedAnswers.length === 0) return { reason: 'No accepted answer was found.' };
  return { ...empty, acceptedAnswers };
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/** Reads the document to plain text, one paragraph per line. */
async function extractLines(bytes: Buffer): Promise<string[]> {
  if (!looksLikeWordDocument(bytes)) {
    const failure: Error & { cause?: unknown } = new Error(
      looksLikeWorkbook(bytes)
        ? 'That is an Excel workbook, not a Word document. Use the Excel import instead.'
        : 'That file is a zip archive but not a Word document. Open it in Word and use "Save As → .docx".',
    );
    throw failure;
  }

  let text: string;
  try {
    // `extractRawText` rather than `convertToHtml`: what is wanted is the paragraph text, and
    // going via HTML would mean stripping tags back off again — a second chance to mangle a
    // question containing a `<` or an `&`.
    const result = await mammoth.extractRawText({ buffer: bytes });
    text = result.value;
  } catch (err) {
    // `cause` assigned rather than passed to the constructor: this package targets ES2020.
    const failure: Error & { cause?: unknown } = new Error(
      `That document could not be read. It may be password-protected or damaged. (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'})`,
    );
    failure.cause = err;
    throw failure;
  }

  return text
    .split(/\r?\n/u)
    .slice(0, MAX_PARAGRAPHS)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const docxImportParser: ImportParser = {
  descriptor: {
    id: DOCX_PARSER_ID,
    label: 'Word document',
    kind: 'docx',
    // No model is called and no third party sees the file. A statement of fact, inherited by
    // `Question.provenance.generatorKind`.
    extraction: 'deterministic',
    basis:
      'Read from the text of your .docx file. Questions are found by their numbering (Q1., 1., ' +
      'Question 1:) or by their "Answer:" lines. Because a Word file has no fixed structure, every ' +
      'question is flagged with what had to be interpreted — check each against the original. ' +
      'Equations must be typed as $…$; Word equation objects and diagrams cannot be imported.',
  },

  // Nothing to configure: no credential, no network.
  isAvailable: () => true,

  async parse(input: ParseInput): Promise<ParseOutcome> {
    const lines = await extractLines(input.file.bytes);
    const notes: string[] = [];

    if (containsWordEquations(input.file.bytes)) {
      /**
       * The most valuable warning in this parser.
       *
       * `mammoth` drops OMML silently, so a question written with Word's equation editor imports
       * looking complete with the formula simply absent from the middle of the sentence. That is
       * worse than a failure, because it looks like success — and it is a fact about the file
       * rather than about any one question, which is why it goes in the file-level notes.
       */
      notes.push(
        'This document contains equations created with Word\'s equation editor. Those cannot be read and have been left out of the text — any affected question will be missing its formula. Retype the mathematics as $…$ (for example $x^2 + 5x + 6 = 0$) and upload again.',
      );
    }

    const { blocks, strategy } = splitIntoBlocks(lines);

    if (blocks.length === 0) {
      return {
        candidates: [],
        // Not a throw: the file was read perfectly well and simply does not look like questions.
        // Saying what was looked for is what makes this fixable.
        failures: [
          {
            sourceRef: 'This document',
            reason:
              'No questions could be found. Number each question (Q1., 1. or Question 1:) or give each one an "Answer:" line, and put the options on their own lines as (a), (b), (c).',
          },
        ],
        examined: 0,
        notes,
      };
    }

    if (strategy === 'answers') {
      // Worth saying explicitly, because it is the case most likely to have split a question in
      // the wrong place — and the examiner can fix the cause in one step.
      notes.push(
        'No question numbers were found in the text, so questions were separated by their "Answer:" lines. Word\'s automatic numbering does not survive text extraction — if the boundaries look wrong, type the numbers in manually (Q1., Q2., …) and upload again.',
      );
    }

    const candidates: ImportedCandidate[] = [];
    const failures: ParseFailure[] = [];

    for (const block of blocks.slice(0, input.maxCandidates)) {
      const outcome = readBlock(block, input.defaults);
      if (outcome.kind === 'failure') failures.push(outcome.failure);
      else candidates.push(outcome.candidate);
    }

    return { candidates, failures, examined: blocks.length, notes };
  },
};

/**
 * A short description of the conventions this parser understands, for the upload page.
 *
 * Exported as data rather than written into the page so the two cannot drift — the same reason the
 * Excel template is generated from `CLASS_LEVELS` rather than checked in.
 */
export const DOCX_CONVENTIONS: readonly string[] = [
  'Number each question: Q1., 1., 1) or Question 1:',
  'Put each option on its own line: (a), (b), (c) — or a), b), c)',
  'Give the answer on its own line: Answer: B',
  'Optionally add Solution: or Explanation: beneath it',
  `Optionally add metadata lines: Class: 8, Topic: Algebra, Difficulty: Easy, Marks: 4 (Class must be one of ${CLASS_LEVELS.join(', ')}, or a bare number)`,
  'Write all mathematics as $…$ — Word equation objects and diagrams cannot be read',
];

/** Exported for the tests, which assert on how many answer tokens a line appears to carry. */
export { countAnswerTokens };
