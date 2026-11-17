// Every KPI the app shows is computed here from SQLite (never by the model).
// The formulas match the AI-facing views exactly, so a card and an AI answer always agree.
import type { DbEngine } from '../db/engine';
import type { DashboardData, ForecastInput, ForecastResult, Kpi, Row } from '../types';
import { addDays, addMonths, diffDays, periodRange, startOfMonth, startOfWeek, todayISO, type PeriodKey } from '../util/dates';
import { growthPct, ratio } from '../util/money';
import { classifyAbc, type AbcItem } from './abc';

const REV = 'ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2)';
const COGS = 'ROUND(s.qty * COALESCE(s.unit_cost_paise, p.cost_paise) / 100.0, 2)';
const r2 = (v: number | null | undefined): number => Math.round((v ?? 0) * 100) / 100;

export interface PeriodTotals { revenue: number; cogs: number; grossProfit: number; expenses: number; netProfit: number; orders: number; units: number; marginPct: number | null; avgOrderValue: number | null }

export function periodTotals(e: DbEngine, from: string, to: string): PeriodTotals {
  const s = e.one<{ revenue: number; cogs: number; orders: number; units: number }>(
    `SELECT COALESCE(SUM(${REV}), 0) AS revenue, COALESCE(SUM(${COGS}), 0) AS cogs,
            COUNT(DISTINCT COALESCE(NULLIF(s.invoice_no, ''), 'row-' || s.id)) AS orders, COALESCE(SUM(s.qty), 0) AS units
     FROM sales s JOIN products p ON p.id = s.product_id WHERE s.sale_date BETWEEN ? AND ?`, [from, to])!;
  const expenses = (e.scalar<number>('SELECT COALESCE(SUM(amount_paise), 0) FROM expenses WHERE expense_date BETWEEN ? AND ?', [from, to]) ?? 0) / 100;
  const revenue = r2(s.revenue), cogs = r2(s.cogs);
  const grossProfit = r2(revenue - cogs);
  const m = ratio(grossProfit, revenue);
  const aov = ratio(revenue, s.orders);
  return { revenue, cogs, grossProfit, expenses: r2(expenses), netProfit: r2(grossProfit - expenses), orders: s.orders, units: Math.round(s.units * 1000) / 1000,
    marginPct: m == null ? null : Math.round(m * 10000) / 100, avgOrderValue: aov == null ? null : r2(aov) };
}

const kpi = (value: number | null, prev: number | null): Kpi => ({ value, prev, deltaPct: value == null || prev == null ? null : growthPct(value, prev) });

export interface InventoryTotals { inventoryValue: number; lowStock: number; outOfStock: number; deadStockValue: number; deadStockPct: number | null; productCount: number }
export function inventoryTotals(e: DbEngine, today: string): InventoryTotals {
  const cutoff = addDays(today, -90);
  const t = e.one<{ v: number; low: number; out: number; n: number; dead: number }>(
    `SELECT COALESCE(SUM(CASE WHEN stock_on_hand > 0 THEN stock_value_at_cost ELSE 0 END), 0) AS v,
            COALESCE(SUM(stock_status = 'low'), 0) AS low, COALESCE(SUM(stock_status = 'out'), 0) AS out, COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN stock_on_hand > 0 AND last_sale_date IS NOT NULL AND last_sale_date <= ? THEN stock_value_at_cost ELSE 0 END), 0) AS dead
     FROM v_products`, [cutoff])!;
  const pct = ratio(t.dead, t.v);
  return { inventoryValue: r2(t.v), lowStock: t.low, outOfStock: t.out, productCount: t.n, deadStockValue: r2(t.dead), deadStockPct: pct == null ? null : Math.round(pct * 1000) / 10 };
}

function cached<T>(e: DbEngine, key: string, compute: () => T): T {
  const hit = e.scalar<string>('SELECT value FROM _kpi_cache WHERE key = ?', [key]);
  if (hit) { try { return JSON.parse(hit) as T; } catch { /* recompute */ } }
  const value = compute();
  try { e.run("INSERT OR REPLACE INTO _kpi_cache(key, value, computed_at) VALUES (?, ?, datetime('now'))", [key, JSON.stringify(value)]); } catch { /* cache is optional */ }
  return value;
}

