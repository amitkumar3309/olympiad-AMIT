import { Types } from 'mongoose';
import { config } from '../config';
import { logger } from '../lib/logger';
import { ApiError } from '../lib/ApiError';
import {
  ImportBatch,
  Question,
  Subject,
  Topic,
  type ImportFileOutcome,
  type QuestionDocument,
  type QuestionProvenance,
  type QuestionSource,
  type Difficulty,
} from '../models';
import { CLASS_LEVELS, isClassLevel, type ClassLevel } from '../lib/classLevels';
import { DIFFICULTIES } from '../models/Question';
import { createQuestionSchema } from '../validation/questionSchemas';
import { createQuestion, toQuestionContent } from './questionService';
import { reasonFrom, screenEach, type ScreenEntry, type ScreenTarget } from './questionGeneratorService';
import { inspectCandidates, type QualityWarning } from '../lib/questionQuality';
import {
  detectChapter,
  detectionFailureReason,
  detectionNote,
  type DetectableChapter,
} from '../lib/chapterDetection';
import { requireImplicitSubject, type Actor } from './taxonomyService';
import type {
  ImportDefaults,
  ImportFile,
  ImportFileKind,
  ImportParser,
  ImportedCandidate,
  ParseFailure,
} from '../lib/importTypes';
import type { GeneratedCandidate, RejectedCandidate } from '../lib/questionGeneratorTypes';
import { excelImportParser } from './excelImportParser';
import { docxImportParser } from './docxImportParser';
import { imageImportParser } from './imageImportParser';

/**
 * THE path from "here is a file of questions" to rows in the question bank (Milestone 21).
 *
 * A parser reads a file. This decides whether what it read may become a question, and the
 * division is the same one `services/questionGeneratorService.ts` draws for a language model:
 * **a parser is never trusted, and the trust boundary is one place.**
 *
 * ## Two phases, and nothing is stored between them
 *
 * `previewImport()` parses, normalises, resolves the taxonomy, validates and de-duplicates,
 * and returns candidates **without writing a single question**. `approveImport()` is the only
 * thing that writes, and it re-validates from scratch — because what comes back for approval
 * is whatever the reviewer's browser sent, including their corrections, and a corrected
 * candidate is untrusted input exactly as the parsed one was.
 *
 * That is not belt-and-braces: the review screen is a *client*, and trusting the second call
 * because the first one validated would mean the schema was never really enforced. There is
 * deliberately **no staging collection** either — candidates live in the browser, as generated
 * ones do, so the bank cannot fill with machine-read text nobody looked at.
 *
 * ## Why it reuses the generator's screener rather than having its own
 *
 * `screenEach()` is the one implementation of "validate against `createQuestionSchema`, then
 * refuse near-duplicates". A second screener for imports would eventually disagree with it
 * about what may become a question, and the more permissive of the two would decide — the same
 * argument that keeps one grader and one ranking service. What imports needed was not a
 * different screener but a *per-candidate* target, because a spreadsheet legitimately files
 * row 3 and row 40 under different chapters; that generalisation lives there, not here.
 *
 * ## What is different from generation, and why
 *
 * **The taxonomy may vary per row.** A generated batch is filed in one place because a model
 * must not be able to scatter questions; an imported batch is filed row by row because a
 * `Class` and a `Topic` column is what a real spreadsheet of two hundred questions looks like.
 * A parser still never sees an id — it reports the *names it read* (`ImportedTaxonomyHint`) and
 * this module resolves them against the live taxonomy. A name that resolves to nothing is an
 * error reported against that row for the examiner to fix, **never a `Topic` that gets
 * created**: an importer that could add taxonomy rows would let one bad spreadsheet reshape
 * the syllabus.
 */

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The built-in parsers, registered at module load.
 *
 * Excel arrived in Phase C. DOCX and image follow, and each is one line here — which is the
 * point of the seam: nothing about the routes, the validation, the duplicate detection or the
 * approval path changes when a format is added.
 */
const BUILT_IN: readonly ImportParser[] = [excelImportParser, docxImportParser, imageImportParser];

const parsers = new Map<ImportFileKind, ImportParser>(
  BUILT_IN.map((parser) => [parser.descriptor.kind, parser]),
);

/**
 * Registers the parser for a file kind. Excel, DOCX and image land here.
 *
 * Keyed by `kind` rather than by id because exactly one parser can be right for a given file:
 * unlike a question *generator*, where an examiner may reasonably choose between providers,
 * there is no meaningful choice between two things that read an `.xlsx`.
 */
export function registerImportParser(parser: ImportParser): void {
  parsers.set(parser.descriptor.kind, parser);
}

export function listImportParsers(): ImportParser[] {
  return [...parsers.values()];
}

/**
 * Test seam: forget anything a test registered and restore the built-ins.
 *
 * Restores rather than merely clearing, so a suite that swapped in a fake Excel parser does not
 * leave the *real* one missing for every test that follows — which would turn a genuine 503 into
 * a passing assertion about a feature that had been switched off.
 */
