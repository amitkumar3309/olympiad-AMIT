import type { Types } from 'mongoose';
import { config } from '../config';
import { logger } from '../lib/logger';
import { GenerationLog, Question, Subject, Topic, type QuestionDocument } from '../models';
import { ApiError } from '../lib/ApiError';
import { createQuestionSchema } from '../validation/questionSchemas';
import { createQuestion, toQuestionContent } from './questionService';
import { geminiQuestionGenerator } from './geminiQuestionGenerator';
import type { Actor } from './taxonomyService';
import type {
  ChapterRef,
  GeneratedCandidate,
  GenerationRequest,
  GeneratorDescriptor,
  QuestionGenerator,
  RejectedCandidate,
} from '../lib/questionGeneratorTypes';

/**
 * THE path from "generate questions" to rows in the question bank (Milestone 17,
 * reworked in Milestone 18).
 *
 * A generator writes text. This decides whether that text may become a question, and
 * the division is the point: **a generator is never trusted, and the trust boundary is
 * one function.**
 *
 * ## Two phases, and nothing is stored between them
 *
 * `proposeQuestions()` calls the model, validates, de-duplicates and returns candidates
 * **without writing a single question**. `approveQuestions()` is the only thing that
 * writes, and it re-validates from scratch — because what comes back for approval is
 * whatever the reviewer's browser sent, including their edits, and an edited candidate
 * is untrusted input exactly like the original was.
 *
 * That re-validation is not belt-and-braces. The review screen is a *client*: it could
 * send anything, and the approval route is a normal authenticated endpoint. Trusting
 * the second call because the first one validated would mean the schema was never
 * really enforced.
 *
 * ## What happens to every candidate
 *
 * 1. The **taxonomy is attached here**, from the examiner's validated request. A
 *    candidate has no subject/topic/class/difficulty field to supply.
 * 2. It is parsed by **`createQuestionSchema`** — the same schema a hand-authored
 *    question passes, running `validateMathContent()` over the text, the options, the
 *    accepted answers and the solution. There is no model-specific validator.
 * 3. It is checked for **near-duplication**, against the rest of the batch and against
 *    what is already published in the same topic.
 * 4. A failure is **reported with its reason**, never repaired. Silently fixing a
 *    model's answer key is how a plausible-looking wrong answer gets stored.
 *
 * ## The template generator is gone
 *
 * Milestone 17 fell back to blank templates when the model was unavailable. Milestone
 * 18 removed that: a blank placeholder is only useful as something to type into, and a
 * reviewer who wants one can create a question by hand. An unconfigured or failing
 * provider now says so plainly instead of quietly producing filler.
 */

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const generators = new Map<string, QuestionGenerator>([[geminiQuestionGenerator.descriptor.id, geminiQuestionGenerator]]);

/** Adds a provider so `QUESTION_GENERATOR` can select it. OpenAI or Claude land here. */
export function registerQuestionGenerator(generator: QuestionGenerator): void {
  generators.set(generator.descriptor.id, generator);
}

export function listQuestionGenerators(): QuestionGenerator[] {
  return [...generators.values()];
}

/** Test seam: forget everything but the built-in provider. */
export function resetQuestionGenerators(): void {
  generators.clear();
  generators.set(geminiQuestionGenerator.descriptor.id, geminiQuestionGenerator);
}

/**
 * The generator to use. `auto` means "the first configured provider", so adding a key
 * is the only step needed to turn generation on.
 */
export function resolveQuestionGenerator(id: string = config.ai.questionGenerator): QuestionGenerator {
  if (id === 'auto') {
    return [...generators.values()].find((generator) => generator.isAvailable()) ?? geminiQuestionGenerator;
  }
  const chosen = generators.get(id);
  if (!chosen) {
    logger.warn({ requested: id, available: [...generators.keys()] }, 'QUESTION_GENERATOR names an unknown generator');
    return geminiQuestionGenerator;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * How similar two questions may be before one is refused, as a proportion of shared
 * significant words (0-1).
 *
 * 0.8 catches "a model re-emitting the same question with different numbers", which is
 * the failure this exists for and the one that actually happens — asking for twenty
 * questions on one narrow chapter reliably produces several near-twins. It is
 * deliberately not lower: legitimate questions in one chapter share a great deal of
 * vocabulary, and refusing those would make a narrow topic ungeneratable.
 */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

/** Words carrying no topical signal, so their overlap should not make two questions "similar". */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'is', 'are', 'was', 'were', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'if',
  'what', 'which', 'find', 'value', 'following', 'given', 'that', 'this', 'from', 'by', 'be', 'with',
]);

