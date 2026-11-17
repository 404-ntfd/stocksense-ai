// Turning messy spreadsheet cells into clean numbers, dates and text.
// Every function is pure and returns a result object instead of throwing, so the import
// wizard can show a per-row error list.
import { MONTHS_LONG, isoFromParts, isValidISO } from '../util/dates';

export type Coerced<T> = { ok: true; value: T | null; warn?: string } | { ok: false; reason: string };

const EMPTY_MARKS = new Set(['', '-', '--', '—', '–', 'na', 'n/a', 'n.a.', 'nil', 'null', 'none', '#n/a']);
const EXCEL_ERRORS = /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!|GETTING_DATA)$/i;

export function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Trim and collapse inner whitespace (including non-breaking spaces). */
export function cleanText(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : isoFromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = String(v).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/**
 * Numbers as people type them in Indian spreadsheets:
 * "₹1,23,456.50", "Rs. 500", "1.2L", "(250)" (= -250), "12%", "1.5E+3", "250/-", "-", "NA".
 */
export function parseNumber(v: unknown): Coerced<number> {
  if (v == null) return { ok: true, value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: true, value: null };
  if (typeof v === 'boolean') return { ok: true, value: v ? 1 : 0 };
  if (v instanceof Date) return { ok: false, reason: 'is a date, not a number' };
  let s = String(v).replace(/[   ]/g, ' ').trim();
  if (EMPTY_MARKS.has(s.toLowerCase())) return { ok: true, value: null };
  if (EXCEL_ERRORS.test(s)) return { ok: true, value: null, warn: 'excel_error' };
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1].trim(); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/\s*(\/-|rs\.?|inr|₹)$/i, '').trim();
  if (/-$/.test(s) && !/^-/.test(s)) { negative = !negative; s = s.slice(0, -1).trim(); } // accounting style "250-"
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim(); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '');
  let percent = false;
  if (s.endsWith('%')) { percent = true; s = s.slice(0, -1).trim(); }
  let mult = 1;
  const suffix = /^([\d.,\s]+?)\s*(k|thousand|l|lac|lacs|lakh|lakhs|cr|crore|crores|m|mn|million)\.?$/i.exec(s);
  if (suffix) {
    s = suffix[1];
    const u = suffix[2].toLowerCase();
    mult = u === 'k' || u === 'thousand' ? 1e3 : u.startsWith('l') ? 1e5 : u.startsWith('c') ? 1e7 : 1e6;
  }
  s = s.replace(/[,\s]/g, '');
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return { ok: false, reason: `"${String(v).slice(0, 30)}" is not a number` };
  const n = Number(s) * mult * (negative ? -1 : 1);
  if (!Number.isFinite(n)) return { ok: false, reason: `"${String(v).slice(0, 30)}" is not a number` };
  return { ok: true, value: n, warn: percent ? 'percent' : undefined };
}