export function resetImportParsers(): void {
  parsers.clear();
  for (const parser of BUILT_IN) parsers.set(parser.descriptor.kind, parser);
}

/**
 * The parser for a kind, or a 503 naming what is missing.
 *
 * A 503 rather than a 404 because an unregistered or unavailable parser is a *deployment*
 * fact, not a bad request — the same answer the generator gives for an absent
 * `GEMINI_API_KEY`, and for the same reason: the examiner is not at fault and needs to be told
 * what to fix rather than that their file was wrong.
 */
export function resolveImportParser(kind: ImportFileKind): ImportParser {
  const parser = parsers.get(kind);
  if (!parser) {
    throw ApiError.serviceUnavailable(`Importing ${kind} files is not available in this deployment.`);
  }
  if (!parser.isAvailable()) {
    throw ApiError.serviceUnavailable(
      `${parser.descriptor.label} is not configured. ${parser.descriptor.basis}`,
    );
  }
  return parser;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * The most questions one import may offer for review, whatever the environment says.
 *
 * Bulk import exists to move a large existing collection, so this is much higher than the
 * generator's twenty — but it is still a ceiling in code rather than only in configuration,
 * for the same reason: a review step that nobody can realistically complete is not a review
 * step. Five hundred is about as much as a paginated screen and one afternoon can absorb, and
 * a bigger collection should arrive as several files.
 */
export const IMPORT_HARD_MAX = 500;

/** What one import may actually offer, honouring the deployment's own lower limit. */
export function importCeiling(): number {
  return Math.min(IMPORT_HARD_MAX, config.imports.maxQuestions);
}

// ---------------------------------------------------------------------------
// Taxonomy resolution
// ---------------------------------------------------------------------------

/**
 * Where a candidate will be filed, once its file's names have been looked up.
 *
 * `reason` carries the lookup failure instead, and the two are exclusive: a candidate either
 * has somewhere to go or has a sentence explaining why it does not.
 */
interface ResolvedPlacement {
  topic: Types.ObjectId;
  subtopic: Types.ObjectId | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
}

/** One topic or subtopic, indexed by the lowercased name a file might refer to it by. */
interface TopicIndex {
  /** Top-level chapters of the subject, by lowercased name. */
  chapters: Map<string, Types.ObjectId>;
  /** Subtopics, keyed `<parent id>::<lowercased name>`, so two chapters may share a name. */
  subtopics: Map<string, Types.ObjectId>;
  /**
   * Chapter id → the name **as the taxonomy spells it**, for display.
   *
   * Kept separately because the lookup keys above are lowercased so a spreadsheet's "ALGEBRA"
   * finds "Algebra" — and reading a display name back out of those keys showed the reviewer
   * "algebra", which is the taxonomy's data mangled by our own index.
   */
  displayNames: Map<string, string>;
  /**
   * The same chapters as a list, for `lib/chapterDetection.ts`.
   *
   * Built here rather than re-read, because detection runs **per candidate** and a two-hundred-row
   * import would otherwise be two hundred reads of the same handful of chapters.
   */
  detectable: DetectableChapter[];
}

/**
 * Every active topic of one subject, indexed by name for the whole batch in one query.
 *
 * One read rather than one per row: a two-hundred-row spreadsheet naming twelve chapters would
 * otherwise be two hundred lookups, and the index is small enough that holding it for the
 * duration of a request costs nothing. Archived topics are excluded — a file may not file new
 * questions under a chapter that has been withdrawn.
 */
async function buildTopicIndex(subject: Types.ObjectId): Promise<TopicIndex> {
  const rows = await Topic.find({ subject, status: 'active' })
    .select('name parent depth description')
    .lean();

  const chapters = new Map<string, Types.ObjectId>();
  const subtopics = new Map<string, Types.ObjectId>();
  const displayNames = new Map<string, string>();
  const detectable: DetectableChapter[] = [];

  for (const row of rows) {
    const id = row._id as Types.ObjectId;
    const key = row.name.trim().toLowerCase();
    displayNames.set(String(id), row.name);
    if (row.parent) {
      subtopics.set(`${String(row.parent)}::${key}`, id);
    } else {
      chapters.set(key, id);
      detectable.push({ id: String(id), name: row.name, description: row.description ?? null });
    }
  }

  return { chapters, subtopics, displayNames, detectable };
}

/**
 * Turns what a file *said* into where a question will actually go.
 *
 * Each of the four fields falls back to the examiner's default when the file was silent, and
 * is an **error** when the file said something that does not resolve. That asymmetry is the
 * point: "the spreadsheet had no Class column" is a normal file the examiner has already
 * answered for, while "the spreadsheet says Class 13" is a mistake in the data that must be
 * shown rather than quietly replaced with a default — a question silently filed under the
 * wrong class is served to the wrong children.
 */
function resolvePlacement(
  candidate: ImportedCandidate,
  defaults: ImportDefaults,
  defaultTopic: Types.ObjectId | null,
  index: TopicIndex,
  notes: string[],
): { placement: ResolvedPlacement } | { reason: string } {
  const hint = candidate.taxonomy;

  let classLevel = defaults.classLevel;
  if (hint.classLevel !== null) {
    const stated = normaliseClassLevel(hint.classLevel);
    if (!stated) {
      return {
        reason: `"${hint.classLevel}" is not a class this platform runs. Use one of: ${CLASS_LEVELS.join(', ')}.`,
      };
    }
    classLevel = stated;
  }

  let difficulty = defaults.difficulty;
  if (hint.difficulty !== null) {
    const stated = normaliseDifficulty(hint.difficulty);
    if (!stated) {
      return { reason: `"${hint.difficulty}" is not a difficulty. Use Easy, Medium or Hard.` };
    }
    difficulty = stated;
  }

  /**
   * Where the chapter comes from, in order: **what the file said**, then **what the question looks
   * like**, then **the examiner's fallback**.
   *
   * That order is the point. A file that states a chapter is the most authoritative thing available,
   * and an unresolvable statement stays an error rather than something to detect around. Detection
   * only fills a genuine silence — and when it cannot, the row is reported rather than swept into a
   * default, because a question in the wrong chapter is served to students practising something else
   * and corrupts the topic analytics the recommendation engine reads.
   */
  // Declared without an initialiser on purpose: every branch below either assigns it or returns,
  // so a placeholder `null` would be a value nothing ever reads.
  let topic: Types.ObjectId;

  if (hint.topicName !== null) {
    const found = index.chapters.get(hint.topicName.trim().toLowerCase());
    if (!found) {
      return {
        reason: `There is no chapter called "${hint.topicName}". Create it under Chapters first, or correct the spelling.`,
      };
    }
    topic = found;
  } else {
    // The author's own tags are often more explicit than the prose, so they are evidence too.
    const haystack = [candidate.content.questionText, ...candidate.content.tags].join(' ');
    const outcome = detectChapter(haystack, index.detectable);

    if (outcome.kind === 'matched') {
      topic = new Types.ObjectId(outcome.match.topicId);
      // Announced, always. A detected chapter is exactly the thing a reviewer should check.
      notes.push(detectionNote(outcome.match));
    } else if (defaultTopic) {
      topic = defaultTopic;
    } else {
      return { reason: detectionFailureReason(outcome) };
    }
  }

  let subtopic: Types.ObjectId | null = null;
  if (hint.subtopicName !== null) {
    const found = index.subtopics.get(`${String(topic)}::${hint.subtopicName.trim().toLowerCase()}`);
    if (!found) {
      return { reason: `"${hint.subtopicName}" is not a subtopic of that chapter.` };
    }
    subtopic = found;
  }

  return { placement: { topic, subtopic, classLevel, difficulty } };
}

/**
 * Reads a class as a spreadsheet is likely to write it.
 *
 * Forgiving in exactly two ways and no further: capitalisation and spacing, and a bare number
 * (`8`, `"8"`) for `Class 8`, because a `Class` column in a real workbook is very often just
 * the digit. It is **not** fuzzy beyond that — an unrecognised value is reported rather than
 * guessed at, for the same reason `normalizeAnswerText()` forgives capitalisation and nothing
 * else: a lookup that guesses can file a question under the wrong cohort.
 */
export function normaliseClassLevel(value: string): ClassLevel | null {
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  if (trimmed.length === 0) return null;

  if (isClassLevel(trimmed)) return trimmed;

  const exact = CLASS_LEVELS.find((level) => level.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  // A bare number, or "8th", or "Grade 8".
  const digits = /^(?:class|grade|std|standard)?\s*(\d{1,2})(?:st|nd|rd|th)?$/iu.exec(trimmed);
  if (digits?.[1]) {
    const candidate = `Class ${Number(digits[1])}`;
    if (isClassLevel(candidate)) return candidate;
  }

  return null;
}

/** Reads a difficulty case-insensitively. Nothing more forgiving than that. */
export function normaliseDifficulty(value: string): Difficulty | null {
  const trimmed = value.trim().toLowerCase();
  return DIFFICULTIES.find((level) => level.toLowerCase() === trimmed) ?? null;
}

// ---------------------------------------------------------------------------
// Previewing
// ---------------------------------------------------------------------------

export interface PreviewImportInput {
  kind: ImportFileKind;
  files: Array<{ name: string; declaredType: string; data: Buffer }>;
  /**
   * The chapter to fall back on. **Optional** — see `resolvePlacement()` for the precedence:
   * what the file said, then what the question looks like, then this.
   *
   * The subject is never supplied. With a chapter it is that chapter's own; with no chapter it is
   * the platform's single active subject, because this is a mathematics olympiad and there is no
   * user-facing subject to ask for. Taking it from a request would admit a pair that disagrees.
   */
  topic?: string | null;
  subtopic?: string | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  /** The answer shape to assume when a file does not label one. Null means infer per row. */
  questionType: ImportDefaults['questionType'];
}

/** One candidate offered for review, with where it goes and what to look at twice. */
export interface PreviewedQuestion extends GeneratedCandidate {
  /** Stable only within this preview — nothing is stored, so there is no database id. */
  clientId: string;
  /** Where inside the upload it came from: `paper.xlsx — Row 14`. */
  sourceRef: string;
  topic: string;
  topicName: string;
  subtopic: string | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  /**
   * Advisory findings — the parser's own uncertainty plus `lib/questionQuality.ts`.
   *
   * Never a reason it was refused. A candidate carrying warnings is still a candidate: these
   * are the defects that are decidable but not always defects, so they are shown to the
   * reviewer and approval is not blocked by them.
   */
  warnings: QualityWarning[];
}

export interface PreviewOutcome {
  batchId: string | null;
  kind: ImportFileKind;
  parser: ImportParser['descriptor'];
  questions: PreviewedQuestion[];
  /** Refused by `createQuestionSchema`, or unplaceable in the taxonomy. With reasons. */
  rejected: RejectedCandidate[];
  /** Refused as too similar to the batch or to the bank. With what they clashed with. */
  duplicates: RejectedCandidate[];
  /** Items no parser could turn into a candidate at all, named by where they were. */
  failures: ParseFailure[];
  /** Findings about the set as a whole, e.g. the answer sitting in one position throughout. */
  batchWarnings: QualityWarning[];
  /** Per-file totals, so one unreadable photograph is visibly one failure and not ten. */
  files: ImportFileOutcome[];
  examined: number;
  /** True when the upload held more than `importCeiling()` and the tail was not read. */
  truncated: boolean;
}

/**
 * Reads the upload and returns what is worth reviewing. **Writes no questions.**
 *
 * The only thing persisted is the `ImportBatch` row, which records counts so a bad template or
 * a poor batch of photographs is diagnosable later, and which is what approval reads the
 * provenance facts back from.
 *
 * A failure in one file does not lose the others: each is parsed inside its own `try`, and a
 * file that cannot be read at all becomes a named entry in `files` with its error while every
 * other file's questions still arrive. That is the spec's requirement that "a failure for one
 * image must not corrupt or incorrectly discard the remaining valid imports", and it is why
 * the loop below does not simply `Promise.all` and let one rejection take the batch.
 */
export async function previewImport(input: PreviewImportInput, actor: Actor): Promise<PreviewOutcome> {
  const parser = resolveImportParser(input.kind);
  const startedAt = Date.now();

  const { subject, topic } = await resolveImportTarget(input.topic ?? null, input.subtopic ?? null);
  const index = await buildTopicIndex(subject);

  const defaults: ImportDefaults = {
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    questionType: input.questionType,
    marks: input.marks,
    negativeMarks: input.negativeMarks,
    topicName: null,
  };

  const ceiling = importCeiling();
  const candidates: ImportedCandidate[] = [];
  const failures: ParseFailure[] = [];
  const fileOutcomes: ImportFileOutcome[] = [];
  /**
   * Advisory findings about the **files**, as opposed to about one question.
   *
   * Added in Phase D for the case that motivated the channel: a Word document whose equations were
   * written with Word's equation editor, which `mammoth` silently drops. That is one fact about the
   * file — attaching it to fifty candidates would bury the per-question notes that actually differ,
   * and reporting it as a failure would be wrong because nothing failed.
   *
   * De-duplicated, because ten Word documents in one upload would otherwise say the same thing ten
   * times.
   */
  const fileNotes = new Set<string>();
  let examined = 0;
  let truncated = false;

  for (const file of input.files) {
    const remaining = ceiling - candidates.length;
    const outcome: ImportFileOutcome = {
      name: file.name,
      size: file.data.length,
      examined: 0,
      extracted: 0,
      failed: 0,
      error: null,
    };

    if (remaining <= 0) {
      truncated = true;
      outcome.error = `Not read: this import already reached its limit of ${ceiling} questions.`;
      fileOutcomes.push(outcome);
      continue;
    }

    const asImportFile: ImportFile = {
      name: file.name,
      kind: input.kind,
      declaredType: file.declaredType,
      bytes: file.data,
    };

    try {
      const parsed = await parser.parse({ file: asImportFile, defaults, maxCandidates: remaining });

      outcome.examined = parsed.examined;
      outcome.extracted = parsed.candidates.length;
      outcome.failed = parsed.failures.length;
      examined += parsed.examined;

      if (parsed.candidates.length >= remaining && parsed.examined > parsed.candidates.length) {
        truncated = true;
      }

      // Every reference is prefixed with the filename, because ten photographs all report
      // "Question 1" and the examiner has to know which one.
      for (const note of parsed.notes ?? []) fileNotes.add(note);

      candidates.push(...parsed.candidates.map((entry) => withFilePrefix(entry, file.name)));
      failures.push(
        ...parsed.failures.map((entry) => ({ sourceRef: `${file.name} — ${entry.sourceRef}`, reason: entry.reason })),
      );
    } catch (err) {
      // One unreadable file is a named failure, not a failed import. Its own message is kept
      // because "corrupt", "encrypted" and "that is not really a workbook" need three
      // different fixes and only the parser knows which happened.
      const detail = err instanceof Error ? err.message : 'That file could not be read.';
      outcome.error = detail.slice(0, 600);
      logger.warn({ err, file: file.name, kind: input.kind }, 'Import parser could not read a file');
    }

    fileOutcomes.push(outcome);
  }

  // ---- Placement, then the one shared screener -----------------------------

  const rejected: RejectedCandidate[] = [];
  const placeable: Array<{ candidate: ImportedCandidate; placement: ResolvedPlacement }> = [];

  for (const [position, candidate] of candidates.entries()) {
    /**
     * Detection notes join the candidate's own, so "this chapter was worked out" travels with the
     * question it is about rather than becoming a batch remark nobody can attach to a row.
     */
    const notes = [...candidate.notes];
    const resolution = resolvePlacement(candidate, defaults, topic, index, notes);
    if ('reason' in resolution) {
      rejected.push({ index: position + 1, reason: `${candidate.sourceRef}: ${resolution.reason}` });
      continue;
    }
    placeable.push({ candidate: { ...candidate, notes }, placement: resolution.placement });
  }

  const against = await bankTextFor(placeable.map((entry) => entry.placement));

  const entries: ScreenEntry[] = placeable.map(({ candidate, placement }) => ({
    candidate: candidate.content,
    target: {
      subject: String(subject),
      topic: String(placement.topic),
      subtopic: placement.subtopic ? String(placement.subtopic) : null,
      classLevel: placement.classLevel,
      difficulty: placement.difficulty,
      against: against.get(bankKey(placement)) ?? [],
    } satisfies ScreenTarget,
  }));

  const screened = screenEach(entries);
  const report = inspectCandidates(screened.accepted.map((entry) => entry.candidate));
  /**
   * The parsers' file-level notes travel in `batchWarnings` alongside the quality findings.
   *
   * One channel rather than two, because both answer the same reviewer question — "what should I
   * look at across this whole batch?" — and both are advisory. Theirs go first: "the formulas are
   * missing from this document" changes how you read every question below it.
   */
  const batchWarnings: QualityWarning[] = [
    ...[...fileNotes].map((message): QualityWarning => ({ code: 'extraction_note', message })),
    ...report.batch,
  ];
  const stamp = Date.now().toString(36);


  const questions: PreviewedQuestion[] = screened.accepted.map((entry, position) => {
    // `entry.index` is 1-based over `placeable`, which is the order `entries` was built in.
    const source = placeable[entry.index - 1]!;
    return {
      ...entry.candidate,
      clientId: `${stamp}-${entry.index}`,
      sourceRef: source.candidate.sourceRef,
      topic: String(source.placement.topic),
      topicName: index.displayNames.get(String(source.placement.topic)) ?? 'Unknown chapter',
      subtopic: source.placement.subtopic ? String(source.placement.subtopic) : null,
      classLevel: source.placement.classLevel,
      difficulty: source.placement.difficulty,
      // The parser's own uncertainty first: it is about *this* extraction rather than about
      // the question's shape, and it is what tells a reviewer to compare against the original.
      warnings: [
        ...source.candidate.notes.map((message): QualityWarning => ({ code: 'extraction_uncertain', message })),
        ...(report.perQuestion[position] ?? []),
      ],
    };
  });

  // Reasons from placement and from the schema are reported together: an examiner fixing a
  // spreadsheet does not care which of our two gates refused a row.
  const allRejected = [...rejected, ...screened.rejected];

  const batchId = await writeBatch(input, actor, parser, {
    status: 'succeeded',
    durationMs: Date.now() - startedAt,
    files: fileOutcomes,
    examined,
    accepted: questions.length,
    rejected: allRejected.length,
    duplicates: screened.duplicates.length,
    rejectionReasons: allRejected.map((entry) => entry.reason).slice(0, 10),
    topic,
    subject,
  });

  return {
    batchId,
    kind: input.kind,
    parser: parser.descriptor,
    questions,
    rejected: allRejected,
    duplicates: screened.duplicates,
    failures,
    batchWarnings,
    files: fileOutcomes,
    examined,
    truncated,
  };
}

/** `Row 14` becomes `paper.xlsx — Row 14`, so ten files' references stay distinguishable. */
function withFilePrefix(candidate: ImportedCandidate, fileName: string): ImportedCandidate {
  return { ...candidate, sourceRef: `${fileName} — ${candidate.sourceRef}` };
}

/**
 * The chapter the batch defaults to, and the subject it implies.
 *
 * The subject is **derived**, never accepted: with a chapter it is that chapter's own, and with no
 * chapter it is the platform's single active subject. Taking it from a request would admit a pair
 * that disagrees, and there is no user-facing subject to ask for. The depth check matters for the
 * same reason it does in `resolveTaxonomy()` — a subtopic in the `topic` position would produce
 * questions no filter could find.
 */

async function resolveImportTarget(
  topicId: string | null,
  subtopicId: string | null,
): Promise<{ subject: Types.ObjectId; topic: Types.ObjectId | null }> {
  if (!topicId) {
    if (subtopicId) {
      // A subtopic without its chapter is not a placement; it is half of one.
      throw ApiError.badRequest('Choose the chapter that subtopic belongs to, or leave both blank.');
    }
    // `requireImplicitSubject()` rather than the tolerant variant: this is a *write* path, and
    // filing questions under a guessed subject would make them invisible to every filter.
    return { subject: await requireImplicitSubject(), topic: null };
  }

  const topic = await Topic.findById(topicId).select('subject depth status');
  if (!topic) throw ApiError.badRequest('That chapter does not exist.');
  if (topic.depth !== 0) {
    throw ApiError.badRequest('Choose a chapter, not a subtopic. A subtopic goes in its own field.');
  }
  if (topic.status !== 'active') {
    throw ApiError.badRequest('That chapter is archived, so new questions cannot be filed under it.');
  }

  const subject = await Subject.findById(topic.subject).select('status');
  if (!subject) throw ApiError.badRequest('That chapter belongs to a subject that no longer exists.');

  if (subtopicId) {
    const subtopic = await Topic.findById(subtopicId).select('parent');
    if (!subtopic) throw ApiError.badRequest('That subtopic does not exist.');
    if (String(subtopic.parent) !== String(topic._id)) {
      throw ApiError.badRequest('That subtopic does not belong to the selected chapter.');
    }
  }

  return { subject: subject._id as Types.ObjectId, topic: topic._id as Types.ObjectId };
}

/** The duplicate-detection key: a question is only compared against its own chapter and class. */
function bankKey(placement: Pick<ResolvedPlacement, 'topic' | 'classLevel'>): string {
  return `${String(placement.topic)}::${placement.classLevel}`;
}

/**
 * The question text already in the bank, for every (chapter, class) the batch touches.
 *
 * One query per distinct pair rather than one per candidate: a two-hundred-row import usually
 * touches a handful of pairs, and the alternative is two hundred reads of the same chapter.
 * Bounded at 200 texts per pair for the same reason generation bounds it — the comparison is
 * O(rows × bank) and an unbounded bank would make a large import quadratic.
 */
async function bankTextFor(placements: readonly ResolvedPlacement[]): Promise<Map<string, string[]>> {
  const pairs = new Map<string, { topic: Types.ObjectId; classLevel: ClassLevel }>();
  for (const placement of placements) {
    pairs.set(bankKey(placement), { topic: placement.topic, classLevel: placement.classLevel });
  }

  const result = new Map<string, string[]>();
  await Promise.all(
    [...pairs].map(async ([key, pair]) => {
      const rows = await Question.find({ topic: pair.topic, classLevel: pair.classLevel })
        .select('questionText')
        .limit(200)
        .lean();
      result.set(
        key,
        rows.map((row) => row.questionText),
      );
    }),
  );

  return result;
}

// ---------------------------------------------------------------------------
// The dry run
// ---------------------------------------------------------------------------

/** One reviewed candidate as the screen sends it back to be checked. */
export interface ValidateImportQuestion extends GeneratedCandidate {
  topic: string;
  subtopic: string | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
}

export interface ValidateImportOutcome {
  /** One verdict per question sent, positionally, so the screen can label each card. */
  verdicts: Array<{ index: number; ok: boolean; reason: string | null; warnings: QualityWarning[] }>;
  batchWarnings: QualityWarning[];
  /** How many would be saved if the examiner approved right now. */
  wouldSave: number;
}

/**
 * Answers "would these save?" without saving them.
 *
 * Exists for exactly the reason the generator's dry run does, and the reason is worth restating
 * because an import batch is twenty-five times larger: **the examiner edits these questions, and an
 * edit can break a rule.** The commonest is unticking one correct option and forgetting to tick
 * another. Without this, the only way to find out is to press Approve and read which of two hundred
 * were refused, having already saved the rest.
 *
 * It calls **`screenEach()`** — the same function approval calls. That is the whole value: the
 * answer is not an approximation of what approval will do, it is the same code. A check that passes
 * where the save would fail is worse than no check.
 *
 * It **writes nothing**, not even a batch counter — nothing happened that a later reader would want
 * to know about, and a row per keystroke would bury the imports that matter. That is also why it is
 * not rate limited: an examiner should be able to check their corrections as often as they like,
 * precisely so they are not pressing Approve to find out.
 */
export async function validateImport(input: {
  questions: ValidateImportQuestion[];
}): Promise<ValidateImportOutcome> {
  /**
   * The bank is re-read rather than trusted from the earlier preview: somebody else may have added
   * a colliding question in the meantime, and catching that before it becomes two near-identical
   * rows is part of what this is for.
   */
  const placements = input.questions.map((question) => ({
    topic: new Types.ObjectId(question.topic),
    subtopic: question.subtopic ? new Types.ObjectId(question.subtopic) : null,
    classLevel: question.classLevel,
    difficulty: question.difficulty,
  }));

  const against = await bankTextFor(placements);

  // The subject is derived from each question's own topic rather than accepted, exactly as it is on
  // the approval path — so a client cannot pair a topic with a subject it does not belong to.
  const subjectByTopic = await subjectsFor(placements.map((placement) => placement.topic));

  const entries: ScreenEntry[] = input.questions.map((question, position) => {
    const placement = placements[position]!;
    return {
      candidate: question,
      target: {
        subject: subjectByTopic.get(String(placement.topic)) ?? '',
        topic: question.topic,
        subtopic: question.subtopic,
        classLevel: question.classLevel,
        difficulty: question.difficulty,
        against: against.get(bankKey(placement)) ?? [],
      } satisfies ScreenTarget,
    };
  });

  const screened = screenEach(entries);
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

/** Which subject each of these topics belongs to, in one read. */
async function subjectsFor(topics: readonly Types.ObjectId[]): Promise<Map<string, string>> {
  const unique = [...new Set(topics.map((topic) => String(topic)))];
  const rows = await Topic.find({ _id: { $in: unique } })
    .select('subject')
    .lean();
  return new Map(rows.map((row) => [String(row._id), String(row.subject)]));
}

// ---------------------------------------------------------------------------
// Approving — the only path that writes
// ---------------------------------------------------------------------------

/** One reviewed candidate, carrying its own placement because an import files row by row. */
export interface ApprovedImportQuestion extends GeneratedCandidate {
  topic: string;
  subtopic: string | null;
  classLevel: ClassLevel;
  difficulty: Difficulty;
  /** The screen's own report that the examiner changed it. Recorded, never trusted. */
  edited?: boolean;
}

export interface ApproveImportInput {
  batchId: string;
  questions: ApprovedImportQuestion[];
}

export interface ApproveImportOutcome {
  created: QuestionDocument[];
  rejected: RejectedCandidate[];
}

/**
 * Writes the approved questions.
 *
 * Re-validates every one from scratch, for the reason at the top of this file: what arrives is
 * whatever the browser sent, corrections included.
 *
 * ## Provenance is recovered, not accepted
 *
 * Every row is stamped with how it entered the bank, and those facts are read back from **our
 * own `ImportBatch` row** using the id we issued rather than taken from the request body. The
 * one field worth lying about is `source`: a client that could set it could file questions read
 * off a photograph by a model as hand-written ones. The browser supplies only the batch id.
 *
 * ## Why the placement is accepted from the client here
 *
 * Unlike the generator's approval — where the taxonomy arrives once for the batch precisely so
 * a *model* cannot scatter questions — each row carries its own chapter and class. That is
 * safe for a different reason rather than by the same rule: a human reviewer chose these on the
 * review screen, and every id is checked by `createQuestion()`'s own `resolveTaxonomy()`, which
 * refuses a topic outside the subject, a subtopic outside the topic, and a class outside
 * `CLASS_LEVELS`. A client cannot invent a placement; it can only choose an existing one.
 */
export async function approveImport(input: ApproveImportInput, actor: Actor): Promise<ApproveImportOutcome> {
  const origin = await readImportOrigin(input.batchId);
  const created: QuestionDocument[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const [index, candidate] of input.questions.entries()) {
    const parsed = createQuestionSchema.safeParse({
      ...candidate,
      // The subject is not accepted from the client at all: it is whatever the chosen topic
      // belongs to, resolved inside `createQuestion()`. Passing the topic's own subject keeps
      // the pair consistent by construction rather than by validation.
      subject: origin.subjectId,
      topic: candidate.topic,
      subtopic: candidate.subtopic,
      classLevel: candidate.classLevel,
      difficulty: candidate.difficulty,
    });

    if (!parsed.success) {
      rejected.push({ index: index + 1, reason: reasonFrom(parsed.error) });
      continue;
    }

    try {
      created.push(
        await createQuestion(toQuestionContent(parsed.data), actor, {
          ...origin.provenance,
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

  if (created.length > 0) {
    // Best-effort, exactly like an audit write: the questions are saved, and failing the
    // examiner's approval because a diagnostic row would not update is the wrong trade.
    await ImportBatch.updateOne({ _id: input.batchId }, { $inc: { approved: created.length } }).catch(
      (err: unknown) => logger.error({ err, batchId: input.batchId }, 'Could not record approval against the import batch'),
    );
  }

  return { created, rejected };
}

/**
 * Records that the examiner discarded candidates.
 *
 * Nothing was stored, so rejecting is genuinely just not approving — but the *count* is the one
 * fact about an import that nothing else could recover, and it is what says whether a template
 * or a batch of photographs is actually producing usable questions. Without it the row shows
 * forty accepted and is silent about the examiner having kept three.
 */
export async function recordImportRejections(batchId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await ImportBatch.updateOne({ _id: batchId }, { $inc: { rejectedByReviewer: count } }).catch((err: unknown) =>
    logger.error({ err, batchId }, 'Could not record rejections against the import batch'),
  );
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Which `QuestionSource` a file kind becomes. The one mapping, so it cannot drift. */
const SOURCE_FOR_KIND: Record<ImportFileKind, QuestionSource> = {
  excel: 'excel_import',
  docx: 'docx_import',
  image: 'image_import',
};

/**
 * What the import batch says about how this question entered the bank.
 *
 * Read from the database rather than the request for the reason above. Unlike the generator's
 * equivalent, a missing batch is a **hard failure** rather than a degraded stamp: the batch is
 * also where the subject comes from, so without it there is nowhere to file the questions and
 * nothing to fall back to that would not be a guess.
 */
async function readImportOrigin(
  batchId: string,
): Promise<{ provenance: QuestionProvenance; subjectId: string }> {
  const row = await ImportBatch.findById(batchId)
    .select('kind parserId extraction modelName defaultTopic subject createdAt')
    .lean();
  if (!row) {
    throw ApiError.badRequest('That import has expired or was never started. Upload the file again.');
  }

  /**
   * The subject comes from the batch row itself.
   *
   * It used to be derived from `defaultTopic`, which stopped working when the chapter became
   * optional — an import that left the chapter to detection had no chapter to derive from, and
   * would have been unapprovable for a reason the examiner could do nothing about. The fallback to
   * the chapter's own subject covers rows written before this field existed.
   */
  let subjectId = row.subject ? String(row.subject) : null;
  if (!subjectId && row.defaultTopic) {
    const topic = await Topic.findById(row.defaultTopic).select('subject').lean();
    subjectId = topic ? String(topic.subject) : null;
  }
  if (!subjectId) {
    throw ApiError.badRequest('This import no longer records where its questions belong. Upload the file again.');
  }

  return {
    subjectId,
    provenance: {
      source: SOURCE_FOR_KIND[row.kind],
      generatorId: row.parserId,
      // `'model'` only for the image path, where one really read the file. For Excel and DOCX
      // this is `'deterministic'`, which is a statement of fact rather than a label — see the
      // "do not label anything AI unless a model produced it" rule in CLAUDE.md.
      generatorKind: row.extraction,
      modelName: row.modelName,
      generatedAt: row.createdAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

interface BatchOutcomeFields {
  status: 'succeeded' | 'failed';
  durationMs: number;
  files: ImportFileOutcome[];
  examined: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  rejectionReasons: string[];
  /** The fallback chapter, or null when the examiner left it to detection. */
  topic: Types.ObjectId | null;
  /** The subject everything was filed into. Recorded because approval reads it back. */
  subject: Types.ObjectId;
  error?: string;
}

/**
 * Writes the batch row.
 *
 * **Not** best-effort, unlike `GenerationLog`: approval reads the provenance and the subject
 * back from this row, so an import whose row did not write has nowhere to file its questions.
 * A generation can degrade to "AI-assisted, model unknown" and still save; this cannot degrade
 * to "imported from something" without inventing the subject. Failing here loses nothing but
 * the parse, which is deterministic and repeatable for Excel and DOCX.
 */
async function writeBatch(
  input: PreviewImportInput,
  actor: Actor,
  parser: ImportParser,
  outcome: BatchOutcomeFields,
): Promise<string> {
  const row = await ImportBatch.create({
    actor: actor.id,
    actorLabel: actor.label,
    kind: input.kind,
    parserId: parser.descriptor.id,
    extraction: parser.descriptor.extraction,
    modelName: parser.descriptor.extraction === 'model' ? config.ai.geminiModel : null,
    files: outcome.files,
    defaultClassLevel: input.classLevel,
    defaultDifficulty: input.difficulty,
    defaultTopic: outcome.topic,
    subject: outcome.subject,
    status: outcome.status,
    examined: outcome.examined,
    accepted: outcome.accepted,
    rejected: outcome.rejected,
    duplicates: outcome.duplicates,
    rejectionReasons: outcome.rejectionReasons,
    durationMs: outcome.durationMs,
    error: outcome.error ?? null,
  });
  return String(row._id);
}
