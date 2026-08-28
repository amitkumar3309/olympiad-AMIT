/**
 * Telling one OOXML file from another (Milestone 21).
 *
 * ## Why this exists at all
 *
 * `.xlsx` and `.docx` are both ZIP archives beginning `50 4B 03 04`, so the magic-byte check in
 * `validation/uploadSchemas.ts` **cannot distinguish them** — it can only say "this really is a
 * zip". The authoritative question is which OOXML part the archive contains, and that is what
 * these functions answer.
 *
 * ## Without inflating anything, which is the point
 *
 * A ZIP stores every entry's name **uncompressed**, in that entry's local file header and again in
 * the central directory. So searching the raw bytes for `xl/workbook.xml` answers the question
 * with no decompression at all.
 *
 * That ordering matters more than it looks: `SECURITY.md` records a decompression bomb as an open
 * residual risk, and checking the format this way means an archive that is **not** the format we
 * expected is refused *before* `exceljs` or `mammoth` is ever handed it. The check that cannot be
 * fooled is also the one that costs nothing.
 *
 * A byte search can in principle be fooled the other way — a `.docx` that happens to contain a
 * *file called* `xl/workbook.xml` would pass — but that only earns the caller a clear parse error
 * from the real library a moment later, which is the same outcome as any other malformed file.
 * This is a cheap, early discriminator, not a security boundary; the boundary is that nothing a
 * parser returns is trusted.
 */

/** The part every spreadsheet has. */
const WORKBOOK_PART = 'xl/workbook.xml';

/** The part every Word document has. */
const DOCUMENT_PART = 'word/document.xml';

/**
 * Word's own equation markup, which **`mammoth` silently drops**.
 *
 * Detected so an examiner can be told, because the failure is otherwise invisible in the worst
 * way: a question written with Word's equation editor imports looking complete, with the formula
 * simply *missing* from the middle of the sentence. A warning naming the cause is the difference
 * between "the importer is broken" and "retype the formulas as `$…$`".
 */
const EQUATION_MARKUP = 'm:oMath';

export function looksLikeWorkbook(bytes: Buffer): boolean {
  return bytes.includes(WORKBOOK_PART);
}

export function looksLikeWordDocument(bytes: Buffer): boolean {
  return bytes.includes(DOCUMENT_PART);
}

/**
 * Whether the document contains Word equation objects.
 *
 * Deliberately a **warning** rather than a rejection: a document may contain one equation in a
 * heading and a hundred perfectly readable questions, and refusing the file would help nobody.
 * The rule from `lib/questionQuality.ts` applies — annotate, never reject.
 */
export function containsWordEquations(bytes: Buffer): boolean {
  return bytes.includes(EQUATION_MARKUP);
}
