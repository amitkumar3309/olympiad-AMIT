// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS, and a transitive dep
const JSZip = require('jszip') as typeof import('jszip');

/**
 * Building a real `.docx` in memory, for the DOCX importer's tests.
 *
 * ## Why build one rather than commit a fixture file
 *
 * A committed `.docx` is opaque: nobody reviewing a test can see what the document says, and
 * changing one paragraph means opening Word. Building them here makes each test's fixture readable
 * next to its assertion — which matters more for this parser than for any other, because it is a
 * heuristic over document *conventions* and every test is a statement about one convention.
 *
 * `jszip` is `mammoth`'s own dependency, so this needs nothing new installed. It is used **only**
 * by tests; nothing in `src/` builds a document.
 *
 * ## What this produces
 *
 * The minimum OOXML that `mammoth` will read: the content-types part, the package relationships,
 * and `word/document.xml` with one `<w:p>` per paragraph. Deliberately minimal — a document from
 * real Word carries a hundred parts this omits, and a parser that needed any of them would be
 * relying on something a "Save As → .docx" from another program might not produce.
 */

/** XML-escapes text destined for a `<w:t>` node. */
function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export interface DocxParagraph {
  text: string;
  /**
   * Render this paragraph as an **auto-numbered list item**, i.e. with the number living in the
   * numbering definitions rather than in the text.
   *
   * This is the case that matters most: Word's automatic numbering does **not** survive text
   * extraction, so a document numbered this way arrives with no question numbers at all. The
   * parser has to recover from that, and this is how a test reproduces it.
   */
  numbered?: boolean;
  /** Insert a Word equation object, which `mammoth` silently drops. */
  equation?: boolean;
}

function paragraphXml(paragraph: DocxParagraph): string {
  const properties = paragraph.numbered
    ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
    : '';

  // An `m:oMath` element carrying a variable. Real Word writes a great deal more, but the
  // detection this exercises is the presence of the markup, which is all that can be relied on.
  const equation = paragraph.equation
    ? '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
      '<m:r><m:t>x^2</m:t></m:r></m:oMath>'
    : '';

  const run =
    paragraph.text.length > 0
      ? `<w:r><w:t xml:space="preserve">${escapeXml(paragraph.text)}</w:t></w:r>`
      : '';

  return `<w:p>${properties}${run}${equation}</w:p>`;
}

/** A `.docx` containing these paragraphs, in order. */
export async function buildDocx(paragraphs: Array<string | DocxParagraph>): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );

  zip.folder('_rels')!.file(
    '.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );

  const body = paragraphs
    .map((paragraph) => paragraphXml(typeof paragraph === 'string' ? { text: paragraph } : paragraph))
    .join('');

  zip.folder('word')!.file(
    'document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

/** The MIME type a browser sends for a `.docx`. */
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A `.docx` as the upload endpoint receives it. */
export function docxDataUrl(bytes: Buffer): string {
  return `data:${DOCX_MIME};base64,${bytes.toString('base64')}`;
}
