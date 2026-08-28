import type { Types } from 'mongoose';
import { config } from '../config';
import { logger } from '../lib/logger';
import { GenerationLog, Question, Subject, Topic, type QuestionDocument, type QuestionProvenance } from '../models';
import { ApiError } from '../lib/ApiError';
import { createQuestionSchema } from '../validation/questionSchemas';
import { createQuestion, toQuestionContent } from './questionService';
import { geminiQuestionGenerator } from './geminiQuestionGenerator';
import { inspectCandidates, type QualityWarning } from '../lib/questionQuality';
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
  /**
   * An optional subtopic of the **first** chapter, narrowing what is asked for.
   *
   * `Topic` is one collection with a nullable `parent` and a depth capped at 1, so this is
   * a second-level row rather than a different kind of thing — which is why it is checked
   * against the chapter it claims to belong to rather than merely existing.
   */
  subtopic?: string | null;
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
  /** Which model to call. Null uses the deployment's configured default. */
  model?: string | null;
  /** Question text already on the review screen, so a regenerate does not repeat it. */
  exclude?: string[];
}

/** A candidate that survived, with the taxonomy it will be filed under. */
export interface ProposedQuestion extends GeneratedCandidate {
  /** Stable only within this batch — nothing is stored, so there is no database id. */
  clientId: string;
  topic: string;
  subtopic: string | null;
  /**
   * Advisory findings from `lib/questionQuality.ts` — never a reason it was refused.
   *
   * A candidate carrying warnings is still a candidate: these are the defects that are
   * decidable from the text but not always defects, so they are shown to the reviewer and
   * approval is not blocked by them. The rules that *are* always defects live in
   * `createQuestionSchema`, and those rejected the candidate before it got here.
   */
  warnings: QualityWarning[];
}

export interface ProposalOutcome {
  generator: GeneratorDescriptor;
  /** The model that actually wrote these, for the review screen and the audit trail. */
  model: string;
  questions: ProposedQuestion[];
  rejected: RejectedCandidate[];
  duplicates: RejectedCandidate[];
  /** Findings about the set as a whole, e.g. the answer sitting in one position throughout. */
  batchWarnings: QualityWarning[];
  requested: number;
  logId: string | null;
}

async function resolveTaxonomyNames(subjectId: string, chapterIds: string[], subtopicId: string | null) {
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

  /**
   * The subtopic is checked against the chapter it will be filed under, not merely for
   * existing. `resolveTaxonomy()` in `questionService.ts` applies the same rule at write
   * time; doing it here as well means the examiner is told before a model call is spent
   * rather than after twenty questions come back unfileable.
   */
  let subtopic: { id: string; name: string } | null = null;
  if (subtopicId) {
    const row = await Topic.findById(subtopicId).select('name parent');
    if (!row) throw ApiError.badRequest('That subtopic does not exist.');
    if (String(row.parent) !== String(chapterIds[0])) {
      throw ApiError.badRequest(`"${row.name}" is not a subtopic of ${ordered[0]!.name}.`);
    }
    subtopic = { id: String(row._id), name: row.name };
  }

  return { subject, chapters: ordered, subtopic };
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

  const { subject, chapters, subtopic } = await resolveTaxonomyNames(
    input.subject,
    input.chapters,
    input.subtopic ?? null,
  );

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
    subtopicName: subtopic?.name ?? null,
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
    model: input.model ?? null,
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

  const primaryTopic = input.chapters[0]!;
  const screened = screenCandidates(candidates.slice(0, input.count), {
    subject: input.subject,
    topic: primaryTopic,
    subtopic: subtopic?.id ?? null,
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    against: [...existingTexts, ...(input.exclude ?? [])],
  });

  const report = inspectCandidates(screened.accepted.map((entry) => entry.candidate));
  const batchStamp = Date.now().toString(36);

  const questions: ProposedQuestion[] = screened.accepted.map((entry, position) => ({
    ...entry.candidate,
    clientId: `${batchStamp}-${entry.index}`,
    topic: primaryTopic,
    subtopic: subtopic?.id ?? null,
    warnings: report.perQuestion[position] ?? [],
  }));

  const logId = await writeLog(input, actor, generator.descriptor, {
    status: 'succeeded',
    durationMs: Date.now() - startedAt,
    returned: candidates.length,
    accepted: questions.length,
    rejected: screened.rejected.length,
    rejectionReasons: screened.rejected.map((entry) => entry.reason).slice(0, 10),
    duplicates: screened.duplicates.length,
  });

  return {
    generator: generator.descriptor,
    model: input.model ?? config.ai.geminiModel,
    questions,
    rejected: screened.rejected,
    duplicates: screened.duplicates,
    batchWarnings: report.batch,
    requested: input.count,
    logId,
  };
}

