import type { Worksheet } from 'exceljs' with { 'resolution-mode': 'import' };
import type { ImportParser, ParseFailure, ParseInput, ParseOutcome } from '../lib/importTypes';
import { readSheet } from './excelImportParser';

/**
 * CSV and JSON question files (Milestone 30 — the Daily Quiz's bulk import, brief §6.5).
 *
 * ## Two new formats, no new reader
 *
 * Both are **tables**, so neither has a row reader of its own. A CSV becomes a one-sheet
 * workbook and a JSON array becomes a list of rows, held in memory, and then
 * `readSheet()` from `excelImportParser.ts` reads them — the same header detection, the
 * same column aliases, the same answer readers, the same failures with the same words.
 * That is the importer's own rule ("one canonical candidate") carried one step further:
 * three tabular formats with three readers would eventually disagree about what "the
 * answer is B" means, and the quiz a child is marked against would depend on which file
 * format the owner happened to save.
 *
 * Like every parser, these are **shape adapters**: they decide nothing about whether a
 * question is acceptable. `createQuestionSchema`, through the shared screener, does.
 *
 * Nothing touches the filesystem: the bytes arrive in the request body and are parsed
 * from a `Buffer`, exactly as the other formats are.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see excelImportParser.ts
const exceljs = require('exceljs') as typeof import('exceljs', { with: { 'resolution-mode': 'import' } });

/**
 * How many records a file may hold before the rest are not read. Matches the worksheet
 * scan limit (5,000 rows after the header) with room for the header itself, so building
 * the in-memory sheet can never cost more than reading it would.
 */
const MAX_RECORDS = 5_100;

/** The most option columns a JSON `options` array can fill. Matches the Excel reader's. */
const MAX_OPTIONS = 8;

/** Text from bytes, with the byte-order mark Excel writes at the front of a UTF-8 CSV removed. */
function textOf(bytes: Buffer): string {
  const text = bytes.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** An empty in-memory sheet, filled row by row. */
function sheetFrom(rows: readonly (readonly string[])[]): Worksheet {
  const sheet = new exceljs.Workbook().addWorksheet('Questions');
  for (const row of rows) sheet.addRow(row.map((value) => (value.length === 0 ? null : value)));
  return sheet;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * The delimiter, decided from the first line: a comma, unless the line holds more
 * semicolons or tabs. Excel in several European locales saves "CSV" with semicolons, and a
 * sheet pasted from Google Sheets is often tab-separated; refusing either would make the
 * owner re-save a file that is perfectly readable.
 */
function detectDelimiter(text: string): string {
  let inQuotes = false;
  const counts = new Map<string, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === '\n' || char === '\r')) break;
    else if (!inQuotes && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ',';
  for (const [delimiter, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/**
 * RFC 4180, as a spreadsheet writes it: quoted fields may hold the delimiter, a doubled
 * quote, and line breaks — which a maths question with a fraction and a two-line solution
 * routinely does. Line endings may be CRLF, LF or CR.
 *
 * Throws for a quote that is never closed, naming the record it opened on, because the
 * alternative — reading the rest of the file as one enormous field — produces a single
 * nonsense question and hides every real row behind it.
 */
export function parseCsv(text: string, maxRecords = MAX_RECORDS): string[][] {
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteOpenedOnRecord = 0;
  let index = 0;

  const endField = () => {
    record.push(field.trim());
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < text.length && records.length < maxRecords) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += char;
      }
      index += 1;
      continue;
    }

    if (char === '"' && field.trim().length === 0) {
      inQuotes = true;
      quoteOpenedOnRecord = records.length + 1;
      field = '';
    } else if (char === delimiter) {
      endField();
    } else if (char === '\r' || char === '\n') {
      endRecord();
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += char;
    }
    index += 1;
  }

  if (inQuotes) {
    throw new Error(
      `A quoted value that starts on row ${quoteOpenedOnRecord} is never closed, so the rest of the file cannot be read. Check that row for a stray " mark.`,
    );
  }
  if (field.length > 0 || record.length > 0) endRecord();
  return records;
}

export const CSV_PARSER_ID = 'csv';

export const csvImportParser: ImportParser = {
  descriptor: {
    id: CSV_PARSER_ID,
    label: 'CSV file',
    kind: 'csv',
    extraction: 'deterministic',
    basis:
      'Read directly from the columns of your .csv file — the same columns as the Excel template, ' +
      'in any order. Every question is then checked by the same rules as a hand-written one, and ' +
      'nothing is saved until you approve it.',
  },
  isAvailable: () => true,
  async parse(input: ParseInput): Promise<ParseOutcome> {
    const records = parseCsv(textOf(input.file.bytes));
    return readSheet(sheetFrom(records), input.defaults, input.maxCandidates, { tableRef: 'This file' });
  },
};

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** The keys a JSON file may carry its options under, as an array. */
const OPTION_ARRAY_KEYS = new Set(['options', 'choices']);

/** The keys that already state the answer, so an option's own `isCorrect` must not override them. */
const ANSWER_KEYS = new Set(['answer', 'correct', 'correctanswer', 'correctoption', 'ans', 'key', 'answerkey']);

const reduced = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/gu, '');

