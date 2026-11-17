// The import pipeline between "bytes of a file" and "clean rows for the database":
// parse -> detect header -> suggest target and mapping -> coerce rows in chunks.
// All pure code: it runs in the DB worker, in Node tests and in the fixture generator alike.
import type { ColumnSpec, ImportTarget, Row, RowError, SemType } from '../types';
import { cleanText, dedupeNames, isBlank, normaliseUnit, parseDate, parseNumber, parseSku, toIdentifier } from './coerce';
import { parseCsv } from './csvParser';
import { detectHeader, type HeaderInfo } from './headerDetect';
import { TARGET_FIELDS, suggestMapping, suggestTarget, type MappingSuggestion } from './mapping';
import { ImportFileError, parseWorkbook } from './xlsxParser';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const WARN_ROWS = 300_000;
export const CHUNK_ROWS = 2000;

export interface ParsedSheet { name: string; hidden: boolean; matrix: unknown[][] }
export interface ParsedFile {
  fileName: string; kind: 'csv' | 'excel'; sheets: ParsedSheet[]; fileHash: string; sizeBytes: number;
  encoding?: string; delimiter?: string; warnings: string[];
}

/** FNV-1a over the bytes (plus the length): cheap fingerprint used to spot "same file imported twice". */
export function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  const step = bytes.length > 4_000_000 ? 7 : 1; // sample very large files
  for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return `${bytes.length}-${(h >>> 0).toString(16)}`;
}

export async function parseFile(bytes: Uint8Array, fileName: string): Promise<ParsedFile> {
  if (bytes.length > MAX_FILE_BYTES) throw new ImportFileError('TOO_LARGE', 'This file is larger than 50 MB. Split it into smaller files (for example one per year) and import them one by one.');
  if (bytes.length === 0) throw new ImportFileError('EMPTY', 'This file is empty.');
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] ?? '').toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isCfb = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'zip', 'json', 'pages'].includes(ext) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44)) {
    throw new ImportFileError('UNSUPPORTED', `.${ext || 'this'} files are not supported. Export your data as Excel (.xlsx) or CSV first.`);
  }
  const base = { fileName, fileHash: hashBytes(bytes), sizeBytes: bytes.length };
  if (isZip || isCfb || ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'numbers'].includes(ext)) {
    const wb = await parseWorkbook(bytes);
    return { ...base, kind: 'excel', sheets: wb.sheets, warnings: wb.warnings };
  }
  const csv = parseCsv(bytes);
  return { ...base, kind: 'csv', sheets: [{ name: 'Sheet1', hidden: false, matrix: csv.matrix }], encoding: csv.encoding, delimiter: csv.delimiter, warnings: csv.warnings };
}

// ---------- analysis ----------
export interface SheetAnalysis {
  header: HeaderInfo;
  headers: string[];
  rowCount: number;
  sample: unknown[][];
  target: ImportTarget;
  scores: Record<string, number>;
  mappings: Record<string, MappingSuggestion[]>;
  customColumns: ColumnSpec[];
}

const TOTAL_RE = /^(grand\s*|sub\s*|net\s*|page\s*)?totals?\b/i;

function isTotalsRow(row: unknown[]): boolean {
  for (const c of row) {
    if (isBlank(c)) continue;
    return typeof c === 'string' && TOTAL_RE.test(c.trim());
  }
  return false;
}
function isBlankRow(row: unknown[] | undefined): boolean { return !row || row.every(isBlank); }
function isRepeatHeader(row: unknown[], headers: string[]): boolean {
  let same = 0, cells = 0;
  for (let c = 0; c < headers.length; c++) {
    if (isBlank(row[c])) continue;
    cells++;
    if (String(row[c]).trim().toLowerCase() === headers[c].toLowerCase()) same++;
  }
  return cells >= 2 && same === cells;
}

export function analyzeSheet(sheet: ParsedSheet, fileName = '', headerOverride?: number): SheetAnalysis {
  let header = detectHeader(sheet.matrix);
  if (headerOverride != null && headerOverride >= 0 && headerOverride < sheet.matrix.length) {
    const names = (sheet.matrix[headerOverride] ?? []).map((c, i) => cleanText(c) ?? `Column ${i + 1}`);
    header = { index: headerOverride, span: 1, headers: dedupeNames(names) };
  }
  const headers = header.headers;
  const start = header.index + header.span;
  const sample: unknown[][] = [];
  let rowCount = 0;
  for (let r = start; r < sheet.matrix.length; r++) {
    const row = sheet.matrix[r];
    if (isBlankRow(row) || isTotalsRow(row) || isRepeatHeader(row, headers)) continue;
    rowCount++;
    if (sample.length < 20) sample.push(headers.map((_, c) => row[c] ?? null));
  }
  const { target, scores } = suggestTarget(headers, fileName);
  const mappings: Record<string, MappingSuggestion[]> = {};
  for (const t of Object.keys(TARGET_FIELDS) as Array<Exclude<ImportTarget, 'custom'>>) mappings[t] = suggestMapping(headers, t);
  return { header, headers, rowCount, sample, target, scores, mappings, customColumns: inferCustomColumns(headers, sheet.matrix.slice(start, start + 500)) };
}

