import { describe, expect, it } from 'vitest';
import { matchIntent, closestExamples, resolveProduct } from '@/core/ai/intents/engine';
import { parsePeriod, parseComparison } from '@/core/ai/intents/periods';
import { generateDemo } from '@/core/db/demoData';
import { guardSql } from '@/core/ai/sqlGuard';
import { ALLOWED_VIEWS } from '@/core/db/semantic';
import { TODAY } from '../helpers';

const products = generateDemo(TODAY).products.map((p, i) => ({ id: i + 1, name: p.name, sku: p.sku }));
const ctx = { today: TODAY, products };

// 60 phrases: [question, expected intent id]
const PHRASES: Array<[string, string]> = [
  ['What were my total sales last month?', 'sales_total'], ['total sales this month', 'sales_total'], ['how much did I sell today', 'sales_total'],
  ['sales yesterday', 'sales_total'], ['revenue this fy', 'sales_total'], ['turnover last week', 'sales_total'], ['sales in october', 'sales_total'],
  ['what is my profit this month', 'profit_total'], ['gross profit last month', 'profit_total'], ['net profit last month', 'profit_total'],
  ['am i making money', 'profit_total'], ['profit margin this fy', 'profit_total'],
  ['top 5 products last month', 'top_products'], ['best selling items this week', 'top_products'], ['top 10 products by units this month', 'top_products'],
  ['which products are most profitable last 30 days', 'top_products'], ['best sellers', 'top_products'], ['top three items by profit', 'top_products'],
  ['bottom 5 products last month', 'bottom_products'], ['worst selling items this month', 'bottom_products'], ['least sold products', 'bottom_products'],
  ['show low stock items', 'low_stock'], ['which items are running low', 'low_stock'], ['what is running out', 'low_stock'], ['items below reorder level', 'low_stock'],
  ['out of stock items', 'out_of_stock'], ['what is sold out', 'out_of_stock'], ['zero stock products', 'out_of_stock'],
  ['show dead stock', 'dead_stock'], ['which items are not moving', 'dead_stock'], ['slow moving items', 'dead_stock'],
  ['what should I reorder', 'reorder'], ['reorder list', 'reorder'], ['what do i need to buy this week', 'reorder'],
  ['when will sugar 1kg run out', 'stockout_forecast'], ['when will parle-g biscuit 100g finish', 'stockout_forecast'], ['how long will milma milk last', 'stockout_forecast'],
  ['forecast for maggi noodles 70g', 'forecast_product'], ['predict demand for tata salt 1kg', 'forecast_product'],
  ['stock of sugar 1kg', 'stock_of_product'], ['how many tata salt 1kg do we have', 'stock_of_product'], ['parle-g biscuit 100g stock', 'stock_of_product'], ['how much bisleri water 1l is left', 'stock_of_product'],
  ['inventory value', 'inventory_value'], ['what is my stock worth', 'inventory_value'], ['value of my inventory', 'inventory_value'],
  ['sales by category this month', 'sales_by_category'], ['category wise sales last month', 'sales_by_category'],
  ['margin by category', 'margin_by_category'], ['which category is the most profitable', 'margin_by_category'],
  ['expenses this month', 'expenses_total'], ['how much did i spend on rent last month', 'expenses_total'], ['expenses by category', 'expenses_by_category'], ['where does my money go', 'expenses_by_category'],
  ['compare this month vs last month', 'compare_periods'], ['compare sales this week versus last week', 'compare_periods'],
  ['which day is busiest', 'busiest_day'], ['how many orders this month', 'orders_count'], ['average order value last month', 'orders_count'], ['how are we doing', 'summary'],
];

describe('offline intent engine', () => {
  it('has 60 test phrases', () => expect(PHRASES.length).toBe(60));
  const results = PHRASES.map(([q, want]) => ({ q, want, got: matchIntent(q, ctx) }));
  it.each(PHRASES)('"%s" -> %s', (q, want) => {
    const m = matchIntent(q, ctx);
    expect(m?.id).toBe(want);
  });
  it('answers at least 95% of the phrases with confidence >= 0.85', () => {
    const confident = results.filter((r) => r.got && r.got.id === r.want && r.got.confidence >= 0.85).length;
    expect(confident / PHRASES.length).toBeGreaterThanOrEqual(0.95);
  });
  it('only ever produces SQL the guard accepts', () => {
    for (const r of results) if (r.got?.sql) expect(guardSql(r.got.sql, ALLOWED_VIEWS).ok, r.q).toBe(true);
  });
  it('is fast', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) for (const [q] of PHRASES) matchIntent(q, ctx);
    expect((performance.now() - t0) / 600).toBeLessThan(5);
  });
  it('leaves unknown questions for the AI', () => {
    for (const q of ['which supplier gives the best discount on oil', 'write a poem', 'how many customers bought both sugar and tea']) {
      const m = matchIntent(q, ctx);
      expect(!m || m.confidence < 0.85, q).toBe(true);
    }
  });
  it('fuzzy-matches misheard product names', () => {
    expect(resolveProduct('aashirvad atta 5 kg', products)).toMatchObject({ kind: 'one' });
    const fam = resolveProduct('sugar', products);
    expect(fam?.kind).toBe('family');
  });
  it('suggests the closest supported questions', () => expect(closestExamples('low stock please')[0]).toMatch(/low stock/i));
});

describe('periods', () => {
  it.each([
    ['today', '2026-11-17', '2026-11-17'], ['yesterday', '2026-11-16', '2026-11-16'], ['this week', '2026-11-16', '2026-11-17'],
    ['last week', '2026-11-09', '2026-11-15'], ['this month', '2026-11-01', '2026-11-17'], ['last month', '2026-10-01', '2026-10-31'],
    ['last 30 days', '2026-10-19', '2026-11-17'], ['past 7 days', '2026-11-11', '2026-11-17'], ['this fy', '2026-04-01', '2026-11-17'],
    ['last financial year', '2025-04-01', '2026-03-31'], ['in october', '2026-10-01', '2026-10-31'], ['december', '2025-12-01', '2025-12-31'],
    ['march 2026', '2026-03-01', '2026-03-31'], ['last year', '2025-01-01', '2025-12-31'], ['last quarter', '2026-07-01', '2026-09-30'],
  ])('%s', (text, from, to) => expect(parsePeriod(text, TODAY)).toMatchObject({ from, to }));
  it('handles "last month" in the first days of a month and year ends', () => {
    expect(parsePeriod('last month', '2027-01-02')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    expect(parsePeriod('this fy', '2027-03-31')).toMatchObject({ from: '2026-04-01' });
    expect(parsePeriod('this fy', '2027-04-01')).toMatchObject({ from: '2027-04-01' });
  });
  it('does not treat "may" the verb as a month', () => expect(parsePeriod('what may run out', TODAY)).toBeNull());
  it('splits comparisons', () => expect(parseComparison('this month vs last month', TODAY)).toMatchObject({ a: { key: 'this_month' }, b: { key: 'last_month' } }));
});