/** A JSON value as cell text. Nested structures other than an options list are stringified as-is. */
function cellFrom(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(cellFrom).filter((part) => part.length > 0).join(', ');
  return JSON.stringify(value);
}

/**
 * The questions array, from either of the two shapes people write: a bare array, or an
 * object holding one under `questions` (or `quizzes`, `rows`, `items`).
 */
function itemsOf(document: unknown): unknown[] {
  if (Array.isArray(document)) return document;
  if (document && typeof document === 'object') {
    for (const key of ['questions', 'quizzes', 'rows', 'items']) {
      const value = (document as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new Error('The file must be a JSON array of questions, or an object with a "questions" array.');
}

/**
 * A JSON document as rows of a table: one heading per key (first seen, first placed), one
 * row per question. An `options` array becomes `Option A`, `Option B`, … so the shared
 * reader sees exactly what it sees in a spreadsheet; an option written as
 * `{ "text": "36", "isCorrect": true }` supplies the answer letter when no answer key does.
 */
export function jsonToTable(document: unknown): { rows: string[][]; failures: ParseFailure[] } {
  const items = itemsOf(document).slice(0, MAX_RECORDS - 1);
  const headings: string[] = [];
  const seen = new Set<string>();
  const failures: ParseFailure[] = [];
  const addHeading = (heading: string) => {
    const key = reduced(heading);
    if (seen.has(key)) return;
    seen.add(key);
    headings.push(heading);
  };

  const flat: Array<Map<string, string> | null> = items.map((item, position) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      failures.push({ sourceRef: `Question ${position + 1}`, reason: 'This item is not an object with named fields, so it was skipped.' });
      return null;
    }
    const cells = new Map<string, string>();
    const entries = Object.entries(item as Record<string, unknown>);
    const statesAnswer = entries.some(([key, value]) => ANSWER_KEYS.has(reduced(key)) && cellFrom(value).length > 0);

    for (const [key, value] of entries) {
      if (OPTION_ARRAY_KEYS.has(reduced(key)) && Array.isArray(value)) {
        value.slice(0, MAX_OPTIONS).forEach((option, index) => {
          const letter = String.fromCharCode('A'.charCodeAt(0) + index);
          const heading = `Option ${letter}`;
          addHeading(heading);
          const isObject = option !== null && typeof option === 'object' && !Array.isArray(option);
          const text = isObject ? cellFrom((option as Record<string, unknown>).text) : cellFrom(option);
          cells.set(reduced(heading), text);
          if (isObject && !statesAnswer && (option as Record<string, unknown>).isCorrect === true) {
            addHeading('Correct Answer');
            const previous = cells.get('correctanswer');
            cells.set('correctanswer', previous ? `${previous}, ${letter}` : letter);
          }
        });
        continue;
      }
      addHeading(key);
      cells.set(reduced(key), cellFrom(value));
    }
    return cells;
  });

  const rows: string[][] = [headings];
  for (const cells of flat) {
    // A skipped item still takes its row, so every later row keeps its own number.
    rows.push(headings.map((heading) => cells?.get(reduced(heading)) ?? ''));
  }
  return { rows, failures };
}

export const JSON_PARSER_ID = 'json';

export const jsonImportParser: ImportParser = {
  descriptor: {
    id: JSON_PARSER_ID,
    label: 'JSON file',
    kind: 'json',
    extraction: 'deterministic',
    basis:
      'Read from a JSON array of questions, one object each, with the same field names as the Excel ' +
      'template\'s columns (an "options" array is accepted too). Every question is then checked by ' +
      'the same rules as a hand-written one, and nothing is saved until you approve it.',
  },
  isAvailable: () => true,
  async parse(input: ParseInput): Promise<ParseOutcome> {
    let document: unknown;
    try {
      document = JSON.parse(textOf(input.file.bytes));
    } catch (err) {
      // `cause` assigned rather than passed, for the ES2020 target — as excelImportParser does.
      const failure: Error & { cause?: unknown } = new Error(
        `That is not valid JSON (${err instanceof Error ? err.message.slice(0, 120) : 'unreadable'}).`,
      );
      failure.cause = err;
      throw failure;
    }
    const { rows, failures } = jsonToTable(document);
    const read = readSheet(sheetFrom(rows), input.defaults, input.maxCandidates, {
      tableRef: 'This file',
      // Row 1 is the headings this parser wrote, so the first question is row 2.
      refFor: (rowNumber) => `Question ${rowNumber - 1}`,
    });
    return { ...read, failures: [...failures, ...read.failures], examined: read.examined + failures.length };
  },
};
