// Decides how a result column should be shown (₹, %, quantity, date, text) from its name and values.
import { formatDate, monthLabel } from '../util/dates';
import { formatINR, formatNumber, formatPct, formatQty } from '../util/money';

export type ColKind = 'money' | 'pct' | 'qty' | 'date' | 'month' | 'text' | 'number';

const MONEY = /revenue|sales|profit|amount|value|price|cost|expense|cogs|spend|spent|rupee|aov|purchases|total_p|income|earning|turnover|net|gross|per_day|avg_order|order_value|mrp|rate\b/i;
const NOT_MONEY = /qty|quantity|units|count|orders|products|days|pct|percent|share|margin_pct|number|entries|bills|suppliers|customers|invoices|rank|level|stock_on_hand|in_stock|categories|cover|demand|forecast|reorder_point|suggested/i;
const PCT = /pct|percent|share|growth|margin(?!_amount)|ratio|change/i;

export function colKind(name: string, sample: unknown): ColKind {
  if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return 'date';
    if (/^\d{4}-\d{2}$/.test(sample)) return 'month';
    return 'text';
  }
  if (typeof sample !== 'number') return 'text';
  if (PCT.test(name) && !/value|amount|profit$/i.test(name)) return 'pct';
  if (/stock_value|inventory_value|order_value/i.test(name)) return 'money';
  if (NOT_MONEY.test(name)) return 'qty';
  if (MONEY.test(name)) return 'money';
  return 'number';
}

export function firstNonNull(rows: Array<Record<string, unknown>>, col: string): unknown {
  for (const r of rows) if (r[col] != null) return r[col];
  return null;
}

export function formatCell(v: unknown, kind: ColKind): string {
  if (v == null || v === '') return '–';
  switch (kind) {
    case 'money': return typeof v === 'number' ? formatINR(v) : String(v);
    case 'pct': return typeof v === 'number' ? formatPct(v, 2) : String(v);
    case 'qty': return typeof v === 'number' ? formatQty(v) : String(v);
    case 'number': return typeof v === 'number' ? (Number.isInteger(v) ? formatNumber(v) : formatNumber(v, 2)) : String(v);
    case 'date': return formatDate(String(v));
    case 'month': return monthLabel(String(v));
    default: return String(v);
  }
}

/** "gross_profit" -> "Gross profit". */
export function prettyName(col: string): string {
  const s = col.replace(/_/g, ' ').replace(/\bpct\b/i, '%').replace(/\bqty\b/i, 'quantity').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
