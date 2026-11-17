// Understands the time phrases shop owners actually use: "today", "last month", "this FY",
// "last 30 days", "in October", "this week" (weeks start on Monday).
import { MONTHS_LONG, addDays, addMonths, endOfMonth, formatDate, fyOf, monthLabel, startOfMonth, startOfWeek, type DateRange } from '../../util/dates';

export interface ParsedPeriod extends DateRange { key: string; matched: string; /** the equal-length period just before, for comparisons */ prev: DateRange }

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, thirty: 30, sixty: 60, ninety: 90 };

function mk(key: string, matched: string, from: string, to: string, label: string, prevFrom?: string, prevTo?: string, prevLabel?: string): ParsedPeriod {
  const len = Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000) + 1;
  const pf = prevFrom ?? addDays(from, -len), pt = prevTo ?? addDays(from, -1);
  return { key, matched, from, to, label, prev: { from: pf, to: pt, label: prevLabel ?? `${formatDate(pf)} to ${formatDate(pt)}` } };
}

function quarterStart(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const qm = m - ((m - 1) % 3);
  return `${iso.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`;
}

/** Finds the first time phrase in the text. Returns null when there is none. */
export function parsePeriod(text: string, today: string): ParsedPeriod | null {
  const t = ' ' + text.toLowerCase().replace(/[,?!.]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let m: RegExpExecArray | null;

  if ((m = /\b(day before yesterday)\b/.exec(t))) { const d = addDays(today, -2); return mk('day', m[1], d, d, formatDate(d)); }
  if ((m = /\b(yesterday)\b/.exec(t))) { const d = addDays(today, -1); return mk('yesterday', m[1], d, d, 'yesterday'); }
  if ((m = /\b(today|todays|today's)\b/.exec(t))) return mk('today', m[1], today, today, 'today');

  if ((m = /\b((?:last|past|previous)\s+(\d+|[a-z]+)\s+(day|week|month|year)s?)\b/.exec(t))) {
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : NUM_WORDS[m[2]];
    if (n && n > 0 && n <= 3660) {
      const unit = m[3];
      const from = unit === 'day' ? addDays(today, -(n - 1)) : unit === 'week' ? addDays(today, -(n * 7 - 1)) : unit === 'month' ? addDays(addMonths(today, -n), 1) : addDays(addMonths(today, -12 * n), 1);
      return mk(`last_${n}_${unit}`, m[1], from, today, `the last ${n} ${unit}${n > 1 ? 's' : ''}`);
    }
  }
  if ((m = /\b(this week|current week)\b/.exec(t))) { const from = startOfWeek(today); return mk('this_week', m[1], from, today, 'this week', addDays(from, -7), addDays(today, -7), 'last week (same days)'); }
  if ((m = /\b(last week|previous week)\b/.exec(t))) { const from = addDays(startOfWeek(today), -7); return mk('last_week', m[1], from, addDays(from, 6), 'last week'); }
  if ((m = /\b(this month|current month|month to date|mtd)\b/.exec(t))) {
    const from = startOfMonth(today);
    const pf = addMonths(from, -1);
    const pt = addMonths(today, -1) < pf ? pf : addMonths(today, -1);
    return mk('this_month', m[1], from, today, 'this month', pf, pt, 'last month (same days)');
  }
  if ((m = /\b(last month|previous month)\b/.exec(t))) {
    const from = addMonths(startOfMonth(today), -1);
    const pf = addMonths(from, -1);
    return mk('last_month', m[1], from, endOfMonth(from), monthLabel(from.slice(0, 7)), pf, endOfMonth(pf), monthLabel(pf.slice(0, 7)));
  }
  if ((m = /\b(this quarter|current quarter)\b/.exec(t))) { const from = quarterStart(today); return mk('this_quarter', m[1], from, today, 'this quarter'); }
  if ((m = /\b(last quarter|previous quarter)\b/.exec(t))) { const from = addMonths(quarterStart(today), -3); return mk('last_quarter', m[1], from, endOfMonth(addMonths(from, 2)), 'last quarter'); }
  if ((m = /\b((?:last|previous) (?:fy|financial year|fiscal year))\b/.exec(t))) {
    const fy = fyOf(addMonths(fyOf(today).start, -1));
    return mk('last_fy', m[1], fy.start, fy.end, fy.label);
  }
  if ((m = /\b((?:this |current )?(?:fy|financial year|fiscal year)(?: to date)?|ytd|year to date)\b/.exec(t))) {
    const fy = fyOf(today);
    const pf = addMonths(fy.start, -12);
    return mk('this_fy', m[1], fy.start, today, fy.label, pf, addMonths(today, -12), `${fyOf(pf).label} (same period)`);
  }
  if ((m = /\b(this year|current year)\b/.exec(t))) { const from = `${today.slice(0, 4)}-01-01`; return mk('this_year', m[1], from, today, today.slice(0, 4), addMonths(from, -12), addMonths(today, -12), `${Number(today.slice(0, 4)) - 1} (same period)`); }
  if ((m = /\b(last year|previous year)\b/.exec(t))) { const y = Number(today.slice(0, 4)) - 1; return mk('last_year', m[1], `${y}-01-01`, `${y}-12-31`, String(y)); }

  // a named month, optionally with a year: "october", "in oct 2025", "march 26"
  const monthRe = new RegExp(`\\b((?:in |for |during |of )?(${MONTHS_LONG.map((x) => `${x}|${x.slice(0, 3)}`).join('|')}|sept)\\.?(?: (\\d{4}|\\d{2}))?)\\b`);
  if ((m = monthRe.exec(t)) && !(m[2] === 'may' && !/\b(in|for|during|of) may\b|\bmay \d{2,4}\b/.test(t))) {
    const mi = MONTHS_LONG.findIndex((x) => x.startsWith(m![2].slice(0, 3)));
    let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
    const mm = String(mi + 1).padStart(2, '0');
    if (!m[3] && `${y}-${mm}-01` > today) y -= 1; // the most recent such month
    const from = `${y}-${mm}-01`;
    const to = endOfMonth(from) > today && from <= today ? today : endOfMonth(from);
    const pf = addMonths(from, -1);
    return mk('month', m[1].trim(), from, to, monthLabel(from.slice(0, 7)), pf, endOfMonth(pf), monthLabel(pf.slice(0, 7)));
  }
  if ((m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t))) return mk('day', m[1], m[1], m[1], formatDate(m[1]));
  if ((m = /\b(all time|overall|so far|till date|till now|ever|lifetime)\b/.exec(t))) return mk('all', m[1], '2000-01-01', today, 'all time');
  return null;
}

/** "this month vs last month", "this week compared to last week": the two sides of a comparison. */
export function parseComparison(text: string, today: string): { a: ParsedPeriod; b: ParsedPeriod } | null {
  const parts = text.toLowerCase().split(/\b(?:vs\.?|versus|compared (?:to|with)|against|and)\b/);
  if (parts.length < 2) return null;
  const a = parsePeriod(parts[0], today), b = parsePeriod(parts.slice(1).join(' '), today);
  return a && b && (a.from !== b.from || a.to !== b.to) ? { a, b } : null;
}
