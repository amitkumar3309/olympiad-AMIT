/**
 * How mathematical content is represented, and why it is safe.
 *
 * A question is stored as **plain text with LaTeX islands**: `$...$` for inline
 * math and `$$...$$` for display math. Nothing is ever stored as HTML, and nothing
 * stored here is ever inserted into the DOM as HTML — the frontend splits the same
 * text into segments and renders literal text as React text nodes, handing only
 * the LaTeX to KaTeX (see `frontend/src/components/MathText.tsx`). That split is
 * the actual safety property: author-controlled prose can never become markup,
 * because it never takes the HTML path at all.
 *
 * This module is the storage-boundary half. It guarantees that what lands in
 * MongoDB is well-formed enough to render, and rejects the LaTeX constructs that
 * are dangerous regardless of renderer. Doing it here rather than only at render
 * time means a second consumer — an export, an email, a future PDF generator —
 * inherits the same guarantee instead of having to re-derive it.
 */

/** Longest single LaTeX island. A legitimate expression is far shorter than this. */
const MAX_MATH_SEGMENT_LENGTH = 500;

/** Most math islands one question may contain, as a cheap complexity bound. */
const MAX_MATH_SEGMENTS = 40;

/**
 * LaTeX commands refused outright.
 *
 * These are not "probably fine but let's be strict" — each is a real vector:
 *
 * - `\href`, `\url`: inject a clickable link into what should be an equation.
 *   KaTeX only honours them when `trust: true`, which we do not set — but relying
 *   on one render-time flag for a stored-content guarantee is exactly the kind of
 *   single point of failure that stops being true when someone adds MathJax or
 *   flips a default.
 * - `\includegraphics`, `\input`, `\include`, `\write`, `\openout`, `\read`: file
 *   and I/O access in a real TeX pipeline. Harmless in KaTeX, catastrophic if the
 *   content is ever fed to one.
 * - `\def`, `\let`, `\newcommand`, `\renewcommand`, `\csname`, `\expandafter`,
 *   `\catcode`, `\loop`, `\repeat`: macro definition and expansion. These enable
 *   exponential-expansion denial of service (the "billion laughs" shape) inside a
 *   renderer that runs in the reader's browser.
 */
const FORBIDDEN_COMMANDS = [
  'href',
  'url',
  'includegraphics',
  'input',
  'include',
  'write',
  'openout',
  'read',
  'def',
  'let',
  'newcommand',
  'renewcommand',
  'providecommand',
  'csname',
  'expandafter',
  'catcode',
  'loop',
  'repeat',
  'special',
  'immediate',
] as const;

const FORBIDDEN_COMMAND_PATTERN = new RegExp(`\\\\(?:${FORBIDDEN_COMMANDS.join('|')})(?![a-zA-Z])`, 'i');

/**
 * Markup-ish sequences refused anywhere in the text, math or prose.
 *
 * The rendering path never treats this content as HTML, so none of these can
 * execute as things stand. They are refused anyway because their *presence* means
 * either an attack attempt or a confused author, and because "this string is never
 * interpreted as markup" is a property of today's frontend rather than of the data.
 */
const MARKUP_PATTERN =
  /<\s*\/?\s*(?:script|iframe|object|embed|style|svg|img|link|meta|base)\b|javascript\s*:|data\s*:\s*text\/html|\son[a-z]+\s*=/i;

/** C0/C1 control characters, except tab (09), newline (0A) and carriage return (0D). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; value: string }
  | { kind: 'display'; value: string };

export interface MathParseFailure {
  ok: false;
  error: string;
}

export interface MathParseSuccess {
  ok: true;
  segments: MathSegment[];
}

export type MathParseResult = MathParseSuccess | MathParseFailure;

/**
 * Splits text into literal-prose and LaTeX segments.
 *
 * `frontend/src/components/MathText.tsx` implements the *same* algorithm. It is
 * kept deliberately simple — a single left-to-right scan with no lookbehind and no
 * nesting — precisely so the two copies can be checked against each other by
 * reading them. If this ever grows a special case, the frontend copy must grow the
 * identical one, or content will validate on the server and render differently in
 * the browser.
 */
