import { describe, expect, it } from 'vitest';
import { backtestWape, chooseMethod, confidenceFromWape, crostonSba, fitHolt, forecastDaily, forecastProduct, holt } from '@/core/analytics/forecast';
import { classifyAbc } from '@/core/analytics/abc';
import { pickChart } from '@/core/analytics/chartPicker';
import { colKind, formatCell, prettyName } from '@/core/ask/format';
import { compareResults } from '@/core/ask/compare';

describe('forecast method selection', () => {
  it('chooses by history length and intermittency', () => {
    expect(chooseMethod([])).toBeNull();
    expect(chooseMethod(new Array(60).fill(0))).toBeNull();
    expect(chooseMethod(new Array(20).fill(2))).toBe('moving_average');
    expect(chooseMethod(new Array(40).fill(2))).toBe('moving_average');
    expect(chooseMethod(new Array(70).fill(2))).toBe('holt');
    expect(chooseMethod(Array.from({ length: 70 }, (_, i) => (i % 3 === 0 ? 3 : 0)))).toBe('croston');
  });
});

describe('Holt and Croston', () => {
  it('Holt follows a linear trend', () => {
    const y = Array.from({ length: 12 }, (_, i) => 10 + 2 * i);
    const f = holt(y, 0.8, 0.5);
    expect(f.level + f.trend).toBeGreaterThan(30);
    const fit = fitHolt(y);
    expect(fit.alpha).toBeGreaterThan(0);
  });
  it('Croston/SBA estimates the rate of intermittent demand', () => {
    const series = Array.from({ length: 90 }, (_, i) => (i % 4 === 0 ? 4 : 0)); // 1 a day on average
    const r = crostonSba(series);
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(1.05);
    expect(crostonSba([0, 0, 0])).toBe(0);
  });
  it('a flat series forecasts the same level with high confidence', () => {
    const s = new Array(84).fill(5);
    const f = forecastDaily(s, '2026-11-17')!;
    expect(f.method).toBe('holt');
    const total = f.daily.slice(0, 7).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(35, 0);
    expect(backtestWape(s, '2026-11-17')).toBeLessThan(0.05);
  });
  it('a product that stopped selling forecasts zero', () => {
    const s = [...new Array(60).fill(3), ...new Array(70).fill(0)];
    expect(forecastDaily(s, '2026-11-17')!.daily.every((v) => v === 0)).toBe(true);
  });
  it('confidence comes from WAPE', () => {
    expect(confidenceFromWape(0.1, 'holt', 100)).toBe('high');
    expect(confidenceFromWape(0.3, 'holt', 100)).toBe('medium');
    expect(confidenceFromWape(0.7, 'holt', 100)).toBe('low');
    expect(confidenceFromWape(0.1, 'moving_average', 20)).toBe('low');
  });
});