export function dashboard(e: DbEngine, key: PeriodKey, today: string = todayISO()): DashboardData {
  return cached(e, `dash:${key}:${today}`, () => {
    const range = periodRange(key, today);
    const cur = periodTotals(e, range.from, range.to);
    const prev = periodTotals(e, range.prevFrom, range.prevTo);
    const inv = inventoryTotals(e, today);
    // the trend always shows at least a week so "Today" is not a single dot
    const trendFrom = diffDays(range.from, range.to) < 6 ? addDays(range.to, -6) : range.from;
    const byDay = new Map(e.all<{ d: string; r: number; c: number }>(
      `SELECT s.sale_date AS d, SUM(${REV}) AS r, SUM(${COGS}) AS c FROM sales s JOIN products p ON p.id = s.product_id WHERE s.sale_date BETWEEN ? AND ? GROUP BY s.sale_date`, [trendFrom, range.to]).map((x) => [x.d, x]));
    const trend: DashboardData['trend'] = [];
    for (let d = trendFrom; d <= range.to; d = addDays(d, 1)) { const x = byDay.get(d); trend.push({ day: d, revenue: r2(x?.r), gross_profit: r2((x?.r ?? 0) - (x?.c ?? 0)) }); }
    const monthFrom = addMonths(startOfMonth(today), -11);
    const monthly = e.all<{ month: string; revenue: number; gross_profit: number }>(
      `SELECT strftime('%Y-%m', s.sale_date) AS month, ROUND(SUM(${REV}), 2) AS revenue, ROUND(SUM(${REV}) - SUM(${COGS}), 2) AS gross_profit
       FROM sales s JOIN products p ON p.id = s.product_id WHERE s.sale_date >= ? AND s.sale_date <= ? GROUP BY 1 ORDER BY 1`, [monthFrom, today]);
    const topProducts = e.all<DashboardData['topProducts'][number]>(
      `SELECT p.name, p.sku, ROUND(SUM(${REV}), 2) AS revenue, ROUND(SUM(s.qty), 3) AS units, ROUND(SUM(${REV}) - SUM(${COGS}), 2) AS gross_profit
       FROM sales s JOIN products p ON p.id = s.product_id WHERE s.sale_date BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 5`, [range.from, range.to]);
    const categories = e.all<{ category: string; revenue: number }>(
      `SELECT p.category, ROUND(SUM(${REV}), 2) AS revenue FROM sales s JOIN products p ON p.id = s.product_id WHERE s.sale_date BETWEEN ? AND ? GROUP BY p.category ORDER BY revenue DESC`, [range.from, range.to]);
    const lowStockList = e.all<DashboardData['lowStockList'][number]>(
      `SELECT p.id, p.name, p.sku, st.on_hand AS stock, p.reorder_level, p.unit, CASE WHEN st.on_hand <= 0 THEN 'out' ELSE 'low' END AS status
       FROM products p JOIN _v_stock st ON st.product_id = p.id WHERE p.is_active = 1 AND st.on_hand <= p.reorder_level
       ORDER BY (st.on_hand <= 0) DESC, st.on_hand * 1.0 / MAX(p.reorder_level, 1) ASC, p.name LIMIT 5`);
    const hasData = (e.scalar<number>('SELECT (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM sales)') ?? 0) > 0;
    return {
      asOf: today, range, hasData,
      kpis: {
        revenue: kpi(cur.revenue, prev.revenue), grossProfit: kpi(cur.grossProfit, prev.grossProfit), marginPct: kpi(cur.marginPct, prev.marginPct),
        netProfit: kpi(cur.netProfit, prev.netProfit), orders: kpi(cur.orders, prev.orders), avgOrderValue: kpi(cur.avgOrderValue, prev.avgOrderValue),
        units: kpi(cur.units, prev.units), expenses: kpi(cur.expenses, prev.expenses), ...inv,
      },
      trend, monthly, topProducts, categories, lowStockList,
    };
  });
}