// ---------------------------------------------------------------------------
// Screening — one definition, shared by proposing and by the dry run
// ---------------------------------------------------------------------------

/** Where a batch will be filed, which is what makes the candidates checkable at all. */
export interface ScreenTarget {
  subject: string;
  topic: string;
  subtopic: string | null;
  classLevel: GenerationRequest['classLevel'];
  difficulty: GenerationRequest['difficulty'];
  /** Question text a candidate must not resemble: the bank, and the reviewer's screen. */
  against: string[];
}

export interface ScreenOutcome {
  /** Survivors, each carrying the position it arrived in so a reason can name it. */
  accepted: Array<{ index: number; candidate: GeneratedCandidate }>;
  rejected: RejectedCandidate[];
  duplicates: RejectedCandidate[];
}

/**
 * Runs every candidate past the same two gates, in the same order, wherever it came from.
 *
 * Extracted because there are now two callers — the model's output, and the reviewer's
 * edited version of it on the way to a dry run — and two copies of "validate then
 * de-duplicate" would eventually disagree about what is acceptable. That is the same
 * argument that keeps one grader and one ranking service: a second screener would be a
 * second answer to "may this become a question?".
 *
 * Note the order, and that it does not change. A candidate that fails validation is never
 * also reported as a duplicate, because the first reason is the one the examiner has to fix
 * first.
 */
export function screenCandidates(candidates: GeneratedCandidate[], target: ScreenTarget): ScreenOutcome {
  return screenEach(candidates.map((candidate) => ({ candidate, target })));
}

/** One candidate together with where it would be filed. */
export interface ScreenEntry {
  candidate: GeneratedCandidate;
  target: ScreenTarget;
}

/**
 * The screener itself, with a target **per candidate** rather than one for the batch.
 *
 * Added in Milestone 21 for the bulk importer, and the generalisation rather than a second
 * function is the point. A generated batch is filed in one place by construction, so
 * `screenCandidates()` above passes the same target for every candidate and is unchanged in
 * behaviour. An imported batch is not: a spreadsheet legitimately carries a `Class` and a
 * `Topic` column, so row 3 and row 40 may belong to different chapters and must be checked
 * against the questions already in *their own* chapter.
 *
 * Writing a second screener for that case is precisely what the one-screener rule forbids —
 * two would eventually disagree about what may become a question, and the more permissive
 * one would decide. So there is still exactly one implementation of "validate, then
 * de-duplicate", and both callers reach it here.
 *
 * Batch-internal duplicate detection still works across the whole upload because this is one
 * loop over every entry: row 40 is compared against row 3 even though they are filed apart.
 * That is deliberate — the same question pasted into two chapters of one spreadsheet is a
 * copy-paste slip, not two questions.
 */
export function screenEach(entries: readonly ScreenEntry[]): ScreenOutcome {
  const accepted: ScreenOutcome['accepted'] = [];
  const rejected: RejectedCandidate[] = [];
  const duplicates: RejectedCandidate[] = [];

  for (const [position, { candidate, target }] of entries.entries()) {
    const index = position + 1;
    const parsed = createQuestionSchema.safeParse({
      ...candidate,
      subject: target.subject,
      topic: target.topic,
      subtopic: target.subtopic,
      classLevel: target.classLevel,
      difficulty: target.difficulty,
    });

    if (!parsed.success) {
      rejected.push({ index, reason: reasonFrom(parsed.error) });
      continue;
    }

    // Against the bank first, then against the batch. Both matter: the first stops the
    // examiner re-adding what they already have, the second stops one run producing the
    // same question three times.
    const against = [...target.against, ...accepted.map((entry) => entry.candidate.questionText)];
    const clash = against.find((text) => similarity(text, candidate.questionText) >= DUPLICATE_SIMILARITY_THRESHOLD);
    if (clash) {
      duplicates.push({ index, reason: `Too similar to an existing question: "${clash.slice(0, 90)}…"` });
      continue;
    }

    accepted.push({ index, candidate });
  }

  return { accepted, rejected, duplicates };
}