describe('forecastProduct (reorder maths)', () => {
  const p = { id: 1, stock: 20, lead_time_days: 7, first_sale: '2026-08-20', series: new Array(90).fill(4) };
  const f = forecastProduct(p, '2026-11-17')!;
  it('computes cover, stock-out date and order quantity', () => {
    expect(f.avg_daily_demand).toBe(4);
    expect(f.days_of_cover).toBe(5);
    expect(f.predicted_stockout_date).toBe('2026-11-22');
    // demand over lead time + 14 days = 21 x 4 = 84, safety stock 0 (no variance), minus 20 in stock
    expect(f.suggested_reorder_qty).toBe(64);
    expect(f.reorder_point).toBe(28);
  });
  it('out of stock runs out today; negative stock is treated as zero for ordering', () => {
    const g = forecastProduct({ ...p, stock: -5 }, '2026-11-17')!;
    expect(g.predicted_stockout_date).toBe('2026-11-17');
    expect(g.suggested_reorder_qty).toBe(84);
  });
  it('runs 500 SKUs x 18 months quickly', () => {
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) forecastProduct({ ...p, id: i, series: Array.from({ length: 548 }, (_, k) => ((k * 7 + i) % 5)) }, '2026-11-17');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('ABC', () => {
  it('classifies by cumulative share', () => {
    const r = classifyAbc([{ key: 'a', label: 'A', value: 70 }, { key: 'b', label: 'B', value: 15 }, { key: 'c', label: 'C', value: 10 }, { key: 'd', label: 'D', value: 5 }, { key: 'z', label: 'Z', value: 0 }]);
    expect(r.map((x) => x.cls)).toEqual(['A', 'A', 'B', 'C']);
    expect(r[3].cumulative).toBe(100);
    expect(classifyAbc([])).toEqual([]);
  });
});

describe('chart picker', () => {
  it('one number -> KPI', () => expect(pickChart(['total_sales'], [{ total_sales: 5 }]).type).toBe('kpi'));
  it('dates -> line, with a moving average past 30 points', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ day: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, revenue: i }));
    expect(pickChart(['day', 'revenue'], rows)).toMatchObject({ type: 'line', x: 'day', movingAverage: true });
    expect(pickChart(['month', 'revenue'], [{ month: '2026-09', revenue: 1 }, { month: '2026-10', revenue: 2 }])).toMatchObject({ type: 'line', movingAverage: false });
  });
  it('short labels -> bar, long labels -> horizontal bar', () => {
    expect(pickChart(['weekday', 'revenue'], [{ weekday: 'Sun', revenue: 2 }, { weekday: 'Mon', revenue: 1 }]).type).toBe('bar');
    expect(pickChart(['product_name', 'revenue'], [{ product_name: 'Aashirvaad Atta 5kg', revenue: 2 }, { product_name: 'Sugar 1kg', revenue: 1 }]).type).toBe('hbar');
  });
  it('folds more than 12 categories into top 10 + Others', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ category: `C${i}`, revenue: 100 - i }));
    const c = pickChart(['category', 'revenue'], rows);
    expect(c.rows).toHaveLength(11);
    expect(c.rows![10].category).toBe('Others (10)');
  });
  it('share questions with up to 6 parts -> donut', () => {
    expect(pickChart(['category', 'amount'], [{ category: 'Rent', amount: 5 }, { category: 'Salary', amount: 9 }], { title: 'Expenses by category' }).type).toBe('donut');
  });
  it('two numeric columns -> scatter; text only -> table', () => {
    expect(pickChart(['units', 'revenue'], [{ units: 1, revenue: 2 }, { units: 2, revenue: 3 }, { units: 3, revenue: 5 }]).type).toBe('scatter');
    expect(pickChart(['name'], [{ name: 'a' }, { name: 'b' }]).type).toBe('table');
    expect(pickChart(['x'], []).type).toBe('table');
  });
});

describe('result formatting', () => {
  it('detects column kinds', () => {
    expect(colKind('revenue', 1)).toBe('money');
    expect(colKind('margin_pct', 1)).toBe('pct');
    expect(colKind('units', 1)).toBe('qty');
    expect(colKind('stock_value_at_cost', 1)).toBe('money');
    expect(colKind('sale_date', '2026-11-17')).toBe('date');
    expect(colKind('month', '2026-11')).toBe('month');
    expect(formatCell(123456, 'money')).toBe('₹1,23,456');
    expect(formatCell(null, 'money')).toBe('–');
    expect(prettyName('gross_profit')).toBe('Gross profit');
  });
  it('compares eval result sets order-insensitively with 0.5% tolerance', () => {
    expect(compareResults([{ a: 'x', v: 100 }, { a: 'y', v: 50 }], [{ name: 'y', total: 50.2 }, { name: 'x', total: 100 }])).toBe(true);
    expect(compareResults([{ v: 100 }], [{ v: 101 }])).toBe(false);
    expect(compareResults([{ v: 100 }, { v: 1 }], [{ v: 100 }])).toBe(false);
    expect(compareResults([{ p: 'a', v: 100 }, { p: 'b', v: 50 }], [{ a: 100, b: 50 }], 'values')).toBe(true);
  });
});
