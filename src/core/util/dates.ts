// All business dates are plain 'YYYY-MM-DD' strings in the shop's local time (IST for the target user).
// Arithmetic is done in UTC on those strings, so daylight-saving and device-timezone quirks cannot shift a day.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number): string => String(n).padStart(2, '0');

export function isoFromParts(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

/** Today's date on the device clock (local time), or the test override. */
let todayOverride: string | null = null;
export function setTodayOverride(iso: string | null): void { todayOverride = iso; }
export function todayISO(now: Date = new Date()): string {
  if (todayOverride) return todayOverride;
  return isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const toUTC = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUTC = (ms: number): string => { const d = new Date(ms); return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return fromUTC(toUTC(iso)) === iso;
}
export const addDays = (iso: string, n: number): string => fromUTC(toUTC(iso) + n * 86400000);
/** b - a in whole days. */
export const diffDays = (a: string, b: string): number => Math.round((toUTC(b) - toUTC(a)) / 86400000);
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (iso: string): number => new Date(toUTC(iso)).getUTCDay();
/** Weeks start on Monday. */
export const startOfWeek = (iso: string): string => addDays(iso, -((weekdayOf(iso) + 6) % 7));
export const startOfMonth = (iso: string): string => iso.slice(0, 8) + '01';
export function endOfMonth(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  return fromUTC(Date.UTC(y, m, 0));
}
export function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = Number(iso.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(y, m, Math.min(d, last)));
}

/** Indian financial year (April to March). 2026-11-17 -> FY2026-27. */
export function fyOf(iso: string): { label: string; start: string; end: string } {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const startYear = m >= 4 ? y : y - 1;
  return { label: `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`, start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** 2026-11-17 -> "17 Nov 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return '–';
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
/** 2026-11-17 -> "17 Nov". */
export function formatDayShort(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}
/** "2026-10" -> "Oct 2026". */
export function monthLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

export interface DateRange { from: string; to: string; label: string }
export interface PeriodRange extends DateRange { prevFrom: string; prevTo: string; key: string }

export type PeriodKey = 'today' | '7d' | '30d' | '90d' | 'month' | 'fy';

/** Dashboard periods, each with the equal-length period just before it for the "vs previous" delta. */
export function periodRange(key: PeriodKey, today: string = todayISO()): PeriodRange {
  const span = (from: string, to: string, label: string, prevFrom?: string, prevTo?: string): PeriodRange => {
    const len = diffDays(from, to) + 1;
    return { key, from, to, label, prevFrom: prevFrom ?? addDays(from, -len), prevTo: prevTo ?? addDays(from, -1) };
  };
  switch (key) {
    case 'today': return span(today, today, 'Today');
    case '7d': return span(addDays(today, -6), today, 'Last 7 days');
    case '30d': return span(addDays(today, -29), today, 'Last 30 days');
    case '90d': return span(addDays(today, -89), today, 'Last 90 days');
    case 'month': {
      const from = startOfMonth(today);
      const prevFrom = addMonths(from, -1);
      // month to date vs the same number of days last month
      const prevTo = addDays(prevFrom, Math.min(diffDays(from, today), diffDays(prevFrom, endOfMonth(prevFrom))));
      return span(from, today, 'This month', prevFrom, prevTo);
    }
    case 'fy': {
      const fy = fyOf(today);
      const prevFrom = addMonths(fy.start, -12);
      return span(fy.start, today, fy.label, prevFrom, addDays(prevFrom, diffDays(fy.start, today)));
    }
  }
}
