// Money is stored as integer paise and shown in rupees with Indian digit grouping.
// Formatting is done by hand (not Intl) so the output is identical on every WebView.

export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const fromPaise = (paise: number | null | undefined): number => (paise == null ? 0 : paise / 100);

/** 1234567 -> "12,34,567" (last three digits, then groups of two). */
export function groupIndian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  const rest = intDigits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const neg = n < 0 || Object.is(n, -0);
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const isZero = Number(fixed) === 0;
  return (neg && !isZero ? '-' : '') + groupIndian(int) + (frac ? '.' + frac : '');
}

/** ₹1,23,456 for cards and tables. Paise are shown only when asked for or when the amount is small. */
export function formatINR(rupees: number | null | undefined, opts: { decimals?: number } = {}): string {
  if (rupees == null || !Number.isFinite(rupees)) return '–';
  const decimals = opts.decimals ?? (Math.abs(rupees) < 100 && !Number.isInteger(rupees) ? 2 : 0);
  const s = formatNumber(rupees, decimals);
  return s.startsWith('-') ? '-₹' + s.slice(1) : '₹' + s;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** ₹1.2L / ₹3.4Cr / ₹12.5K for chart axes and tight spaces. */
export function formatCompactINR(rupees: number | null | undefined): string {
  if (rupees == null || !Number.isFinite(rupees)) return '–';
  const a = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${trimZeros((a / 1e7).toFixed(2))}Cr`;
  if (a >= 1e5) return `${sign}₹${trimZeros((a / 1e5).toFixed(2))}L`;
  if (a >= 1e3) return `${sign}₹${trimZeros((a / 1e3).toFixed(1))}K`;
  return `${sign}₹${trimZeros(a.toFixed(a < 10 ? 2 : 0))}`;
}

/** "1.23 lakh rupees" style wording for sentences and read-aloud answers. */
export function spokenINR(rupees: number | null | undefined): string {
  if (rupees == null || !Number.isFinite(rupees)) return 'no amount';
  const a = Math.abs(rupees);
  const sign = rupees < 0 ? 'minus ' : '';
  if (a >= 1e7) return `${sign}₹${trimZeros((a / 1e7).toFixed(2))} crore`;
  if (a >= 1e5) return `${sign}₹${trimZeros((a / 1e5).toFixed(2))} lakh`;
  return `${sign}${formatINR(a)}`;
}

/** Quantities: up to 3 decimals, trailing zeros removed, Indian grouping. */
export function formatQty(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return '–';
  const r = Math.round(q * 1000) / 1000;
  const dec = Number.isInteger(r) ? 0 : trimZeros(r.toFixed(3)).split('.')[1]?.length ?? 0;
  return formatNumber(r, dec);
}

export function formatPct(p: number | null | undefined, decimals = 1): string {
  if (p == null || !Number.isFinite(p)) return '–';
  return `${trimZeros(p.toFixed(decimals))}%`;
}

/** Safe ratio: returns null (shown as "–") instead of Infinity/NaN. */
export function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

/** (current - previous) / |previous| as a percentage, or null when there is nothing to compare with. */
export function growthPct(current: number | null | undefined, previous: number | null | undefined): number | null {
  const r = ratio((current ?? 0) - (previous ?? 0), previous == null ? null : Math.abs(previous));
  return r == null ? null : r * 100;
}
