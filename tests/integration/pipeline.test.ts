import { describe, expect, it } from 'vitest';
import { buildApi, type DbApi } from '@/core/db/api';
import { loadDemo } from '@/core/db/demoData';
import { forecastAll } from '@/core/analytics/forecast';
import { createAskPipeline, type AskDb, type AskEvent } from '@/core/ask/pipeline';
import { LlmError, type LlmProvider, type LlmRequest } from '@/core/ai/types';
import type { GoldenItem } from '@/core/ai/fewshot';
import golden from '../eval/golden.json';
import { makeEngine, TODAY } from '../helpers';
import { setTodayOverride } from '@/core/util/dates';

setTodayOverride(TODAY);
let shared: { api: DbApi; db: AskDb } | null = null;
async function demoApi(): Promise<{ api: DbApi; db: AskDb }> {
  if (shared) return shared;
  const e = await makeEngine();
  loadDemo(e, TODAY);
  const api = buildApi(e);
  api.saveForecasts(forecastAll(api.forecastInput(TODAY)), TODAY);
  const db = new Proxy({}, { get: (_t, p: string) => async (...a: unknown[]) => (api as unknown as Record<string, (...x: unknown[]) => unknown>)[p](...a) }) as unknown as AskDb;
  shared = { api, db };
  return shared;
}

/** A scripted LLM: each call returns the next reply (string) or throws (LlmError). */
function fakeLlm(replies: Array<string | LlmError | ((r: LlmRequest) => string)>): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return { id: 'groq', calls, listModels: async () => ['m'], async complete(r) { calls.push(r); const next = replies.shift(); if (next instanceof LlmError) throw next; const text = typeof next === 'function' ? next(r) : next ?? '{}'; return { text, model: r.model, ms: 1 }; } };
}

async function run(text: string, opts: { llm?: LlmProvider | null; online?: boolean; narration?: boolean; privacy?: boolean } = {}) {
  const { db } = await demoApi();
  const p = createAskPipeline({
    db, llm: () => opts.llm ?? null, today: () => TODAY, online: () => opts.online ?? true, golden: golden as GoldenItem[], retryBackoffMs: [1, 1],
    settings: () => ({ planModel: 'plan', narrateModel: 'narrate', fallbackModel: 'fb', privacyMode: !!opts.privacy, aiNarration: !!opts.narration, businessName: 'Test' }),
  });
  const events: AskEvent[] = [];
  for await (const ev of p.ask({ text, lang: 'en-IN', history: [] })) events.push(ev);
  const last = events.filter((e) => ['answer', 'error', 'clarify', 'action'].includes(e.type)).pop()!;
  return { events, last };
}

describe('KPIs match hand-computed values', () => {
  it('October revenue, profit, expenses and orders agree across the views, the KPI code and raw SQL', async () => {
    const { api } = await demoApi();
    const t = api.periodTotals('2026-10-01', '2026-10-31');
    const e = await makeEngine(api.snapshot());
    const raw = e.one<{ rev: number; cogs: number }>(`SELECT SUM(ROUND((s.qty*s.unit_price_paise - s.discount_paise)/100.0, 2)) AS rev, SUM(ROUND(s.qty*s.unit_cost_paise/100.0, 2)) AS cogs FROM sales s WHERE sale_date BETWEEN '2026-10-01' AND '2026-10-31'`)!;
    expect(t.revenue).toBeCloseTo(raw.rev, 2);
    expect(t.grossProfit).toBeCloseTo(raw.rev - raw.cogs, 1);
    expect(t.expenses).toBe((e.scalar<number>("SELECT SUM(amount_paise) FROM expenses WHERE expense_date LIKE '2026-10%'") ?? 0) / 100);
    expect(t.orders).toBe(e.scalar("SELECT COUNT(DISTINCT invoice_no) FROM sales WHERE sale_date LIKE '2026-10%'"));
    const viaView = api.query("SELECT ROUND(SUM(revenue), 2) AS r FROM v_daily_summary WHERE day BETWEEN '2026-10-01' AND '2026-10-31'", [], { readOnly: true }).rows[0].r as number;
    expect(viaView).toBeCloseTo(t.revenue, 1);
  });
  it('dashboard shows 6 KPIs, trend, monthly, top products and low stock quickly', async () => {
    const { api } = await demoApi();
    const t0 = performance.now();
    const d = api.dashboard('30d', TODAY);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(d.trend).toHaveLength(30);
    expect(d.topProducts).toHaveLength(5);
    expect(d.kpis.lowStock + d.kpis.outOfStock).toBe(11);
    expect(d.kpis.outOfStock).toBe(3);
    expect(d.kpis.deadStockValue).toBeGreaterThan(0);
  });
  it('empty database: every ratio is null, never NaN or Infinity', async () => {
    const api = buildApi(await makeEngine());
    const d = api.dashboard('month', TODAY);
    expect(d.hasData).toBe(false);
    expect(d.kpis.marginPct.value).toBeNull();
    expect(d.kpis.avgOrderValue.value).toBeNull();
    expect(d.kpis.revenue.deltaPct).toBeNull();
    expect(api.insights(TODAY).ratios.turnover).toBeNull();
  });
});

