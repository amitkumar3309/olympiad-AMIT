/**
 * Working out which chapter a question belongs to, from its own text.
 *
 * ## Why this is deterministic and not a model call
 *
 * The same reasoning as the Phase D decision against AI for `.docx`: the signal is **already in the
 * text**, so a model would add cost, latency and a third party to recover something a comparison
 * can recover — and it would make a *core* authoring path depend on `GEMINI_API_KEY`, which the rest
 * of the product is required to work without. A chapter guess is also exactly the kind of claim a
 * model makes confidently and wrongly.
 *
 * ## It suggests; it never decides
 *
 * Every detection is reported to the examiner as a **note naming what it matched on**, and the
 * review screen lets them change it. When it cannot tell — nothing matches, or two chapters match
 * equally well — it says so and the row is reported rather than filed somewhere plausible. That is
 * the same rule the importers follow: *never guess quietly*. A question filed under the wrong
 * chapter is not a cosmetic problem; it is served to a student practising something else, and it
 * corrupts the topic analytics the recommendation engine reads.
 *
 * ## Pure, like the reward catalogues
 *
 * A function of a string and a list of chapter names. No database, no configuration, no I/O — so
 * every detection is reproducible from its inputs and testable without a fixture.
 */

/** Words that carry no topical signal, so their presence must not match a chapter. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'to', 'in', 'on', 'at', 'for',
  'if', 'what', 'which', 'find', 'value', 'values', 'following', 'given', 'that', 'this', 'from',
  'by', 'be', 'with', 'its', 'his', 'her', 'their', 'has', 'have', 'how', 'many', 'much', 'then',
  'let', 'using', 'use', 'show', 'prove', 'state', 'write', 'solve', 'calculate', 'evaluate',
  'question', 'answer', 'options', 'option', 'marks', 'mark', 'class', 'chapter',
]);

/**
 * Irregular plurals and pairs that no suffix rule gets right.
 *
 * Deliberately short and mathematical: these are the words that actually appear in chapter names in
 * this syllabus and would otherwise fail to match the singular a question uses. A long list would be
 * a table to maintain; this is six pairs that each earn their place.
 */
const ALIASES: Record<string, string> = {
  matrices: 'matrix',
  indices: 'index',
  vertices: 'vertex',
  radii: 'radius',
  foci: 'focus',
  loci: 'locus',
};

/** The shortest a word may be to count as topical evidence at all. */
const MIN_WORD = 3;

/** How much of a shared prefix makes two related words the same idea. */
const PREFIX_MATCH = 5;

/**
 * Reduces a word to a comparable stem.
 *
 * Crude on purpose. A real stemmer is a dependency and a black box; this handles the endings that
 * actually differ between a chapter name and a question ("Integrals" / "integral", "Matrices" /
 * "matrix", "Derivatives" / "derivative") and is short enough to read.
 */
export function stem(word: string): string {
  const bare = word.toLowerCase().replace(/[^a-z0-9]/gu, '');
  if (bare.length === 0) return '';
  if (ALIASES[bare]) return ALIASES[bare];

  if (bare.endsWith('ies') && bare.length > 4) return `${bare.slice(0, -3)}y`;

  /**
   * `-es` is only a two-letter plural after a sibilant (`boxes` → `box`, `matches` → `match`).
   *
   * Applying it everywhere was a real bug: `derivatives` became `derivativ` while `derivative`
   * stayed whole, so the two never compared equal and detection was leaning entirely on the loose
   * prefix fallback below — which happened to work here and would not for a shorter word.
   */
  if (/(?:s|x|z|ch|sh)es$/u.test(bare) && bare.length > 4) return bare.slice(0, -2);

  if (bare.endsWith('s') && !bare.endsWith('ss') && bare.length > 3) return bare.slice(0, -1);
  return bare;
}

/** The topical words of a piece of text, stemmed and de-duplicated. */
export function topicalWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    // LaTeX delimiters and punctuation are noise; the words around them are the signal.
    .replace(/\$[^$]*\$/gu, ' ')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length >= MIN_WORD && !STOP_WORDS.has(word))
    .map(stem)
    .filter((word) => word.length >= MIN_WORD);

  return new Set(words);
}

/** Whether two stems name the same idea. */
function sameIdea(a: string, b: string): boolean {
  if (a === b) return true;
  // "integral" / "integrate", "differentiability" / "differentiation".
  if (a.length >= PREFIX_MATCH && b.length >= PREFIX_MATCH) {
    return a.slice(0, PREFIX_MATCH) === b.slice(0, PREFIX_MATCH);
  }
  return false;
}

