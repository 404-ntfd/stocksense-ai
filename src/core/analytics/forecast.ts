// Demand forecasting in plain TypeScript: milliseconds per SKU, no ML runtime, explainable.
//   dense history (>= 56 days, < 50% zero days)  -> Holt's linear smoothing on weekly totals + day-of-week index
//   intermittent demand (>= 50% zero days)       -> Croston with the Syntetos-Boylan correction (SBA)
//   short history (< 28 days, or 28-55 dense)    -> 14-day moving average (low confidence)
// Every figure produced here is an estimate based on past sales, never a promise.
import type { ForecastInput, ForecastResult } from '../types';
import { addDays, weekdayOf } from '../util/dates';

export const HORIZON = 30;
const sum = (a: number[]): number => { let s = 0; for (const v of a) s += v; return s; };
const mean = (a: number[]): number => (a.length ? sum(a) / a.length : 0);
function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / (a.length - 1));
}
const round = (v: number, d = 2): number => { const f = 10 ** d; return Math.round(v * f) / f; };

export type Method = ForecastResult['method'];

export function chooseMethod(series: number[]): Method | null {
  const n = series.length;
  if (!n || sum(series) <= 0) return null;
  if (n < 28) return 'moving_average';
  const zeros = series.filter((v) => v === 0).length / n;
  if (zeros >= 0.5) return 'croston';
  return n >= 56 ? 'holt' : 'moving_average';
}

/** Holt's linear method. Returns the fitted level/trend and the one-step-ahead errors. */
export function holt(y: number[], alpha: number, beta: number): { level: number; trend: number; errors: number[] } {
  let level = y[0];
  let trend = y.length > 1 ? y[1] - y[0] : 0;
  const errors: number[] = [];
  for (let t = 1; t < y.length; t++) {
    const pred = level + trend;
    errors.push(y[t] - pred);
    const newLevel = alpha * y[t] + (1 - alpha) * (level + trend);
    trend = beta * (newLevel - level) + (1 - beta) * trend;
    level = newLevel;
  }
  return { level, trend, errors };
}

/** Grid-searches alpha and beta on the one-step errors of the last 4 weeks. */
export function fitHolt(weekly: number[]): { alpha: number; beta: number; level: number; trend: number } {
  let best = { alpha: 0.3, beta: 0.1, level: weekly[weekly.length - 1] ?? 0, trend: 0 };
  let bestSse = Number.POSITIVE_INFINITY;
  for (let a = 1; a <= 9; a++) {
    for (let b = 0; b <= 5; b++) {
      const alpha = a / 10, beta = b / 10;
      const f = holt(weekly, alpha, beta);
      const tail = f.errors.slice(-4);
      const sse = sum(tail.map((e) => e * e));
      if (sse < bestSse - 1e-9) { bestSse = sse; best = { alpha, beta, level: f.level, trend: f.trend }; }
    }
  }
  return best;
}

/** Croston/SBA demand rate per day for intermittent series. */
export function crostonSba(series: number[], alpha = 0.1): number {
  let z = 0, p = 0, q = 1, started = false;
  for (const v of series) {
    if (v > 0) {
      if (!started) { z = v; p = q; started = true; }
      else { z = alpha * v + (1 - alpha) * z; p = alpha * q + (1 - alpha) * p; }
      q = 1;
    } else q++;
  }
  if (!started || p <= 0) return 0;
  return (1 - alpha / 2) * (z / p);
}

/**
 * Daily forecast for the next `horizon` days. `lastDay` is the date of the last element of the series,
 * needed for the day-of-week pattern.
 */
export function forecastDaily(series: number[], lastDay: string, horizon = HORIZON): { method: Method; daily: number[] } | null {
  const method = chooseMethod(series);
  if (!method) return null;
  const n = series.length;
  if (sum(series.slice(-60)) === 0) return { method, daily: new Array<number>(horizon).fill(0) }; // stopped selling
  if (method === 'moving_average') {
    const rate = mean(series.slice(-14));
    return { method, daily: new Array<number>(horizon).fill(rate) };
  }
  if (method === 'croston') {
    const rate = crostonSba(series);
    return { method, daily: new Array<number>(horizon).fill(rate) };
  }
  // Holt on complete weeks ending at the last day
  const weeks = Math.floor(n / 7);
  const weekly: number[] = [];
  for (let w = weeks; w >= 1; w--) weekly.push(sum(series.slice(n - w * 7, n - (w - 1) * 7)));
  const fit = fitHolt(weekly);
  // day-of-week index from the last 8 weeks (averages 1 across the week)
  const dow = new Array<number>(7).fill(0);
  const lastWd = weekdayOf(lastDay);
  const span = Math.min(n, 56);
  for (let i = 0; i < span; i++) dow[(((lastWd - i) % 7) + 7) % 7] += series[n - 1 - i];
  const total = sum(dow);
  const index = dow.map((v) => (total > 0 ? (v / total) * 7 : 1));
  const cap = Math.max(...weekly.slice(-8)) * 2; // a runaway trend must not double the best recent week
  const daily: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const week = Math.ceil(h / 7);
    const weekTotal = Math.min(cap, Math.max(0, fit.level + fit.trend * week));
    daily.push((weekTotal / 7) * index[(lastWd + h) % 7]);
  }
  return { method, daily };
}