// ---------- insights ----------
export interface InsightsData {
  asOf: string;
  reorder: Array<{ id: number; name: string; sku: string; unit: string; stock: number; days_of_cover: number | null; predicted_stockout_date: string | null; suggested_reorder_qty: number; confidence: string; supplier: string | null; order_value: number; method: string }>;
  deadStock: Array<{ id: number; name: string; stock: number; unit: string; value: number; days: number; last_sale_date: string }>;
  abc: AbcItem[];
  ageing: Array<{ bucket: string; value: number; products: number }>;
  heatmap: Array<{ week: string; weekday: number; revenue: number }>;
  expensesByCategory: Array<{ category: string; amount: number }>;
  expensesMonthly: Array<{ month: string; category: string; amount: number }>;
  stockHealth: Array<{ category: string; out: number; low: number; ok: number; overstock: number }>;
  ratios: { turnover: number | null; dio: number | null; sellThroughPct: number | null; avgInventory: number | null; cogs365: number };
  forecastCount: number;
}

/** Inventory value at cost on a past date: stock from movements up to that date, valued at today's cost. */
function inventoryValueOn(e: DbEngine, date: string): number {
  return r2(e.scalar<number>(
    `SELECT COALESCE(SUM(CASE WHEN q.on_hand > 0 THEN q.on_hand * p.cost_paise / 100.0 ELSE 0 END), 0)
     FROM products p JOIN (SELECT product_id, SUM(qty_delta) AS on_hand FROM stock_movements WHERE move_date <= ? GROUP BY product_id) q ON q.product_id = p.id`, [date]));
}

