// Deterministic tools the Ask pipeline can call instead of SQL: forecast, reorder list, ABC analysis.
// The model (or the offline engine) only chooses the tool; every figure comes from SQLite and forecast.ts.
import type { ChartSpec, ForecastInput, ForecastResult, Row } from '../types';
import type { InsightsData } from '../analytics/kpis';
import { abcSummary } from '../analytics/abc';
import { forecastProduct } from '../analytics/forecast';
import { resolveProduct } from '../ai/intents/engine';
import type { NameCandidate } from '../util/fuzzy';
import { formatDate } from '../util/dates';
import { formatINR, formatPct, formatQty } from '../util/money';

export interface ToolDb {
  forecastRows(where?: string, params?: unknown[]): Promise<Row[]>;
  forecastInput(today?: string, productId?: number | null): Promise<ForecastInput>;
  insights(today?: string): Promise<InsightsData>;
}
export interface ForecastChartData { name: string; unit: string; history: Array<{ day: string; units: number }>; daily: number[]; sigma: number; stock: number; stockout: string | null; today: string }
export interface ToolResult { title: string; columns: string[]; rows: Row[]; text: string; chart: ChartSpec; forecastChart?: ForecastChartData; assumptions: string[]; followups: string[]; didYouMean?: string }

const ESTIMATE = 'This is an estimate based on your past sales, not a promise.';
const FORECAST_COLS = ['product_name', 'stock_on_hand', 'avg_daily_demand', 'forecast_7d', 'forecast_30d', 'days_of_cover', 'predicted_stockout_date', 'suggested_reorder_qty', 'confidence'];