// ---------- custom tables ----------
const MONEY_RE = /amount|price|rate|cost|value|total|mrp|₹|\brs\b|salary|fee|paid|balance|revenue|profit/i;
const QTY_RE = /qty|quantity|stock|count|units|\bnos\b|\bpcs\b|weight|kg/i;
const ID_RE = /\bid\b|code|\bno\b|number|sku|barcode|phone|mobile|pin|gstin/i;

export function inferCustomColumns(headers: string[], rows: unknown[][]): ColumnSpec[] {
  const names = dedupeNames(headers.map((h, i) => toIdentifier(h, `column_${i + 1}`))).map((n) => (n === '_import_batch' || n === 'rowid' ? `c_${n}` : n));
  return headers.map((h, c) => {
    let total = 0, nums = 0, ints = 0, dates = 0;
    const distinct = new Set<string>();
    for (const row of rows) {
      const v = row?.[c];
      if (isBlank(v)) continue;
      total++;
      if (distinct.size <= 40) distinct.add(String(v));
      const isDateText = typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}/.test(v) || (/[-/.]|[a-z]{3}/i.test(v) && /\d/.test(v)));
      if (isDateText) { const d = parseDate(v); if (d.ok && d.value) { dates++; continue; } }
      const n = parseNumber(v);
      if (n.ok && n.value != null) { nums++; if (Number.isInteger(n.value) && !/^0\d/.test(String(v).trim())) ints++; }
    }
    let type: ColumnSpec['type'] = 'TEXT';
    let semType: SemType = 'text';
    const isId = ID_RE.test(h);
    if (total && dates / total >= 0.9) { type = 'DATE'; semType = 'date'; }
    else if (total && nums / total >= 0.95 && !(isId && ints === nums)) {
      semType = MONEY_RE.test(h) ? 'money' : QTY_RE.test(h) ? 'qty' : 'number';
      type = ints === nums && semType !== 'money' ? 'INTEGER' : 'REAL';
    } else if (isId) semType = 'id';
    else if (total >= 5 && distinct.size <= 20 && distinct.size <= total * 0.6) semType = 'category';
    const describe: Record<SemType, string> = {
      date: `${h} (date, YYYY-MM-DD)`, money: `${h} (amount in rupees)`, qty: `${h} (quantity)`, number: `${h} (number)`,
      category: `${h} (category)`, id: `${h} (identifier)`, text: `${h} (text)`,
    };
    return { name: names[c], display: h, type, semType, description: describe[semType] };
  });
}

/** u_<slug> from a file or sheet name. */
export function customTableName(label: string): string {
  const slug = toIdentifier(label.replace(/\.[a-z0-9]+$/i, ''), 'table').replace(/^c_/, 't_').slice(0, 40);
  return `u_${slug}`;
}

// ---------- coercion ----------
export interface ImportPlan {
  target: ImportTarget;
  /** field key -> column index (or null when not mapped). */
  mapping: Record<string, number | null>;
  dayFirst: boolean;
  /** For target === 'custom': the column specs, in header order (null = skip the column). */
  customColumns?: Array<ColumnSpec | null>;
}

export interface CoercedChunk { rows: Row[]; errors: RowError[]; processed: number; skippedTotals: number; warnCounts: Record<string, number> }

export function validatePlan(plan: ImportPlan): string | null {
  if (plan.target === 'custom') return plan.customColumns?.some(Boolean) ? null : 'Choose at least one column to import.';
  const fields = TARGET_FIELDS[plan.target];
  for (const f of fields) if (f.required && plan.mapping[f.key] == null) return `Choose the column that holds "${f.label}".`;
  if (plan.target !== 'products' && plan.target !== 'expenses' && plan.mapping.sku == null && plan.mapping.name == null) return 'Choose the column that holds the product name or the SKU.';
  if (plan.target === 'sales' && plan.mapping.unit_price == null && plan.mapping.amount == null) return null; // price falls back to the product's selling price
  return null;
}