export function insights(e: DbEngine, today: string = todayISO()): InsightsData {
  return cached(e, `insights:${today}`, () => {
    const d90 = addDays(today, -89), d365 = addDays(today, -364);
    const reorder = e.all<InsightsData['reorder'][number]>(
      `SELECT p.id, p.name, p.sku, p.unit, st.on_hand AS stock, f.days_of_cover, f.predicted_stockout_date, f.suggested_reorder_qty, f.confidence, f.method,
              sup.name AS supplier, ROUND(f.suggested_reorder_qty * p.cost_paise / 100.0, 2) AS order_value
       FROM _forecast f JOIN products p ON p.id = f.product_id JOIN _v_stock st ON st.product_id = p.id LEFT JOIN suppliers sup ON sup.id = p.supplier_id
       WHERE p.is_active = 1 AND f.suggested_reorder_qty > 0 AND st.on_hand <= f.reorder_point
       ORDER BY COALESCE(f.days_of_cover, 0) ASC, f.suggested_reorder_qty DESC LIMIT 60`);
    const deadStock = e.all<InsightsData['deadStock'][number]>(
      `SELECT p.id, p.name, st.on_hand AS stock, p.unit, ROUND(st.on_hand * p.cost_paise / 100.0, 2) AS value, st.last_sale_date,
              CAST(julianday(?) - julianday(st.last_sale_date) AS INTEGER) AS days
       FROM products p JOIN _v_stock st ON st.product_id = p.id
       WHERE p.is_active = 1 AND st.on_hand > 0 AND st.last_sale_date IS NOT NULL AND st.last_sale_date <= ? ORDER BY value DESC LIMIT 60`, [today, addDays(today, -90)]);
    const abc = classifyAbc(e.all<{ key: string; label: string; value: number }>(
      `SELECT p.sku AS key, p.name AS label, ROUND(SUM(${REV}), 2) AS value FROM sales s JOIN products p ON p.id = s.product_id
       WHERE s.sale_date BETWEEN ? AND ? GROUP BY p.id HAVING value > 0`, [d90, today]));
    const ageing = e.all<InsightsData['ageing'][number]>(
      `SELECT bucket, ROUND(SUM(value), 2) AS value, COUNT(*) AS products FROM (
         SELECT st.on_hand * p.cost_paise / 100.0 AS value,
                CASE WHEN st.last_sale_date IS NULL THEN 'Never sold'
                     WHEN julianday(?) - julianday(st.last_sale_date) <= 30 THEN '0-30 days'
                     WHEN julianday(?) - julianday(st.last_sale_date) <= 60 THEN '31-60 days'
                     WHEN julianday(?) - julianday(st.last_sale_date) <= 90 THEN '61-90 days' ELSE '90+ days' END AS bucket
         FROM products p JOIN _v_stock st ON st.product_id = p.id WHERE p.is_active = 1 AND st.on_hand > 0) GROUP BY bucket`, [today, today, today]);
    const order = ['0-30 days', '31-60 days', '61-90 days', '90+ days', 'Never sold'];
    ageing.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
    const heatFrom = addDays(startOfWeek(today), -7 * 11);
    const heatmap = e.all<{ d: string; r: number }>(`SELECT s.sale_date AS d, SUM(${REV}) AS r FROM sales s WHERE s.sale_date BETWEEN ? AND ? GROUP BY s.sale_date`, [heatFrom, today])
      .map((x) => ({ week: startOfWeek(x.d), weekday: (new Date(x.d + 'T00:00:00Z').getUTCDay() + 6) % 7, revenue: r2(x.r) }));
    const expensesByCategory = e.all<{ category: string; amount: number }>('SELECT category, ROUND(SUM(amount_paise) / 100.0, 2) AS amount FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', [d90, today]);
    const expensesMonthly = e.all<{ month: string; category: string; amount: number }>(
      `SELECT strftime('%Y-%m', expense_date) AS month, category, ROUND(SUM(amount_paise) / 100.0, 2) AS amount FROM expenses WHERE expense_date >= ? AND expense_date <= ? GROUP BY 1, 2 ORDER BY 1`, [addMonths(startOfMonth(today), -5), today]);
    const stockHealth = e.all<InsightsData['stockHealth'][number]>(
      `SELECT category, SUM(stock_status = 'out') AS out, SUM(stock_status = 'low') AS low, SUM(stock_status = 'ok') AS ok, SUM(stock_status = 'overstock') AS overstock FROM v_products GROUP BY category ORDER BY category`);
    // ratios over the last 365 days (or since the first sale, annualised)
    const first = e.scalar<string>('SELECT MIN(sale_date) FROM sales');
    const from = first && first > d365 ? first : d365;
    const days = first ? Math.max(1, diffDays(from, today) + 1) : 0;
    const cogs = days ? r2(e.scalar<number>(`SELECT COALESCE(SUM(${COGS}), 0) FROM sales s JOIN products p ON p.id = s.product_id WHERE s.sale_date BETWEEN ? AND ?`, [from, today])) : 0;
    const avgInv = days ? r2((inventoryValueOn(e, addDays(from, -1)) + inventoryValueOn(e, today)) / 2) : null;
    const turn = days && avgInv ? ratio(cogs * (365 / days), avgInv) : null;
    const sold = e.scalar<number>('SELECT COALESCE(SUM(qty), 0) FROM sales WHERE sale_date BETWEEN ? AND ?', [d90, today]) ?? 0;
    const opening = e.scalar<number>('SELECT COALESCE(SUM(qty_delta), 0) FROM stock_movements WHERE move_date < ?', [d90]) ?? 0;
    const received = e.scalar<number>("SELECT COALESCE(SUM(qty_delta), 0) FROM stock_movements WHERE move_date BETWEEN ? AND ? AND kind IN ('purchase', 'opening', 'return_in')", [d90, today]) ?? 0;
    const st = ratio(sold, Math.max(0, opening) + received);
    return {
      asOf: today, reorder, deadStock, abc, ageing, heatmap, expensesByCategory, expensesMonthly, stockHealth,
      ratios: { turnover: turn == null ? null : Math.round(turn * 100) / 100, dio: turn ? Math.round(365 / turn) : null, sellThroughPct: st == null ? null : Math.round(st * 1000) / 10, avgInventory: avgInv, cogs365: cogs },
      forecastCount: e.scalar<number>('SELECT COUNT(*) FROM _forecast') ?? 0,
    };
  });
}