describe('ask pipeline', () => {
  it('answers the top questions offline with no key, from SQLite', async () => {
    const { last } = await run('What were my total sales last month?');
    expect(last.type).toBe('answer');
    if (last.type === 'answer') { expect(last.answer.route).toBe('offline'); expect(last.answer.text).toContain('₹3,83,449'); }
  });
  it('no key and an open question: offline message with suggestions', async () => {
    const { last } = await run('which supplier has the best rates for oil');
    expect(last).toMatchObject({ type: 'error', code: 'no_key' });
  });
  it('offline with a key: same', async () => {
    const { last } = await run('which supplier has the best rates for oil', { llm: fakeLlm([]), online: false });
    expect(last).toMatchObject({ type: 'error', code: 'offline' });
  });
  it('runs model SQL through the guard; a write is blocked and repaired', async () => {
    const llm = fakeLlm(['{"intent":"sql","sql":"DELETE FROM sales"}', '{"intent":"sql","sql":"SELECT COUNT(*) AS n FROM v_sales"}']);
    const { api } = await demoApi();
    const before = api.stats().sales;
    const { last } = await run('how many sale lines are there in total', { llm });
    expect(last.type).toBe('answer');
    expect(api.stats().sales).toBe(before);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].messages.at(-1)!.content).toMatch(/Not allowed/);
  });
  it('repairs a query with a non-existent column, at most twice', async () => {
    const llm = fakeLlm(['{"intent":"sql","sql":"SELECT nope FROM v_sales"}', '{"intent":"sql","sql":"SELECT nope2 FROM v_sales"}', '{"intent":"sql","sql":"SELECT nope3 FROM v_sales"}', '{"intent":"sql","sql":"SELECT 1"}']);
    const { last } = await run('weird question about sales nobody asks', { llm });
    expect(last).toMatchObject({ type: 'error', code: 'bad_sql' });
    expect(llm.calls).toHaveLength(3);
  });
  it('handles invalid JSON, fences and prose', async () => {
    const llm = fakeLlm(['not json at all', 'Sure!\n```json\n{"intent":"sql","sql":"SELECT COUNT(*) AS n FROM v_products"}\n```']);
    const { last } = await run('how many rows does the product view have', { llm });
    expect(last.type).toBe('answer');
  });
  it('multi-statement and PRAGMA attempts never execute', async () => {
    const llm = fakeLlm(['{"intent":"sql","sql":"SELECT 1 FROM v_sales; DROP TABLE products"}', '{"intent":"sql","sql":"PRAGMA writable_schema=1"}', '{"intent":"sql","sql":"ATTACH DATABASE \'x\' AS y"}']);
    const { api } = await demoApi();
    const { last } = await run('do something sneaky with my tables', { llm });
    expect(last.type).toBe('error');
    expect(api.stats().products).toBe(150);
  });
  it('clarify and unsupported are passed through', async () => {
    expect((await run('sales during last diwali', { llm: fakeLlm(['{"intent":"clarify","clarify":"Which dates?","options":["1-5 Nov 2026"]}']) })).last).toMatchObject({ type: 'clarify', options: ['1-5 Nov 2026'] });
    expect((await run('write me a poem about rice', { llm: fakeLlm(['{"intent":"unsupported","clarify":"I can only answer questions about your business."}']) })).last).toMatchObject({ type: 'error', code: 'unsupported' });
  });
  it('rate limits fall back to the closest offline answer when there is one', async () => {
    const llm = fakeLlm([new LlmError('rate_limit', 'busy', 429), new LlmError('rate_limit', 'busy', 429), new LlmError('rate_limit', 'busy', 429)]);
    const { last } = await run('total sales last month for the shop overall please thanks', { llm });
    expect(last.type).toBe('answer');
    if (last.type === 'answer') expect(last.answer.note).toMatch(/busy/);
  });
  it('an invalid key is reported plainly', async () => {
    const { last } = await run('which supplier has the best rates for oil', { llm: fakeLlm([new LlmError('auth', 'bad key', 401)]) });
    expect(last).toMatchObject({ type: 'error', code: 'auth' });
  });
  it('narration with a made-up number is discarded for the local template', async () => {
    const llm = fakeLlm(['{"intent":"sql","sql":"SELECT ROUND(SUM(revenue), 2) AS total FROM v_sales WHERE month = \'2026-10\'"}', '{"answer":"Sales were ₹999,999, up 12%.","followups":[]}']);
    const { last } = await run('what did the shop bring in during october', { llm, narration: true });
    if (last.type !== 'answer') throw new Error('no answer');
    expect(last.answer.textSource).toBe('template');
    expect(last.answer.text).not.toContain('999');
  });
  it('grounded narration is kept', async () => {
    const llm = fakeLlm(['{"intent":"sql","sql":"SELECT ROUND(SUM(revenue), 2) AS total FROM v_sales WHERE month = \'2026-10\'"}', '{"answer":"October sales were ₹383,449.","followups":["Top products in October","Compare with September"]}']);
    const { last } = await run('what did the shop bring in during october', { llm, narration: true });
    if (last.type !== 'answer') throw new Error('no answer');
    expect(last.answer.textSource).toBe('ai');
  });
  it('privacy mode sends no rows and no samples', async () => {
    const llm = fakeLlm(['{"intent":"sql","sql":"SELECT category, SUM(revenue) AS revenue FROM v_sales GROUP BY 1"}']);
    await run('what is the split of money by product group', { llm, narration: true, privacy: true });
    expect(llm.calls).toHaveLength(1); // no narration call
    expect(llm.calls[0].messages[1].content).not.toContain('Snacks & Biscuits');
  });
  it('forecast tool answers come from the app, not the model', async () => {
    const { last } = await run('When will Sugar 1kg run out?');
    if (last.type !== 'answer') throw new Error('no answer');
    expect(last.answer.route).toBe('tool');
    expect(last.answer.text).toMatch(/estimate based on your past sales/);
    expect(last.answer.forecastChart?.daily.length).toBe(30);
  });
  it('write requests produce a confirmation card and change nothing', async () => {
    const { api } = await demoApi();
    const before = api.stats().purchases;
    const { last } = await run('received 20 Sugar 1kg at 41');
    expect(last).toMatchObject({ type: 'action', card: { kind: 'purchase', qty: 20 } });
    expect(api.stats().purchases).toBe(before);
  });
  it('a very long question is capped at 2,000 characters', async () => {
    const llm = fakeLlm([(r) => { expect(r.messages[1].content.length).toBeLessThan(9000); return '{"intent":"unsupported"}'; }]);
    await run('blah '.repeat(2000), { llm });
    expect(llm.calls).toHaveLength(1);
  });
});