/** Excel serial date -> ISO. Handles Excel's phantom 29 Feb 1900 and the 1904 date system. */
export function excelSerialToISO(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null;
  let days = Math.floor(serial);
  if (date1904) days += 1462;
  if (days < 1) return null;
  if (days === 60) return '1900-02-28'; // Excel thinks 1900 was a leap year; map the phantom day to the 28th
  const epoch = Date.UTC(1899, 11, days < 60 ? 31 : 30);
  const d = new Date(epoch + days * 86400000);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const MONTH_INDEX: Record<string, number> = {};
MONTHS_LONG.forEach((m, i) => { MONTH_INDEX[m] = i + 1; MONTH_INDEX[m.slice(0, 3)] = i + 1; });
MONTH_INDEX.sept = 9;

function fullYear(y: number): number { return y >= 100 ? y : y < 70 ? 2000 + y : 1900 + y; }
function build(y: number, m: number, d: number): string | null {
  const iso = isoFromParts(fullYear(y), m, d);
  return isValidISO(iso) && fullYear(y) >= 1900 && fullYear(y) <= 2200 ? iso : null;
}

/**
 * Dates as text or Excel serials. dd/mm/yyyy is the default reading (India); a value such as
 * 03/04/2026 follows `dayFirst` and is reported as ambiguous so the wizard can warn once.
 */
export function parseDate(v: unknown, opts: { dayFirst?: boolean; date1904?: boolean } = {}): Coerced<string> & { ambiguous?: boolean } {
  const dayFirst = opts.dayFirst !== false;
  if (v == null) return { ok: true, value: null };
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return { ok: false, reason: 'is not a valid date' };
    return { ok: true, value: isoFromParts(v.getFullYear(), v.getMonth() + 1, v.getDate()) };
  }
  if (typeof v === 'number') {
    if (v >= 19000101 && v <= 22001231 && Number.isInteger(v)) return parseDate(String(v), opts); // yyyymmdd
    if (v > 0 && v < 110000) {
      const iso = excelSerialToISO(v, opts.date1904);
      return iso ? { ok: true, value: iso } : { ok: false, reason: `${v} is not a valid date` };
    }
    return { ok: false, reason: `${v} is not a valid date` };
  }
  let s = String(v).replace(/[ ]/g, ' ').trim();
  if (EMPTY_MARKS.has(s.toLowerCase())) return { ok: true, value: null };
  const fail = { ok: false as const, reason: `"${s.slice(0, 30)}" is not a date I recognise` };
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm|z|[+-]\d{2}:?\d{2})?$/i, '').trim(); // drop a time part
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
    const iso = build(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? { ok: true, value: iso } : fail;
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    const iso = build(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? { ok: true, value: iso } : fail;
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    let d = a, mo = b, ambiguous = false;
    if (a > 12 && b <= 12) { d = a; mo = b; }
    else if (b > 12 && a <= 12) { d = b; mo = a; }
    else { ambiguous = a !== b; if (!dayFirst) { d = b; mo = a; } }
    const iso = build(y, mo, d);
    return iso ? { ok: true, value: iso, ambiguous } : fail;
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-/ .]+([A-Za-z]{3,9})\.?[-/ ,.]+(\d{2}|\d{4})$/.exec(s))) { // 17-Nov-26, 17 November 2026
    const mo = MONTH_INDEX[m[2].toLowerCase()];
    const iso = mo ? build(Number(m[3]), mo, Number(m[1])) : null;
    return iso ? { ok: true, value: iso } : fail;
  }
  if ((m = /^([A-Za-z]{3,9})\.?[-/ ]+(\d{1,2})(?:st|nd|rd|th)?,?[-/ ]+(\d{2}|\d{4})$/.exec(s))) { // Nov 17, 2026
    const mo = MONTH_INDEX[m[1].toLowerCase()];
    const iso = mo ? build(Number(m[3]), mo, Number(m[2])) : null;
    return iso ? { ok: true, value: iso } : fail;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // Excel serial that arrived as text
    const iso = excelSerialToISO(Number(s), opts.date1904);
    return iso ? { ok: true, value: iso } : fail;
  }
  return fail;
}

/** SKUs and barcodes stay text. Excel's scientific notation for long barcodes is expanded with a warning. */
export function parseSku(v: unknown): Coerced<string> {
  if (v == null) return { ok: true, value: null };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { ok: true, value: null };
    return { ok: true, value: Number.isInteger(v) ? String(v) : String(v), warn: Math.abs(v) >= 1e15 ? 'sci_notation' : undefined };
  }
  const s = cleanText(v);
  if (s == null || EMPTY_MARKS.has(s.toLowerCase())) return { ok: true, value: null };
  if (/^\d(\.\d+)?e\+\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return { ok: true, value: n.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 }), warn: 'sci_notation' };
  }
  return { ok: true, value: s };
}

/** Units as people say and type them: kgs -> kg, litres -> l, pieces/nos -> pcs. */
export function normaliseUnit(v: unknown): string | null {
  const s = cleanText(v)?.toLowerCase().replace(/\.$/, '');
  if (!s) return null;
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(s)) return 'kg';
  if (/^(g|gm|gms|gram|grams)$/.test(s)) return 'g';
  if (/^(l|lt|ltr|ltrs|litre|litres|liter|liters)$/.test(s)) return 'l';
  if (/^(ml|mls|millilitre|millilitres)$/.test(s)) return 'ml';
  if (/^(pc|pcs|piece|pieces|no|nos|unit|units|each|ea)$/.test(s)) return 'pcs';
  if (/^(pkt|pkts|packet|packets|pack|packs)$/.test(s)) return 'pkt';
  if (/^(box|boxes|bx)$/.test(s)) return 'box';
  if (/^(dz|doz|dozen|dozens)$/.test(s)) return 'dozen';
  if (/^(btl|bottle|bottles)$/.test(s)) return 'btl';
  return s.slice(0, 12);
}

/** Safe SQL identifier from any header text: snake_case ASCII, c_ prefix for digits, never empty. */
export function toIdentifier(header: string, fallback = 'column'): string {
  let s = header.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/₹/g, ' rs ').replace(/%/g, ' pct ').replace(/#/g, ' no ').replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = 'c_' + s;
  return s.slice(0, 48);
}

/** Makes names unique: qty, qty_2, qty_3. */
export function dedupeNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = raw || 'column';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}