// ---------- forecast plumbing (the maths lives in forecast.ts and runs in the analytics worker) ----------
export function forecastInput(e: DbEngine, today: string = todayISO(), productId?: number | null): ForecastInput {
  const meta = new Map(e.all<{ id: number; stock: number; lead: number }>(
    'SELECT p.id, st.on_hand AS stock, p.lead_time_days AS lead FROM products p JOIN _v_stock st ON st.product_id = p.id WHERE p.is_active = 1').map((m) => [m.id, m]));
  const products: ForecastInput['products'] = [];
  let cur: ForecastInput['products'][number] | null = null;
  let firstDay = '';
  for (const r of e.all<{ pid: number; d: string; q: number }>(`SELECT product_id AS pid, sale_date AS d, SUM(qty) AS q FROM sales WHERE sale_date <= ?${productId ? ' AND product_id = ?' : ''} GROUP BY product_id, sale_date ORDER BY product_id, sale_date`, productId ? [today, productId] : [today])) {
    const m = meta.get(r.pid);
    if (!m) continue;
    if (!cur || cur.id !== r.pid) {
      firstDay = r.d;
      cur = { id: r.pid, stock: m.stock, lead_time_days: m.lead, first_sale: r.d, series: new Array<number>(diffDays(r.d, today) + 1).fill(0) };
      products.push(cur);
    }
    cur.series[diffDays(firstDay, r.d)] = r.q;
  }
  return { today, products };
}

export function saveForecasts(e: DbEngine, results: ForecastResult[], today: string = todayISO()): number {
  e.tx(() => {
    e.run('DELETE FROM _forecast');
    for (const f of results) {
      e.runFast(`INSERT INTO _forecast(product_id, avg_daily_demand, forecast_7d, forecast_30d, band_low_30d, band_high_30d, days_of_cover, predicted_stockout_date,
          suggested_reorder_qty, reorder_point, safety_stock, method, confidence, wape, history_days, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.product_id, f.avg_daily_demand, f.forecast_7d, f.forecast_30d, f.band_low_30d, f.band_high_30d, f.days_of_cover, f.predicted_stockout_date,
          f.suggested_reorder_qty, f.reorder_point, f.safety_stock, f.method, f.confidence, f.wape, f.history_days, today]);
    }
    e.run("INSERT INTO _settings(key, value) VALUES ('forecast_version', ?), ('forecast_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(e.dataVersion()), today]);
    e.run("DELETE FROM _kpi_cache WHERE key LIKE 'insights:%'");
  });
  e.persist();
  return results.length;
}

export function forecastState(e: DbEngine, today: string = todayISO()): { stale: boolean; count: number; date: string | null } {
  const date = e.getSetting('forecast_date');
  const stale = date !== today || e.getSetting('forecast_version') !== String(e.dataVersion());
  return { stale, count: e.scalar<number>('SELECT COUNT(*) FROM _forecast') ?? 0, date };
}

/** Rows for the forecast tool answers (joined with product names). */
export function forecastRows(e: DbEngine, where = '', params: unknown[] = []): Row[] {
  return e.all(`SELECT p.id AS product_id, p.sku, p.name AS product_name, p.unit, st.on_hand AS stock_on_hand, f.avg_daily_demand, f.forecast_7d, f.forecast_30d, f.band_low_30d, f.band_high_30d,
      f.days_of_cover, f.predicted_stockout_date, f.reorder_point, f.suggested_reorder_qty, f.method, f.confidence, p.lead_time_days
    FROM _forecast f JOIN products p ON p.id = f.product_id JOIN _v_stock st ON st.product_id = p.id WHERE p.is_active = 1 ${where}`, params);
}