describe('backup, restore and migrations', () => {
  it('round-trips a backup exactly', async () => {
    const { api } = await demoApi();
    const bytes = api.snapshot();
    const other = buildApi(await makeEngine());
    other.restore(bytes);
    expect(other.stats()).toMatchObject({ products: 150, sales: api.stats().sales, expenses: api.stats().expenses });
    expect(other.periodTotals('2026-10-01', '2026-10-31')).toEqual(api.periodTotals('2026-10-01', '2026-10-31'));
  });
  it('rejects files that are not backups', async () => {
    const api = buildApi(await makeEngine());
    expect(() => api.restore(new TextEncoder().encode('hello'))).toThrow(/not a StockSense backup/);
    const plain = await makeEngine();
    plain.run('DROP TABLE sales'); // valid SQLite, wrong shape
    expect(() => api.restore(plain.snapshot())).toThrow(/not a StockSense backup/);
  });
  it('refuses a database from a newer app version', async () => {
    const e = await makeEngine();
    e.run('UPDATE _schema_version SET v = 99');
    await expect(makeEngine(e.snapshot())).rejects.toThrow(/newer version/);
  });
  it('the API key is never in a backup', async () => {
    const { api } = await demoApi();
    const text = new TextDecoder('latin1').decode(api.snapshot());
    expect(text).not.toMatch(/gsk_|apikey/i);
  });
  it('archives products with history instead of deleting them', async () => {
    const e = await makeEngine();
    loadDemo(e, TODAY);
    const a2 = buildApi(e);
    expect(a2.removeProduct(1)).toBe('archived');
    const id = a2.saveProduct({ name: 'Brand new', opening_stock: 5 });
    expect(a2.removeProduct(id)).toBe('deleted');
    expect(a2.stats().products).toBe(149);
  });
  it('negative stock is allowed and shown, never a crash', async () => {
    const e = await makeEngine();
    const api = buildApi(e);
    const id = api.saveProduct({ name: 'Thing', price: 10 });
    api.saveSale({ product_id: id, qty: 5 });
    expect(api.getProduct(id)!.stock).toBe(-5);
    expect(api.getProduct(id)!.status).toBe('out');
    expect(api.adjustStock(id, 'count', 3)).toBe(3);
  });
});