export function parseMathSegments(input: string): MathParseResult {
  const segments: MathSegment[] = [];
  let text = '';
  let index = 0;
  let mathCount = 0;

  const flushText = () => {
    if (text.length > 0) {
      segments.push({ kind: 'text', value: text });
      text = '';
    }
  };

  while (index < input.length) {
    const char = input[index]!;

    // An escaped dollar is a literal dollar sign, not a delimiter.
    if (char === '\\' && input[index + 1] === '$') {
      text += '$';
      index += 2;
      continue;
    }

    if (char !== '$') {
      text += char;
      index += 1;
      continue;
    }

    const isDisplay = input[index + 1] === '$';
    const openLength = isDisplay ? 2 : 1;
    const closeToken = isDisplay ? '$$' : '$';
    const searchFrom = index + openLength;

    // Find the matching closer, skipping escaped dollars.
    let cursor = searchFrom;
    let closeAt = -1;
    while (cursor < input.length) {
      if (input[cursor] === '\\' && input[cursor + 1] === '$') {
        cursor += 2;
        continue;
      }
      if (input.startsWith(closeToken, cursor)) {
        closeAt = cursor;
        break;
      }
      cursor += 1;
    }

    if (closeAt === -1) {
      return {
        ok: false,
        error: isDisplay
          ? 'Unclosed display math: a `$$` block was opened but never closed.'
          : 'Unclosed math: a `$` was opened but never closed. Write `\\$` for a literal dollar sign.',
      };
    }

    const body = input.slice(searchFrom, closeAt);
    if (body.trim().length === 0) {
      return { ok: false, error: 'Empty math expression: the `$` delimiters contain nothing to render.' };
    }
    if (body.length > MAX_MATH_SEGMENT_LENGTH) {
      return { ok: false, error: `A single math expression may be at most ${MAX_MATH_SEGMENT_LENGTH} characters.` };
    }

    mathCount += 1;
    if (mathCount > MAX_MATH_SEGMENTS) {
      return { ok: false, error: `A question may contain at most ${MAX_MATH_SEGMENTS} math expressions.` };
    }

    flushText();
    segments.push({ kind: isDisplay ? 'display' : 'inline', value: body });
    index = closeAt + openLength;
  }

  flushText();
  return { ok: true, segments };
}

/**
 * Validates a piece of author-supplied content that may contain math.
 * Returns `null` when the content is acceptable, or a human-readable reason.
 */
export function validateMathContent(input: string, label: string): string | null {
  if (CONTROL_CHAR_PATTERN.test(input)) {
    return `${label} contains control characters, which cannot be rendered. Paste the text again as plain text.`;
  }
  if (MARKUP_PATTERN.test(input)) {
    return `${label} contains markup or a script-like sequence, which is not allowed. Mathematics goes between $ signs, e.g. $x^2 + 1$.`;
  }

  const parsed = parseMathSegments(input);
  if (!parsed.ok) {
    return `${label}: ${parsed.error}`;
  }

  for (const segment of parsed.segments) {
    if (segment.kind === 'text') continue;
    const forbidden = FORBIDDEN_COMMAND_PATTERN.exec(segment.value);
    if (forbidden) {
      return `${label} uses the LaTeX command \`${forbidden[0]}\`, which is not permitted. Only mathematical notation is allowed — no links, file inclusion or macro definitions.`;
    }
  }

  return null;
}

/**
 * Normalises free-text tags: trimmed, lowercased, de-duplicated, order preserved.
 * Lowercasing is what makes tag filtering predictable — otherwise "Algebra" and
 * "algebra" become two tags that each match half the bank.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
