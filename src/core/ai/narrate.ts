// Narration: 1-3 sentences about a result. The model may phrase, but every number it writes must
// already be in the result. If a single number cannot be traced back, the text is thrown away and a
// local template is used instead.
import type { Row } from '../types';
import type { LlmMessage } from './types';
import { colKind, firstNonNull, formatCell, prettyName } from '../ask/format';
import { extractJson } from './plan';

export const NARRATE_SYSTEM = `You write a short answer for a shop owner from a database result.
Rules:
- 1 to 3 plain sentences. No markdown.
- Use ONLY numbers that appear in the result JSON. Do not add, subtract, average, convert to percentages or estimate anything.
- Copy rupee amounts exactly as integers with the ₹ sign, for example ₹383449. Do not shorten them to lakh or K.
- If the result is empty, say that nothing was found and suggest a broader period.
- Then suggest 2 short follow-up questions the owner could ask next.
Reply as JSON: {"answer":"...","followups":["...","..."]}`;

export function summariseResult(columns: string[], rows: Row[]): string {
  const full = JSON.stringify(rows.slice(0, 50));
  if (rows.length <= 50 && full.length <= 4000) return JSON.stringify({ row_count: rows.length, rows });
  // too big to send: row count, sums of numeric columns and the top five rows
  const sums: Record<string, number> = {};
  for (const c of columns) {
    if (typeof firstNonNull(rows, c) !== 'number') continue;
    sums[c] = Math.round(rows.reduce((s, r) => s + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0) * 100) / 100;
  }
  return JSON.stringify({ row_count: rows.length, column_sums: sums, first_rows: rows.slice(0, 5) }).slice(0, 4000);
}

export function buildNarrationMessages(question: string, title: string, columns: string[], rows: Row[]): LlmMessage[] {
  return [
    { role: 'system', content: NARRATE_SYSTEM },
    { role: 'user', content: `Question: ${question.slice(0, 300)}\nTitle: ${title.slice(0, 120)}\nResult JSON: ${summariseResult(columns, rows)}` },
  ];
}

export function parseNarration(text: string): { answer: string; followups: string[] } | null {
  const j = extractJson(text) as { answer?: unknown; followups?: unknown } | null;
  if (!j || typeof j.answer !== 'string' || !j.answer.trim()) return null;
  return { answer: j.answer.trim().slice(0, 600), followups: Array.isArray(j.followups) ? j.followups.filter((f): f is string => typeof f === 'string' && f.length > 3).slice(0, 2).map((f) => f.slice(0, 80)) : [] };
}

/** Every number in a piece of text, with lakh/crore/K words applied ("₹1.2 lakh" -> 120000). */
export function extractNumbers(text: string): Array<{ value: number; raw: string; decimals: number; scaled: boolean }> {
  const out: Array<{ value: number; raw: string; decimals: number; scaled: boolean }> = [];
  const re = /(?<![A-Za-z0-9])(-?\d[\d,]*(?:\.\d+)?)(?:\s*(crores?|cr|lakhs?|lacs?|l|k|thousand|million|mn)\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const digits = m[1].replace(/,/g, '');
    const base = Number(digits);
    if (!Number.isFinite(base)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    const mult = !unit ? 1 : unit.startsWith('cr') ? 1e7 : unit.startsWith('l') ? 1e5 : unit === 'k' || unit === 'thousand' ? 1e3 : 1e6;
    out.push({ value: base * mult, raw: m[0], decimals: (digits.split('.')[1] ?? '').length, scaled: mult !== 1 });
  }
  return out;
}

/**
 * Number grounding check. A narrated number passes when it equals a number in the allowed set once both
 * are rounded to the precision the narration used (so 383449.45 may be written as 383449, 3.83 lakh or 3.8L).
 */
export function checkGrounding(narration: string, rows: Row[], extraAllowed: string[] = []): { ok: boolean; unsupported: string[] } {
  const allowed: number[] = [rows.length];
  for (const r of rows) for (const v of Object.values(r)) {
    if (typeof v === 'number' && Number.isFinite(v)) allowed.push(v);
    else if (typeof v === 'string') for (const n of extractNumbers(v)) allowed.push(n.value);
  }
  for (const s of extraAllowed) for (const n of extractNumbers(s)) allowed.push(n.value);
  const unsupported: string[] = [];
  for (const n of extractNumbers(narration)) {
    const abs = Math.abs(n.value);
    const ok = allowed.some((a) => {
      const target = Math.abs(a);
      if (n.scaled) { // "3.83 lakh": compare at the stated precision of the scaled figure
        const unit = abs / (Math.abs(Number(n.raw.replace(/[^\d.]/g, ''))) || 1);
        const step = unit / 10 ** n.decimals;
        return Math.abs(target - abs) <= step / 2 + 1e-9;
      }
      const step = 1 / 10 ** n.decimals;
      return Math.abs(target - abs) <= step / 2 + 1e-9;
    });
    if (!ok) unsupported.push(n.raw.trim());
  }
  return { ok: unsupported.length === 0, unsupported };
}

/** Deterministic fallback sentence built only from the result. */
export function localNarration(title: string, columns: string[], rows: Row[]): string {
  if (!rows.length) return 'I found nothing for that. Try a broader period or a different product.';
  const kinds = columns.map((c) => colKind(c, firstNonNull(rows, c)));
  const fmt = (r: Row, i: number): string => formatCell(r[columns[i]], kinds[i]);
  if (rows.length === 1) {
    const parts = columns.slice(0, 4).map((c, i) => (kinds[i] === 'text' ? fmt(rows[0], i) : `${prettyName(c).toLowerCase()} ${fmt(rows[0], i)}`));
    return `${title ? title + ': ' : ''}${parts.join(', ')}.`;
  }
  const labelIdx = kinds.findIndex((k) => k === 'text' || k === 'date' || k === 'month');
  const valueIdx = kinds.findIndex((k) => k === 'money' || k === 'qty' || k === 'pct' || k === 'number');
  if (labelIdx >= 0 && valueIdx >= 0) {
    const isTime = kinds[labelIdx] !== 'text';
    if (isTime) {
      let best = rows[0];
      for (const r of rows) if (Number(r[columns[valueIdx]] ?? 0) > Number(best[columns[valueIdx]] ?? 0)) best = r;
      return `${rows.length} points from ${fmt(rows[0], labelIdx)} to ${fmt(rows[rows.length - 1], labelIdx)}. The highest ${prettyName(columns[valueIdx]).toLowerCase()} was ${fmt(best, valueIdx)} on ${fmt(best, labelIdx)}.`;
    }
    return `${fmt(rows[0], labelIdx)} comes first with ${prettyName(columns[valueIdx]).toLowerCase()} ${fmt(rows[0], valueIdx)}${rows.length > 1 ? `, then ${fmt(rows[1], labelIdx)} with ${fmt(rows[1], valueIdx)}` : ''}. ${rows.length} rows in total.`;
  }
  return `${rows.length} rows found. The details are in the table.`;
}