/** Holds out the last 14 days and scores the forecast by WAPE on the two weekly totals. */
export function backtestWape(series: number[], lastDay: string): number | null {
  if (series.length < 28) return null;
  const train = series.slice(0, -14);
  const actual = series.slice(-14);
  const f = forecastDaily(train, addDays(lastDay, -14), 14);
  if (!f) return null;
  const a1 = sum(actual.slice(0, 7)), a2 = sum(actual.slice(7));
  const f1 = sum(f.daily.slice(0, 7)), f2 = sum(f.daily.slice(7));
  const denom = a1 + a2;
  if (denom <= 0) return null;
  return (Math.abs(a1 - f1) + Math.abs(a2 - f2)) / denom;
}

export function confidenceFromWape(wape: number | null, method: Method, historyDays: number): ForecastResult['confidence'] {
  if (historyDays < 28 || wape == null) return 'low';
  if (wape < 0.25) return 'high';
  if (wape <= 0.5) return 'medium';
  return 'low';
}

export function forecastProduct(p: ForecastInput['products'][number], today: string): ForecastResult | null {
  const series = p.series;
  const f = forecastDaily(series, today, HORIZON);
  if (!f) return null;
  const recent = series.slice(-28);
  const avgDaily = mean(recent);
  const sigmaDemand = stdev(series.slice(-56));
  const forecast7 = sum(f.daily.slice(0, 7));
  const forecast30 = sum(f.daily);
  const wape = backtestWape(series, today);
  const lead = Math.max(1, p.lead_time_days || 7);
  const safety = 1.65 * sigmaDemand * Math.sqrt(lead);
  const reorderPoint = avgDaily * lead + safety;
  const tailRate = mean(f.daily.slice(-7));
  const rateAt = (d: number): number => (d < f.daily.length ? f.daily[d] : tailRate);
  // demand over the lead time plus a 14-day review period
  let cover = 0;
  for (let d = 0; d < lead + 14; d++) cover += rateAt(d);
  const stock = Math.max(0, p.stock);
  const suggested = forecast30 > 0 ? Math.max(0, Math.ceil(cover + safety - stock)) : 0;
  let stockout: string | null = null;
  if (p.stock <= 0) stockout = today;
  else {
    let left = p.stock;
    for (let d = 0; d < 180; d++) {
      left -= rateAt(d);
      if (left <= 0) { stockout = addDays(today, d + 1); break; }
    }
  }
  const band = 1.28 * sigmaDemand * Math.sqrt(HORIZON);
  return {
    product_id: p.id,
    avg_daily_demand: round(avgDaily, 3),
    forecast_7d: round(forecast7, 1),
    forecast_30d: round(forecast30, 1),
    band_low_30d: round(Math.max(0, forecast30 - band), 1),
    band_high_30d: round(forecast30 + band, 1),
    days_of_cover: avgDaily > 0 ? round(stock / avgDaily, 1) : null,
    predicted_stockout_date: stockout,
    suggested_reorder_qty: suggested,
    reorder_point: round(reorderPoint, 1),
    safety_stock: round(safety, 1),
    method: f.method,
    confidence: confidenceFromWape(wape, f.method, series.length),
    wape: wape == null ? null : round(wape, 3),
    history_days: series.length,
    daily: f.daily.map((v) => round(v, 3)),
    sigma: round(sigmaDemand, 3),
  };
}

export function forecastAll(input: ForecastInput): ForecastResult[] {
  const out: ForecastResult[] = [];
  for (const p of input.products) {
    const r = forecastProduct(p, input.today);
    if (r) out.push(r);
  }
  return out;
}