export async function runTool(db: ToolDb, tool: { name: string; args: Record<string, unknown> }, ctx: { today: string; products: NameCandidate[] }): Promise<ToolResult> {
  if (tool.name === 'reorder') {
    const ins = await db.insights(ctx.today);
    const rows: Row[] = ins.reorder.map((r) => ({ product_name: r.name, stock_on_hand: r.stock, days_of_cover: r.days_of_cover, predicted_stockout_date: r.predicted_stockout_date, suggested_reorder_qty: r.suggested_reorder_qty, order_value: r.order_value, supplier: r.supplier, confidence: r.confidence }));
    const total = rows.reduce((s, r) => s + Number(r.order_value ?? 0), 0);
    const text = rows.length
      ? `${rows.length} product${rows.length === 1 ? '' : 's'} should be reordered now, about ${formatINR(total)} at cost. Most urgent: ${rows.slice(0, 3).map((r) => `${r.product_name} (${formatQty(Number(r.stock_on_hand))} left, order ${formatQty(Number(r.suggested_reorder_qty))})`).join(', ')}. ${ESTIMATE}`
      : ins.forecastCount ? 'Nothing needs reordering right now: every product with sales history is above its reorder point.' : 'There is not enough sales history yet to suggest reorder quantities.';
    return { title: 'What to reorder now', columns: ['product_name', 'stock_on_hand', 'days_of_cover', 'predicted_stockout_date', 'suggested_reorder_qty', 'order_value', 'supplier', 'confidence'], rows, text, chart: { type: 'table' },
      assumptions: ['Order quantity = expected demand over the supplier lead time plus 14 days, plus safety stock, minus stock on hand'], followups: ['Show low stock items', 'Show dead stock'] };
  }
  if (tool.name === 'abc') {
    const ins = await db.insights(ctx.today);
    const rows: Row[] = ins.abc.map((a) => ({ product_name: a.label, revenue: a.value, share_pct: a.share, cumulative_pct: a.cumulative, abc_class: a.cls }));
    const s = abcSummary(ins.abc);
    const text = rows.length
      ? `Over the last 90 days, ${s.A.count} A-class products bring in ${formatINR(s.A.value)}; ${s.B.count} B-class and ${s.C.count} C-class products make up the rest. Your biggest earner is ${rows[0].product_name}.`
      : 'There are no sales in the last 90 days to classify.';
    return { title: 'ABC analysis, last 90 days', columns: ['product_name', 'revenue', 'share_pct', 'cumulative_pct', 'abc_class'], rows, text, chart: { type: 'table' }, assumptions: ['A = first 80% of revenue, B = next 15%, C = the rest'], followups: ['Show dead stock', 'Top 10 products last 90 days'] };
  }
  // forecast
  const phrase = String(tool.args.sku ?? tool.args.term ?? tool.args.product ?? tool.args.name ?? '').trim();
  let where = '', params: unknown[] = [], label = 'all products', didYouMean: string | undefined;
  if (phrase) {
    const bySku = ctx.products.find((p) => p.sku.toLowerCase() === phrase.toLowerCase());
    const slot = bySku ? { kind: 'one' as const, product: bySku, score: 1 } : resolveProduct(phrase, ctx.products);
    if (!slot) return { title: `Forecast: ${phrase}`, columns: [], rows: [], text: `I could not find a product called "${phrase}".`, chart: { type: 'table' }, assumptions: [], followups: ['What should I reorder?', 'Show low stock items'] };
    if (slot.kind === 'one') { where = 'AND p.id = ?'; params = [slot.product.id]; label = slot.product.name; if (slot.score < 0.96) didYouMean = slot.product.name; }
    else { where = slot.term.split(' ').map(() => 'AND p.name LIKE ?').join(' '); params = slot.term.split(' ').map((tk) => `%${tk}%`); label = `"${slot.term}" products`; }
  }
  const raw = await db.forecastRows(where + ' ORDER BY COALESCE(f.days_of_cover, 99999), p.name LIMIT 200', params);
  const rows: Row[] = raw.map((r) => Object.fromEntries(FORECAST_COLS.map((c) => [c, r[c]])));
  if (!raw.length) {
    return { title: `Forecast: ${label}`, columns: FORECAST_COLS, rows: [], text: `There is not enough sales history for ${label} to make an estimate yet.`, chart: { type: 'table' }, assumptions: [], followups: ['Show low stock items', 'Total sales this month'], didYouMean };
  }
  if (raw.length === 1) {
    const r = raw[0];
    const stock = Number(r.stock_on_hand ?? 0), avg = Number(r.avg_daily_demand ?? 0);
    const parts: string[] = [];
    if (stock <= 0) parts.push(`${r.product_name} is already out of stock.`);
    else if (!avg || Number(r.forecast_30d) === 0) parts.push(`${r.product_name} has ${formatQty(stock)} ${r.unit} in stock and has hardly sold recently, so it is not expected to run out soon.`);
    else parts.push(`${r.product_name} has ${formatQty(stock)} ${r.unit} left. At about ${formatQty(Math.round(avg * 10) / 10)} a day that is roughly ${formatQty(Number(r.days_of_cover))} days of cover${r.predicted_stockout_date ? `, so it should run out around ${formatDate(String(r.predicted_stockout_date))}` : ''}.`);
    if (Number(r.forecast_30d) > 0) parts.push(`Expected demand for the next 30 days is about ${formatQty(Math.round(Number(r.forecast_30d)))} (likely between ${formatQty(Math.round(Number(r.band_low_30d)))} and ${formatQty(Math.round(Number(r.band_high_30d)))}).`);
    if (Number(r.suggested_reorder_qty) > 0) parts.push(`Suggested order now: ${formatQty(Number(r.suggested_reorder_qty))}.`);
    parts.push(`${ESTIMATE} Confidence: ${r.confidence}.`);
    let forecastChart: ForecastChartData | undefined;
    try {
      const input = await db.forecastInput(ctx.today, Number(r.product_id));
      const p = input.products[0];
      const f: ForecastResult | null = p ? forecastProduct(p, ctx.today) : null;
      if (p && f?.daily) {
        const hist = p.series.slice(-60);
        const start = new Date(Date.UTC(+ctx.today.slice(0, 4), +ctx.today.slice(5, 7) - 1, +ctx.today.slice(8, 10) - (hist.length - 1)));
        forecastChart = {
          name: String(r.product_name), unit: String(r.unit ?? ''), today: ctx.today, daily: f.daily, sigma: f.sigma ?? 0, stock, stockout: (r.predicted_stockout_date as string) ?? null,
          history: hist.map((u, i) => ({ day: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10), units: u })),
        };
      }
    } catch { /* the chart is optional */ }
    return { title: `Forecast: ${r.product_name}`, columns: FORECAST_COLS, rows, text: parts.join(' '), chart: { type: forecastChart ? 'forecast' : 'kpi', y: ['stock_on_hand', 'days_of_cover', 'forecast_30d', 'suggested_reorder_qty'] }, forecastChart,
      assumptions: [`Method: ${r.method === 'holt' ? "Holt's smoothing on weekly sales" : r.method === 'croston' ? 'Croston/SBA for occasional sales' : '14-day moving average'}`], followups: ['What should I reorder?', `Sales of ${r.product_name} last 30 days`], didYouMean };
  }
  const soon = raw.filter((r) => r.predicted_stockout_date).slice(0, 3);
  const text = `${raw.length} products match ${label}. ${soon.length ? `Running out first: ${soon.map((r) => `${r.product_name} around ${formatDate(String(r.predicted_stockout_date))}`).join(', ')}.` : 'None is expected to run out in the next six months.'} ${ESTIMATE}`;
  return { title: `Forecast: ${label}`, columns: FORECAST_COLS, rows, text, chart: { type: 'table' }, assumptions: ['Sorted by days of cover'], followups: ['What should I reorder?', 'Show low stock items'], didYouMean };
}

export const pctText = formatPct;
