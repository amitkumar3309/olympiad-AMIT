import type { Difficulty, QuestionType } from '../models';
import type { ClassLevel } from './classLevels';
import type { GeneratedCandidate } from './questionGeneratorTypes';

/**
 * THE contract for a bulk question importer (Milestone 21).
 *
 * ## One canonical candidate, deliberately
 *
 * There is no `ExcelQuestion`, no `DocxQuestion` and no `ImageQuestion`, and there must
 * never be one. Every importer normalises into `ImportedCandidate`, whose content half is
 * **`GeneratedCandidate` verbatim** — the same shape the AI generator produces and the same
 * shape `createQuestionSchema` validates. That is what makes the question bank unable to
 * tell where a question came from, which is the whole point: a spreadsheet row, a paragraph
 * in a Word file, a photograph of a past paper and a model's draft all become the same kind
 * of thing before anything decides whether to keep them.
 *
 * The alternative — a type per format — would mean a validator per format, and the weakest
 * one would decide what got into the bank.
 *
 * ## The safety property, inherited unchanged from the generator
 *
 * **A parser produces a candidate. It does not produce a question.**
 *
 * Nothing here is trusted. Every candidate is parsed by `createQuestionSchema`, including
 * `validateMathContent()`, exactly as a hand-authored question is; a failure is **reported
 * with its reason, never repaired**; and **nothing is written until a human approves it**
 * (`services/questionImportService.ts`). An importer reads a file the examiner chose, which
 * makes it a *more* trustworthy source than a language model and still not a trusted one —
 * an OCR'd answer key can be confidently wrong in exactly the way a model's can.
 *
 * ## Why the taxonomy is a *hint* here, and an id in the generator
 *
 * `GeneratedCandidate` carries no taxonomy at all, and `lib/questionGeneratorTypes.ts`
 * explains why: a model must not be able to file a question anywhere it was not asked to.
 * An import is different in one specific way — a spreadsheet legitimately has a `Class` and
 * a `Topic` column, and a file of two hundred questions spanning six chapters is the normal
 * case rather than an attack.
 *
 * So an importer may *suggest* a taxonomy, but only as **names as they were written in the
 * file** (`ImportedTaxonomyHint`). It never sees or supplies an id. Resolving a name to a
 * real `Topic` is the service's job, against the live taxonomy, and a name that resolves to
 * nothing is a validation error the examiner fixes on the review screen — not a topic that
 * gets created, and not a row that gets filed somewhere plausible-looking.
 */

// ---------------------------------------------------------------------------
// What kind of file this is
// ---------------------------------------------------------------------------

/**
 * The upload formats the product accepts.
 *
 * Deliberately a *kind* rather than a MIME type or an extension: three extensions and five
 * MIME types map onto these three parsing strategies, and the rest of the pipeline only
 * ever needs to know which strategy applies.
 */
export const IMPORT_FILE_KINDS = ['excel', 'docx', 'image'] as const;
export type ImportFileKind = (typeof IMPORT_FILE_KINDS)[number];

/**
 * One uploaded file, in memory.
 *
 * **`name` is a label, never a path.** It is echoed into reports so an examiner can tell
 * which of ten photographs failed, and it is never joined onto a directory, opened, or used
 * to decide anything — the *validated* `kind` decides which parser runs. Nothing in this
 * feature touches the filesystem at all: uploads arrive as base64 inside the JSON body
 * (the same route the registration photo and the event gallery take) and are parsed from a
 * `Buffer`. Temporary-file cleanup, safe filenames and path traversal are therefore not
 * mitigated risks here, they are absent ones.
 */
export interface ImportFile {
  /** The examiner's own filename. For reports only. Never a path. */
  name: string;
  kind: ImportFileKind;
  /** The MIME type as declared by the client. The weakest of the three signals. */
  declaredType: string;
  bytes: Buffer;
}

// ---------------------------------------------------------------------------
// What a parser is asked for
// ---------------------------------------------------------------------------

/**
 * What to assume when a file does not say.
 *
 * Every one of these is a field `Question` requires and a DOCX or a photograph will almost
 * never carry. The examiner sets them once for the upload; a file that *does* specify a
 * class or a difficulty per row overrides them per row.
 *
 * `marks` and `negativeMarks` have no per-row override from a model in the generator — the
 * paper's price is the examiner's — but a spreadsheet may legitimately price its own rows,
 * so an importer may fill them from the file.
 */
export interface ImportDefaults {
  classLevel: ClassLevel;
  difficulty: Difficulty;
  /**
   * The answer shape to assume when a file does not label one. `null` means the parser
   * should infer it from the row's own shape (an options column implies a choice question),
   * and report the row as needing review if it cannot.
   */
  questionType: QuestionType | null;
  marks: number;
  negativeMarks: number;
  /** The topic every row is filed under unless the row names its own. */
  topicName: string | null;
}