/** The comparable fingerprint of a question: significant words, order-insensitive. */
function fingerprint(text: string): Set<string> {
  const words = text
    .toLowerCase()
    // LaTeX delimiters and punctuation are noise here; the symbols inside survive.
    .replace(/[$\\{}()[\],.;:?!"']/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return new Set(words);
}

/**
 * Jaccard similarity: shared words over total distinct words.
 *
 * Chosen over an edit distance because the failure mode is *rewording*, not typos — a
 * model asked twice for the same thing produces the same question with the numbers
 * changed, which edit distance scores as far apart and word overlap scores as nearly
 * identical.
 */
export function similarity(a: string, b: string): number {
  const left = fingerprint(a);
  const right = fingerprint(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;

  return shared / (left.size + right.size - shared);
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

export interface ProposeInput {
  subject: string;
  /** One or more topic ids. The first is the one a question is filed under. */
  chapters: string[];
  classLevel: GenerationRequest['classLevel'];
  difficulty: GenerationRequest['difficulty'];
  questionType: GenerationRequest['questionType'];
  language: GenerationRequest['language'];
  bloomLevel: GenerationRequest['bloomLevel'];
  count: number;
  marks: number;
  negativeMarks: number;
  optionCount: number;
  instructions: string | null;
  /** Question text already on the review screen, so a regenerate does not repeat it. */
  exclude?: string[];
}

/** A candidate that survived, with the taxonomy it will be filed under. */
export interface ProposedQuestion extends GeneratedCandidate {
  /** Stable only within this batch — nothing is stored, so there is no database id. */
  clientId: string;
  topic: string;
}

export interface ProposalOutcome {
  generator: GeneratorDescriptor;
  questions: ProposedQuestion[];
  rejected: RejectedCandidate[];
  duplicates: RejectedCandidate[];
  requested: number;
  logId: string | null;
}

async function resolveTaxonomyNames(subjectId: string, chapterIds: string[]) {
  const [subject, chapters] = await Promise.all([
    Subject.findById(subjectId).select('name'),
    Topic.find({ _id: { $in: chapterIds } }).select('name subject'),
  ]);

  if (!subject) throw ApiError.badRequest('That subject does not exist.');
  if (chapters.length !== chapterIds.length) throw ApiError.badRequest('One of those chapters does not exist.');
  for (const chapter of chapters) {
    if (String(chapter.subject) !== String(subject._id)) {
      throw ApiError.badRequest(`"${chapter.name}" does not belong to ${subject.name}.`);
    }
  }

  // Ordered as the caller listed them, so "the first chapter" is the one they chose.
  const byId = new Map(chapters.map((chapter) => [String(chapter._id), chapter]));
  const ordered: ChapterRef[] = chapterIds.map((id) => ({ id, name: byId.get(id)!.name }));
  return { subject, chapters: ordered };
}

/**
 * Asks the model for questions and returns the ones worth reviewing.
 *
 * **Writes nothing to the question bank.** The only thing persisted is the generation
 * log, which records counts and parameters so a bad prompt is diagnosable later.
 */
export async function proposeQuestions(input: ProposeInput, actor: Actor): Promise<ProposalOutcome> {
  const generator = resolveQuestionGenerator();

  if (!generator.isAvailable()) {
    // Actionable rather than generic: this is nearly always an unset key, and the
    // examiner is the person who can fix it.
    throw ApiError.serviceUnavailable(
      'AI question generation is not configured. Set GEMINI_API_KEY in the backend environment and redeploy — see ENVIRONMENT_VARIABLES.md.',
    );
  }

  const { subject, chapters } = await resolveTaxonomyNames(input.subject, input.chapters);

  // What the model must not repeat: what is already published in these chapters, plus
  // whatever is already on the reviewer's screen.
  const existing = await Question.find({ topic: { $in: input.chapters }, classLevel: input.classLevel })
    .select('questionText')
    .limit(200)
    .lean();
  const existingTexts = existing.map((row) => row.questionText);
  const avoid = [...existingTexts, ...(input.exclude ?? [])];

  const request: GenerationRequest = {
    subjectName: subject.name,
    chapters,
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    count: input.count,
    questionType: input.questionType,
    language: input.language,
    bloomLevel: input.bloomLevel,
    marks: input.marks,
    negativeMarks: input.negativeMarks,
    optionCount: input.optionCount,
    instructions: input.instructions,
    avoid,
  };

  const startedAt = Date.now();
  let candidates: GeneratedCandidate[];

  try {
    candidates = await generator.generate(request);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'The generator failed.';
    await writeLog(input, actor, generator.descriptor, {
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: detail,
    });
    logger.error({ err, generator: generator.descriptor.id }, 'Question generation failed');
    // Surfaced verbatim: a spent quota, an expired key and a blocked prompt need three
    // different fixes, and only the provider knows which one happened.
    throw ApiError.badGateway(detail);
  }

  const questions: ProposedQuestion[] = [];
  const rejected: RejectedCandidate[] = [];
  const duplicates: RejectedCandidate[] = [];
  const primaryTopic = input.chapters[0]!;

  for (const [index, candidate] of candidates.slice(0, input.count).entries()) {
    const parsed = createQuestionSchema.safeParse({
      ...candidate,
      subject: input.subject,
      topic: primaryTopic,
      subtopic: null,
      classLevel: input.classLevel,
      difficulty: input.difficulty,
    });

    if (!parsed.success) {
      rejected.push({ index: index + 1, reason: reasonFrom(parsed.error) });
      continue;
    }

    // Against the bank, then against the batch. Both matter: the first stops the
    // examiner re-adding what they already have, the second stops one run producing
    // the same question three times.
    const against = [...existingTexts, ...(input.exclude ?? []), ...questions.map((entry) => entry.questionText)];
    const clash = against.find((text) => similarity(text, candidate.questionText) >= DUPLICATE_SIMILARITY_THRESHOLD);
    if (clash) {
      duplicates.push({ index: index + 1, reason: `Too similar to an existing question: "${clash.slice(0, 90)}…"` });
      continue;
    }

    questions.push({
      ...candidate,
      acceptedAnswers: candidate.acceptedAnswers,
      clientId: `${Date.now().toString(36)}-${index}`,
      topic: primaryTopic,
    });
  }

  const logId = await writeLog(input, actor, generator.descriptor, {
    status: 'succeeded',
    durationMs: Date.now() - startedAt,
    returned: candidates.length,
    accepted: questions.length,
    rejected: rejected.length,
    rejectionReasons: rejected.map((entry) => entry.reason).slice(0, 10),
    duplicates: duplicates.length,
  });

  return { generator: generator.descriptor, questions, rejected, duplicates, requested: input.count, logId };
}

// ---------------------------------------------------------------------------
// Approving — the only path that writes
// ---------------------------------------------------------------------------

export interface ApproveInput {
  subject: string;
  topic: string;
  classLevel: GenerationRequest['classLevel'];
  difficulty: GenerationRequest['difficulty'];
  /** Whether to publish immediately or keep for a second pass. */
  publish: boolean;
  questions: GeneratedCandidate[];
  logId?: string | null;
}

export interface ApprovalOutcome {
  created: QuestionDocument[];
  rejected: RejectedCandidate[];
}

/**
 * Writes the approved questions.
 *
 * Re-validates every one from scratch — see the note at the top of this file: what
 * arrives here is whatever the browser sent, edits included, and an edited candidate is
 * untrusted input exactly as the model's original was.
 */
export async function approveQuestions(input: ApproveInput, actor: Actor): Promise<ApprovalOutcome> {
  const created: QuestionDocument[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const [index, candidate] of input.questions.entries()) {
    const parsed = createQuestionSchema.safeParse({
      ...candidate,
      subject: input.subject,
      topic: input.topic,
      subtopic: null,
      classLevel: input.classLevel,
      difficulty: input.difficulty,
    });

    if (!parsed.success) {
      rejected.push({ index: index + 1, reason: reasonFrom(parsed.error) });
      continue;
    }

    try {
      created.push(await createQuestion(toQuestionContent(parsed.data), actor));
    } catch (err) {
      rejected.push({ index: index + 1, reason: err instanceof Error ? err.message : 'Could not be saved.' });
    }
  }

  if (input.logId) {
    // Best-effort, like an audit write: the questions are saved, and failing the
    // examiner's approval because a log row would not update is the wrong trade.
    await GenerationLog.updateOne({ _id: input.logId }, { $inc: { approved: created.length } }).catch((err: unknown) =>
      logger.error({ err, logId: input.logId }, 'Could not record approval against the generation log'),
    );
  }

  return { created, rejected };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

interface LogOutcomeFields {
  status: 'succeeded' | 'failed';
  durationMs: number;
  returned?: number;
  accepted?: number;
  rejected?: number;
  rejectionReasons?: string[];
  duplicates?: number;
  error?: string;
}

/** Best-effort, exactly like `recordAudit`: a logging failure must not fail the action. */
async function writeLog(
  input: ProposeInput,
  actor: Actor,
  descriptor: GeneratorDescriptor,
  outcome: LogOutcomeFields,
): Promise<string | null> {
  try {
    const row = await GenerationLog.create({
      actor: actor.id,
      actorLabel: actor.label,
      purpose: 'question_bank',
      generatorId: descriptor.id,
      generatorKind: descriptor.kind,
      modelName: config.ai.geminiModel,
      subject: input.subject as unknown as Types.ObjectId,
      chapters: input.chapters as unknown as Types.ObjectId[],
      classLevel: input.classLevel,
      difficulty: input.difficulty,
      questionType: input.questionType,
      language: input.language,
      bloomLevel: input.bloomLevel,
      requested: input.count,
      hadInstructions: Boolean(input.instructions),
      ...outcome,
    });
    return String(row._id);
  } catch (err) {
    logger.error({ err }, 'Could not write the generation log');
    return null;
  }
}

/** Turns a zod failure into one sentence an examiner can act on. */
function reasonFrom(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    return issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'question'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : 'Unusable question.';
}
