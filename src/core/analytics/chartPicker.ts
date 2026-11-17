// Deterministic chart choice. The model may send a hint, but the rules below decide, so the same
// result shape always produces the same, sensible chart.
import type { ChartSpec, Row } from '../types';
import { colKind, firstNonNull, type ColKind } from '../ask/format';

export interface PickHint { type?: string; x?: string | null; y?: string[] | null; title?: string }

const ADDITIVE: ColKind[] = ['money', 'qty', 'number'];
const SHARE_WORDS = /\bby\b|share|break ?down|break ?up|split|come from|where|mix|composition|wise/i;

export function pickChart(columns: string[], rows: Row[], hint: PickHint = {}): ChartSpec {
  if (!rows.length || !columns.length) return { type: 'table' };
  const kinds = new Map<string, ColKind>(columns.map((c) => [c, colKind(c, firstNonNull(rows, c))]));
  const numeric = columns.filter((c) => ['money', 'qty', 'pct', 'number'].includes(kinds.get(c)!));
  const timeCol = columns.find((c) => kinds.get(c) === 'date' || kinds.get(c) === 'month');
  const textCols = columns.filter((c) => kinds.get(c) === 'text');
  const hintY = (hint.y ?? []).filter((c) => numeric.includes(c));
  const y = hintY.length ? hintY : numeric.slice(0, 1);
  const want = hint.type && hint.type !== 'auto' ? hint.type : null;

  if (want === 'table') return { type: 'table' };
  if (want === 'forecast') return { type: 'forecast' };
  if (rows.length === 1) return numeric.length ? { type: 'kpi', y: numeric.slice(0, 4), x: textCols[0] } : { type: 'table' };
  if (!numeric.length) return { type: 'table' };

  if (timeCol && want !== 'bar' && want !== 'hbar' && want !== 'donut') {
    const series = textCols.find((c) => c !== timeCol && new Set(rows.map((r) => r[c])).size <= 6) ?? null;
    return { type: 'line', x: timeCol, y: series ? y : (hintY.length ? hintY : numeric.slice(0, 2)), series, movingAverage: rows.length > 30 && !series };
  }
  const x = hint.x && columns.includes(hint.x) && kinds.get(hint.x) === 'text' ? hint.x : textCols[0];
  if (x) {
    const metric = y[0];
    const additive = ADDITIVE.includes(kinds.get(metric)!) && !/avg|average|per_|price|rate|margin/i.test(metric);
    let data = rows;
    if (rows.length > 12) { // top 10 + Others
      const sorted = [...rows].sort((a, b) => Number(b[metric] ?? 0) - Number(a[metric] ?? 0));
      data = sorted.slice(0, 10);
      if (additive) {
        const rest = sorted.slice(10).reduce((s, r) => s + Number(r[metric] ?? 0), 0);
        data.push({ [x]: `Others (${sorted.length - 10})`, [metric]: Math.round(rest * 100) / 100 });
      }
    }
    const allPositive = data.every((r) => Number(r[metric] ?? 0) >= 0);
    const donutOk = data.length <= 6 && data.length >= 2 && allPositive && additive;
    if (want === 'donut' && donutOk) return { type: 'donut', x, y: [metric], rows: data };
    if (!want && donutOk && SHARE_WORDS.test(hint.title ?? '') && !/top|bottom|best|worst/i.test(hint.title ?? '')) return { type: 'donut', x, y: [metric], rows: data };
    const longLabels = data.some((r) => String(r[x] ?? '').length > 12);
    const type: ChartSpec['type'] = want === 'hbar' || (want !== 'bar' && (longLabels || data.length > 8)) ? 'hbar' : 'bar';
    return { type, x, y: [metric], rows: data };
  }
  if (numeric.length >= 2 && rows.length > 2) return { type: 'scatter', x: numeric[0], y: [numeric[1]] };
  return { type: 'table' };
}