/** One chapter, as the detector needs to see it. */
export interface DetectableChapter {
  id: string;
  name: string;
  /** The chapter's own description, if it has one — more words to match against. */
  description?: string | null;
}

export interface ChapterMatch {
  topicId: string;
  topicName: string;
  /** Proportion of the chapter's own topical words found in the question (0–1). */
  score: number;
  /** Which words matched, so the note can say *why* rather than just asserting. */
  matchedWords: string[];
}

export type DetectionOutcome =
  | { kind: 'matched'; match: ChapterMatch }
  /** Two or more chapters fit equally well. Naming them is more use than picking one. */
  | { kind: 'ambiguous'; between: string[] }
  | { kind: 'none' };

/**
 * At least this proportion of a chapter's words must appear for it to be a candidate.
 *
 * A half rather than everything, so "Applications of Derivatives" matches a question about
 * derivatives without also demanding the word "applications". Below a half is not evidence: a
 * three-word chapter matching one word is usually a coincidence.
 */
const MIN_SCORE = 0.5;

/**
 * Which chapter a question looks like it belongs to.
 *
 * `haystack` is everything about the question worth matching on — the text, and the author's own
 * tags, which are often more explicit than the prose.
 *
 * Returns `ambiguous` rather than picking a winner when two chapters score identically. That is the
 * case where a guess is most likely to be wrong and least likely to be noticed: both answers look
 * reasonable to a reviewer skimming, so the honest move is to make them choose.
 */
export function detectChapter(haystack: string, chapters: readonly DetectableChapter[]): DetectionOutcome {
  const questionWords = topicalWords(haystack);
  if (questionWords.size === 0 || chapters.length === 0) return { kind: 'none' };

  const scored: ChapterMatch[] = [];

  for (const chapter of chapters) {
    // The chapter's *name* is the evidence; its description only adds words, and matching on a
    // description alone would let a chatty description hijack every question.
    const nameWords = [...topicalWords(chapter.name)];
    if (nameWords.length === 0) continue;

    const matched: string[] = [];
    for (const word of nameWords) {
      if ([...questionWords].some((candidate) => sameIdea(word, candidate))) matched.push(word);
    }

    // A description match counts only as a tie-breaker, never as the reason for a match.
    const score = matched.length / nameWords.length;
    if (score >= MIN_SCORE && matched.length > 0) {
      scored.push({ topicId: chapter.id, topicName: chapter.name, score, matchedWords: matched });
    }
  }

  if (scored.length === 0) return { kind: 'none' };

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.matchedWords.length - a.matchedWords.length ||
      // A longer matched word is stronger evidence than a shorter one.
      Math.max(...b.matchedWords.map((w) => w.length)) - Math.max(...a.matchedWords.map((w) => w.length)) ||
      a.topicName.localeCompare(b.topicName),
  );

  const best = scored[0]!;
  const runnerUp = scored[1];

  /**
   * Refuse to choose between two equally-good fits.
   *
   * Equal score *and* equal evidence means the text genuinely does not distinguish them — a question
   * about "integrals" with both "Integrals" and "Applications of Integrals" in the syllabus, for
   * instance. Picking one would be a coin toss presented as a decision.
   */
  if (
    runnerUp &&
    runnerUp.score === best.score &&
    runnerUp.matchedWords.length === best.matchedWords.length &&
    Math.max(...runnerUp.matchedWords.map((w) => w.length)) === Math.max(...best.matchedWords.map((w) => w.length))
  ) {
    return {
      kind: 'ambiguous',
      between: scored
        .filter((entry) => entry.score === best.score && entry.matchedWords.length === best.matchedWords.length)
        .map((entry) => entry.topicName),
    };
  }

  return { kind: 'matched', match: best };
}

/** The note shown beside a question whose chapter was worked out rather than stated. */
export function detectionNote(match: ChapterMatch): string {
  return `Chapter was not given, so it was read as "${match.topicName}" from the words ${match.matchedWords
    .map((word) => `"${word}"`)
    .join(', ')}. Check it before approving.`;
}

/** The reason reported when a chapter could not be worked out. */
export function detectionFailureReason(outcome: DetectionOutcome): string {
  if (outcome.kind === 'ambiguous') {
    return `No chapter was given, and this could belong to ${outcome.between
      .map((name) => `"${name}"`)
      .join(' or ')}. Choose a chapter for the upload, or set one on this question.`;
  }
  return 'No chapter was given and none could be worked out from the question. Choose a chapter for the upload, or add a Topic column.';
}