// ---------------------------------------------------------------------------
// The dry run
// ---------------------------------------------------------------------------

export interface ValidateInput {
  subject: string;
  topic: string;
  subtopic?: string | null;
  classLevel: GenerationRequest['classLevel'];
  difficulty: GenerationRequest['difficulty'];
  questions: GeneratedCandidate[];
}

export interface ValidationOutcome {
  /** One verdict per question sent, positionally, so the screen can label each card. */
  verdicts: Array<{ index: number; ok: boolean; reason: string | null; warnings: QualityWarning[] }>;
  batchWarnings: QualityWarning[];
  /** How many would be saved if the examiner approved right now. */
  wouldSave: number;
}

/**
 * Answers "would this batch save?" without saving it.
 *
 * Exists because the examiner edits these questions, and an edit can break a rule — the
 * commonest being unticking one correct option and forgetting to tick another. Before this,
 * the only way to find out was to press Approve and read which of twenty were refused,
 * having already saved the rest. A dry run against the *same* screening function makes the
 * answer trustworthy: it is not an approximation of what approval will do, it is the same
 * code.
 *
 * It **writes nothing**, not even a log row — nothing happened that a later reader would
 * want to know about, and a row per keystroke would bury the runs that matter.
 */
export async function validateProposals(input: ValidateInput): Promise<ValidationOutcome> {
  // The bank is re-read rather than trusted from the earlier proposal: somebody else may
  // have added a colliding question in the meantime, and this is the check that is supposed
  // to catch that before it becomes two near-identical rows.
  const existing = await Question.find({ topic: input.topic, classLevel: input.classLevel })
    .select('questionText')
    .limit(200)
    .lean();

  const screened = screenCandidates(input.questions, {
    subject: input.subject,
    topic: input.topic,
    subtopic: input.subtopic ?? null,
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    against: existing.map((row) => row.questionText),
  });

  const report = inspectCandidates(screened.accepted.map((entry) => entry.candidate));
  const warningsByIndex = new Map(
    screened.accepted.map((entry, position) => [entry.index, report.perQuestion[position] ?? []]),
  );
  const reasonByIndex = new Map(
    [...screened.rejected, ...screened.duplicates].map((entry) => [entry.index, entry.reason]),
  );

  const verdicts = input.questions.map((_question, position) => {
    const index = position + 1;
    const reason = reasonByIndex.get(index) ?? null;
    return { index, ok: reason === null, reason, warnings: warningsByIndex.get(index) ?? [] };
  });

  return { verdicts, batchWarnings: report.batch, wouldSave: screened.accepted.length };
}

// ---------------------------------------------------------------------------
// Rejecting
// ---------------------------------------------------------------------------

/**
 * Records that the examiner threw candidates away.
 *
 * Rejection needs no other action — nothing was stored, so discarding a candidate is
 * genuinely just not approving it — but the *count* is the one fact about a generation run
 * that nothing else could ever recover, and it is the one that says whether a prompt
 * configuration is producing usable questions. Without it the log shows twenty accepted and
 * is silent about the examiner having kept two.
 *
 * Best-effort, exactly like the approval counter: a log row that will not update must not
 * fail the reviewer's action, because there is no action to fail.
 */
export async function recordReviewerRejections(logId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await GenerationLog.updateOne({ _id: logId }, { $inc: { rejectedByReviewer: count } }).catch((err: unknown) =>
    logger.error({ err, logId }, 'Could not record rejections against the generation log'),
  );
}

// ---------------------------------------------------------------------------
// Approving — the only path that writes
// ---------------------------------------------------------------------------

