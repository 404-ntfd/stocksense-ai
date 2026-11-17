// Result-set comparison for the golden eval: order-insensitive, 0.5% numeric tolerance.
import type { Row } from '../types';

const TOL = 0.005;
function same(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * TOL + 0.011;
  if (typeof a === 'number' || typeof b === 'number') { const x = Number(a), y = Number(b); return Number.isFinite(x) && Number.isFinite(y) && same(x, y); }
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}
const sortVals = (v: unknown[]): unknown[] => [...v].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
function sameColumn(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const x = sortVals(a), y = sortVals(b);
  return x.every((v, i) => same(v, y[i]));
}

/**
 * 'rows' (default): same number of rows, and every gold column has a predicted column with the same values
 * (extra predicted columns and different names/order are fine).
 * 'values': every numeric value in the gold result appears somewhere in the prediction (used for comparisons,
 * where "two rows" and "one row with two columns" are both right).
 */
export function compareResults(gold: Row[], pred: Row[], mode: 'rows' | 'values' = 'rows'): boolean {
  if (mode === 'values') {
    const pv = pred.flatMap((r) => Object.values(r)).filter((v) => typeof v === 'number') as number[];
    const gv = gold.flatMap((r) => Object.values(r)).filter((v) => typeof v === 'number') as number[];
    return gv.length > 0 && gv.every((g) => pv.some((p) => same(g, p)));
  }
  if (gold.length !== pred.length) return false;
  if (!gold.length) return true;
  const predCols = Object.keys(pred[0]).map((c) => pred.map((r) => r[c]));
  return Object.keys(gold[0]).every((c) => { const g = gold.map((r) => r[c]); return predCols.some((p) => sameColumn(g, p)); });
}