/** Yields clean rows in chunks of 2,000 with per-row errors. `__row` is the 1-based row in the file. */
export function* coerceChunks(sheet: ParsedSheet, header: HeaderInfo, plan: ImportPlan, chunkSize = CHUNK_ROWS): Generator<CoercedChunk> {
  const start = header.index + header.span;
  const headers = header.headers;
  const fields = plan.target === 'custom' ? [] : TARGET_FIELDS[plan.target];
  const mapped = new Set<number>(Object.values(plan.mapping).filter((v): v is number => v != null));
  let chunk: CoercedChunk = { rows: [], errors: [], processed: 0, skippedTotals: 0, warnCounts: {} };
  const warn = (k: string): void => { chunk.warnCounts[k] = (chunk.warnCounts[k] ?? 0) + 1; };

  for (let r = start; r < sheet.matrix.length; r++) {
    const raw = sheet.matrix[r];
    if (isBlankRow(raw)) continue;
    if (isTotalsRow(raw)) { chunk.skippedTotals++; continue; }
    if (isRepeatHeader(raw, headers)) continue;
    chunk.processed++;
    const rowNo = r + 1;
    const out: Row = { __row: rowNo };
    let bad: RowError | null = null;
    const fail = (code: string, message: string, column?: string): void => { if (!bad) bad = { row: rowNo, code, message, column, raw: raw.slice(0, 12) }; };

    if (plan.target === 'custom') {
      (plan.customColumns ?? []).forEach((col, c) => {
        if (!col) return;
        const v = raw[c];
        if (isBlank(v)) { out[col.name] = null; return; }
        if (col.type === 'DATE') { const d = parseDate(v, { dayFirst: plan.dayFirst }); out[col.name] = d.ok ? d.value : cleanText(v); if (!d.ok) warn('custom_unparsed'); }
        else if (col.type === 'INTEGER' || col.type === 'REAL') { const n = parseNumber(v); out[col.name] = n.ok ? n.value : null; if (!n.ok) warn('custom_unparsed'); else if (n.warn === 'excel_error') warn('excel_error'); }
        else out[col.name] = cleanText(v);
      });
    } else {
      for (const f of fields) {
        const c = plan.mapping[f.key];
        const v = c == null ? null : raw[c] ?? null;
        const colName = c == null ? f.label : headers[c] ?? f.label;
        if (f.kind === 'text') out[f.key] = cleanText(v);
        else if (f.kind === 'unit') out[f.key] = normaliseUnit(v);
        else if (f.kind === 'sku') { const s = parseSku(v); out[f.key] = s.ok ? s.value : null; if (s.ok && s.warn) warn(s.warn); }
        else if (f.kind === 'date') {
          const d = parseDate(v, { dayFirst: plan.dayFirst });
          if (!d.ok) fail('BAD_DATE', `${colName}: ${d.reason}`, colName);
          else { out[f.key] = d.value; if (d.ambiguous) warn('ambiguous_dates'); }
        } else {
          const n = parseNumber(v);
          if (!n.ok) fail('BAD_NUMBER', `${colName}: ${n.reason}`, colName);
          else { out[f.key] = n.value; if (n.warn) warn(n.warn); }
        }
        if (f.required && !bad && out[f.key] == null) fail(`MISSING_${f.key.toUpperCase()}`, `${f.label} is empty`, colName);
      }
      if (!bad && plan.target !== 'products' && plan.target !== 'expenses' && out.sku == null && out.name == null) fail('NO_PRODUCT', 'Row has no product name or SKU');
      // keep whatever was not mapped, so nothing from the file is silently lost
      const extra: Record<string, unknown> = {};
      let n = 0;
      for (let c = 0; c < headers.length && n < 20; c++) {
        if (mapped.has(c) || isBlank(raw[c])) continue;
        extra[headers[c]] = typeof raw[c] === 'number' ? raw[c] : String(raw[c]).slice(0, 200);
        n++;
      }
      if (n) out.extra = JSON.stringify(extra);
    }
    if (bad) chunk.errors.push(bad); else chunk.rows.push(out);
    if (chunk.processed >= chunkSize) {
      yield chunk;
      chunk = { rows: [], errors: [], processed: 0, skippedTotals: 0, warnCounts: {} };
    }
  }
  if (chunk.processed || chunk.skippedTotals) yield chunk;
}

export const WARNING_TEXT: Record<string, (n: number) => string> = {
  ambiguous_dates: (n) => `${n} date(s) such as 03/04/2026 could be read two ways; they were read using your "day first" setting.`,
  excel_error: (n) => `${n} cell(s) with Excel errors (#DIV/0!, #N/A…) were imported as empty.`,
  sci_notation: (n) => `${n} code(s) were in scientific notation (Excel does this to long barcodes); some digits may have been lost in the original file.`,
  percent: (n) => `${n} value(s) written as percentages were read as plain numbers (12% -> 12).`,
  custom_unparsed: (n) => `${n} value(s) did not match their column type and were kept as empty or text.`,
  returns: (n) => `${n} row(s) with negative quantity were recorded as returns (stock back in), not as sales.`,
  zero_price: (n) => `${n} row(s) have a zero price.`,
  below_cost: (n) => `${n} row(s) were sold below cost price.`,
  duplicate_sku: (n) => `${n} SKU(s) appeared more than once in the file; the last row was kept.`,
  totals: (n) => `${n} totals row(s) were skipped.`,
  created_products: (n) => `${n} product(s) that were not in your list were created automatically.`,
  updated: (n) => `${n} existing row(s) were updated.`,
  unknown_product: (n) => `${n} row(s) referred to products that are not in your list.`,
};

export { ImportFileError };