export interface ApproveInput {
  subject: string;
  topic: string;
  subtopic?: string | null;
  classLevel: GenerationRequest['classLevel'];
  difficulty: GenerationRequest['difficulty'];
  /** Whether to publish immediately or keep for a second pass. */
  publish: boolean;
  /**
   * The questions, each optionally reporting whether the reviewer edited it.
   *
   * `edited` is the review screen's own account of itself and is recorded as such — a
   * display fact, not a control. It cannot be verified here, because nothing was stored to
   * compare against, and that is a consequence of the design rather than an oversight. It
   * grants nothing, so a client that lied about it would have gained nothing.
   */
  questions: Array<GeneratedCandidate & { edited?: boolean }>;
  logId?: string | null;
}

export interface ApprovalOutcome {
  created: QuestionDocument[];
  rejected: RejectedCandidate[];
}

/**
 * Writes the approved questions.
 *
 * Re-validates every one from scratch — see the note at the top of this file: what arrives
 * here is whatever the browser sent, edits included, and an edited candidate is untrusted
 * input exactly as the model's original was.
 *
 * ## Provenance is recovered, not accepted
 *
 * Every row is stamped with which generator and which model wrote it, and those facts are
 * read back from **our own `GenerationLog` row** rather than taken from the request body.
 * The browser supplies only the log id, which it received from us. A client cannot
 * therefore name a model it did not use, and — more to the point — cannot file
 * machine-written questions as hand-written ones. That would be the one field here worth
 * lying about.
 */
export async function approveQuestions(input: ApproveInput, actor: Actor): Promise<ApprovalOutcome> {
  const created: QuestionDocument[] = [];
  const rejected: RejectedCandidate[] = [];
  const origin = await readGenerationOrigin(input.logId ?? null);

  for (const [index, candidate] of input.questions.entries()) {
    const parsed = createQuestionSchema.safeParse({
      ...candidate,
      subject: input.subject,
      topic: input.topic,
      subtopic: input.subtopic ?? null,
      classLevel: input.classLevel,
      difficulty: input.difficulty,
    });

    if (!parsed.success) {
      rejected.push({ index: index + 1, reason: reasonFrom(parsed.error) });
      continue;
    }

    try {
      created.push(
        await createQuestion(toQuestionContent(parsed.data), actor, {
          ...origin,
          editedByReviewer: candidate.edited === true,
          reviewedBy: actor.id,
          reviewedByLabel: actor.label,
          reviewedAt: new Date(),
        }),
      );
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
// Provenance
// ---------------------------------------------------------------------------

/**
 * What the generation log says about who wrote this batch.
 *
 * Read from the database rather than from the approval request for the reason above: a
 * model name and "a model wrote this" are claims worth checking. A missing or unknown log
 * id is not an error — an examiner may approve a batch after a log write failed, and
 * refusing to save their reviewed questions over a diagnostic row would be the wrong trade
 * — so it degrades to the honest minimum: this was AI-assisted, and we cannot say by what.
 */
async function readGenerationOrigin(logId: string | null): Promise<QuestionProvenance> {
  const base: QuestionProvenance = { source: 'ai_assisted' };
  if (!logId) return base;

  const row = await GenerationLog.findById(logId)
    .select('generatorId generatorKind modelName createdAt')
    .lean()
    .catch(() => null);
  if (!row) return base;

  return {
    ...base,
    generatorId: row.generatorId,
    generatorKind: row.generatorKind,
    modelName: row.modelName,
    generationLog: row._id as Types.ObjectId,
    generatedAt: row.createdAt,
  };
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
      // The one actually called, not the configured default: an examiner may have
      // picked another, and a log that records the wrong model is worse than none.
      modelName: input.model ?? config.ai.geminiModel,
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

/**
 * Turns a zod failure into one sentence an examiner can act on.
 *
 * Exported since Milestone 21 so the bulk importer phrases a rejection the same way: an
 * examiner reading "options: A single-choice question needs exactly one correct option"
 * should not have to learn two dialects depending on whether the question came from a model
 * or a spreadsheet.
 */
export function reasonFrom(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    return issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'question'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : 'Unusable question.';
}