export interface ParseInput {
  file: ImportFile;
  defaults: ImportDefaults;
  /**
   * The most candidates the parser may return from this one file.
   *
   * A hard bound passed in rather than read from config inside a parser, so that a parser
   * cannot be the thing that decides how large an import may be — see
   * `services/questionImportService.ts`, which owns the limit and reports what it dropped
   * rather than silently truncating.
   */
  maxCandidates: number;
}

// ---------------------------------------------------------------------------
// What a parser returns
// ---------------------------------------------------------------------------

/**
 * Where a question belongs, **as the file said it** — names, never ids.
 *
 * All four are nullable because all four are routinely absent: a photograph of a past paper
 * says nothing about which chapter it is from. A `null` means "the file did not say", which
 * the service resolves from `ImportDefaults`. A non-null value that resolves to nothing is
 * an error reported against that candidate, never a `Topic` that gets created — an importer
 * that could add taxonomy rows would let one bad spreadsheet reshape the syllabus.
 */
export interface ImportedTaxonomyHint {
  classLevel: string | null;
  topicName: string | null;
  subtopicName: string | null;
  difficulty: string | null;
}

/**
 * One question an importer extracted.
 *
 * `content` is `GeneratedCandidate` unchanged — see the note at the top of this file for
 * why there is exactly one candidate representation in this codebase.
 */
export interface ImportedCandidate {
  content: GeneratedCandidate;
  taxonomy: ImportedTaxonomyHint;
  /**
   * Where inside the upload this came from, phrased for a human: `Row 14`, `Question 3`,
   * `paper-page-2.jpg`. Every message about this candidate names it this way, because
   * "row 14 is missing its correct answer" is actionable and "a row is missing its correct
   * answer" is not.
   */
  sourceRef: string;
  /**
   * What the parser was unsure about: an unreadable region, a missing answer column, a
   * question that appears to reference a diagram.
   *
   * **Advisory only, exactly like `lib/questionQuality.ts`.** A note never rejects a
   * candidate and never blocks approval — it is shown beside the question so the reviewer
   * looks harder at that one. The rules that are always defects live in
   * `createQuestionSchema` and reject there.
   */
  notes: string[];
}

/** An item the parser could not turn into a candidate at all. Reported, never swallowed. */
export interface ParseFailure {
  sourceRef: string;
  reason: string;
}

export interface ParseOutcome {
  candidates: ImportedCandidate[];
  failures: ParseFailure[];
  /**
   * Advisory findings about the **file as a whole**, rather than about one question.
   *
   * Added in Phase D for the case that motivated it: a Word document containing equations written
   * with Word's own equation editor, which `mammoth` silently drops. That is one fact about the
   * file, not fifty facts about fifty questions — attaching it to every candidate would bury the
   * per-question notes that actually differ, and reporting it as a failure would be wrong because
   * nothing failed.
   *
   * Surfaced by the service in `batchWarnings`, alongside the findings from
   * `lib/questionQuality.ts`, and **never a rejection** — the same rule that module follows.
   */
  notes?: string[];
  /**
   * How many items the file appeared to contain — rows, detected question blocks, images.
   *
   * Reported separately from `candidates.length + failures.length` because they can differ
   * legitimately: a spreadsheet's blank trailing rows are examined and are neither
   * candidates nor failures, and silently dropping them would make the totals on the review
   * screen unexplainable.
   */
  examined: number;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** How a parser describes itself. `kind` is a statement of fact, not a label. */
export interface ImportParserDescriptor {
  id: string;
  label: string;
  kind: ImportFileKind;
  /**
   * Whether a language model reads the file.
   *
   * `'deterministic'` for Excel and DOCX: the same file parses to the same questions every
   * time, and no third party sees it. `'model'` only when a real model is called, which is
   * the image path. It is a fact the UI prints and the audit trail records — never a label
   * chosen for how it sounds. See the `EngineDescriptor.kind` rule in CLAUDE.md.
   */
  extraction: 'deterministic' | 'model';
  /** One sentence the UI shows verbatim, describing what this parser can and cannot do. */
  basis: string;
}

/**
 * The interface a format implements.
 *
 * Adding a format is: implement this, `registerImportParser(yours)`. Nothing about the
 * routes, the validation, the duplicate detection, the review screen or the approval path
 * changes — they all speak `ImportedCandidate`, which is format-agnostic by construction.
 */
export interface ImportParser {
  readonly descriptor: ImportParserDescriptor;
  /** False when the parser cannot run — an image parser with no model credential. */
  isAvailable(): boolean;
  /**
   * May throw for a file that cannot be read at all (corrupt, encrypted, not really the
   * format it claims). A file that reads but yields nothing usable is **not** a throw: it
   * is an empty `candidates` with populated `failures`, because the examiner needs to be
   * told what was wrong with their file rather than that "it failed".
   */
  parse(input: ParseInput): Promise<ParseOutcome>;
}
