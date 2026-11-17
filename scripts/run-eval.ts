// Golden-set eval against the real LLM.
//   npm run eval                      LLM-only (every question goes to the model): measures text-to-SQL
//   npm run eval -- --mode pipeline   the pipeline as shipped (offline intent engine first)
//   npm run eval -- --ids t01,n03     a subset;  --limit 6  the first N
// Needs GROQ_API_KEY in the environment. Model replies are cached in tests/eval/.cache, so re-scoring is free.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { DbEngine } from '../src/core/db/engine';
import { buildApi } from '../src/core/db/api';
import { forecastAll } from '../src/core/analytics/forecast';
import { OpenAiCompatProvider } from '../src/core/ai/providers/openaiCompat';
import { LlmError, PROVIDER_DEFAULTS, type LlmProvider, type LlmRequest, type LlmResponse } from '../src/core/ai/types';
import { createAskPipeline, type AskDb, type AskEvent } from '../src/core/ask/pipeline';
import { compareResults } from '../src/core/ask/compare';
import { dateTokens, fillTokens } from '../src/core/ai/dateTokens';
import { guardSql } from '../src/core/ai/sqlGuard';
import { todayISO } from '../src/core/util/dates';
import type { GoldenItem } from '../src/core/ai/fewshot';
import type { Row, Turn } from '../src/core/types';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const mode = arg('mode') === 'pipeline' ? 'pipeline' : 'llm';
const key = process.env.GROQ_API_KEY;
if (!key) { console.error('GROQ_API_KEY is not set.'); process.exit(2); }

const golden = JSON.parse(readFileSync('tests/eval/golden.json', 'utf8')) as GoldenItem[];
let items = golden;
if (arg('ids')) { const ids = new Set(arg('ids')!.split(',')); items = golden.filter((g) => ids.has(g.id)); }
if (arg('limit')) items = items.slice(0, Number(arg('limit')));

const today = todayISO();
const tokens = dateTokens(today);
const SQL = await initSqlJs();
const engine = new DbEngine(SQL);
const api = buildApi(engine);
api.loadDemo(today);
api.saveForecasts(forecastAll(api.forecastInput(today)), today);
const db = new Proxy({}, { get: (_t, prop: string) => async (...a: unknown[]) => (api as unknown as Record<string, (...x: unknown[]) => unknown>)[prop](...a) }) as unknown as AskDb;

// --- caching, rate-limit-aware provider ---
const CACHE = 'tests/eval/.cache';
mkdirSync(CACHE, { recursive: true });
const real = new OpenAiCompatProvider('groq', PROVIDER_DEFAULTS.groq.baseUrl, () => key);
let liveCalls = 0, cachedCalls = 0, promptTokens = 0, completionTokens = 0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const cached: LlmProvider = {
  id: 'groq',
  listModels: () => real.listModels(),
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const file = `${CACHE}/${createHash('sha256').update(JSON.stringify([req.model, req.messages])).digest('hex').slice(0, 24)}.json`;
    if (existsSync(file)) { cachedCalls++; return JSON.parse(readFileSync(file, 'utf8')) as LlmResponse; }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await real.complete(req);
        liveCalls++; promptTokens += res.promptTokens ?? 0; completionTokens += res.completionTokens ?? 0;
        writeFileSync(file, JSON.stringify(res));
        // free tier: 8,000 tokens a minute for this model, so pace the calls
        await sleep(Math.min(30000, (((res.promptTokens ?? 2000) + (res.completionTokens ?? 200)) / 8000) * 60000 * 1.1));
        return res;
      } catch (e) {
        if (e instanceof LlmError && e.kind === 'rate_limit' && attempt < 6) { await sleep((e.retryAfterMs ?? 20000) + 2000); continue; }
        throw e;
      }
    }
  },
};

interface Outcome { id: string; cat: string; q: string; pass: boolean; kind: string; detail: string; sql?: string; ms: number; route?: string }
const outcomes: Outcome[] = [];
let guardBlocked = 0, unsafeExecuted = 0;

for (const item of items) {
  const pipeline = createAskPipeline({
    db, llm: () => cached, today: () => today, online: () => true, golden, excludeExampleId: item.id, forceAi: mode === 'llm', retryBackoffMs: [],
    settings: () => ({ planModel: PROVIDER_DEFAULTS.groq.planModel, narrateModel: PROVIDER_DEFAULTS.groq.narrateModel, fallbackModel: PROVIDER_DEFAULTS.groq.fallbackModel, privacyMode: false, aiNarration: false, businessName: 'Sree Krishna Stores' }),
  });
  const history: Turn[] = (item.history ?? []).map((h) => ({ question: h.q, sql: fillTokens(h.sql, tokens) }));
  const t0 = Date.now();
  let last: AskEvent | null = null;
  const sqls: string[] = [];
  try {
    for await (const ev of pipeline.ask({ text: item.q, lang: 'en-IN', history })) { if (ev.type === 'sql') sqls.push(ev.sql); if (['answer', 'error', 'clarify', 'action'].includes(ev.type)) last = ev; }
  } catch (e) { last = { type: 'error', code: 'unknown', message: (e as Error).message, suggestions: [] }; }
  const ms = Date.now() - t0;
  for (const s of sqls) { const g = guardSql(s, engine.allowedTables()); if (!g.ok) unsafeExecuted++; }
  let pass = false, kind = last?.type ?? 'none', detail = '';
  const predSql = last?.type === 'answer' ? last.answer.sql ?? undefined : sqls[sqls.length - 1];
  if (last?.type === 'error') { kind = last.code === 'unsupported' ? 'unsupported' : 'error'; detail = last.message; }
  if (item.expect) {
    const want = item.expect.split('|');
    const got = last?.type === 'answer' ? (last.answer.route === 'tool' ? 'tool' : 'sql') : kind;
    pass = want.includes(got);
    detail = `expected ${item.expect}, got ${got}`;
  } else if (item.tool) {
    if (last?.type === 'answer' && last.answer.tool) {
      const product = String(item.tool.args?.product ?? '');
      const sameTool = last.answer.tool.name === item.tool.name;
      const sameProduct = !product || (last.answer.rows.length === 1 && last.answer.rows[0].product_name === product);
      pass = sameTool && sameProduct;
      detail = `tool ${last.answer.tool.name} ${JSON.stringify(last.answer.tool.args)}${sameProduct ? '' : ' (wrong product)'}`;
    } else detail = `expected tool ${item.tool.name}, got ${kind}`;
  } else if (item.sql) {
    const goldRows = engine.all<Row>(fillTokens(item.sql, tokens));
    if (last?.type === 'answer' && last.answer.route !== 'tool') {
      pass = compareResults(goldRows, last.answer.rows, item.match === 'values' ? 'values' : 'rows');
      detail = pass ? `${goldRows.length} row(s) match` : `gold ${JSON.stringify(goldRows.slice(0, 3))} vs got ${JSON.stringify(last.answer.rows.slice(0, 3))}`;
    } else detail = `expected rows, got ${kind}: ${detail}`;
  }
  outcomes.push({ id: item.id, cat: item.cat, q: item.q, pass, kind, detail: detail.slice(0, 400), sql: predSql, ms, route: last?.type === 'answer' ? last.answer.route : undefined });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${item.id} [${last?.type === 'answer' ? last.answer.route : kind}] ${item.q}${pass ? '' : `\n     ${detail.slice(0, 300)}${predSql ? `\n     SQL: ${predSql.slice(0, 300)}` : ''}`}`);
}
guardBlocked = engine.scalar<number>("SELECT COUNT(*) FROM _qa_log WHERE error LIKE 'guard:%'") ?? 0;

const passed = outcomes.filter((o) => o.pass).length;
const byCat: Record<string, { pass: number; total: number }> = {};
for (const o of outcomes) { byCat[o.cat] ??= { pass: 0, total: 0 }; byCat[o.cat].total++; if (o.pass) byCat[o.cat].pass++; }
const summary = {
  mode, date: today, model: PROVIDER_DEFAULTS.groq.planModel, total: outcomes.length, passed, scorePct: Math.round((passed / Math.max(1, outcomes.length)) * 1000) / 10,
  byCategory: byCat, guardBlocked, unsafeExecuted, liveCalls, cachedCalls, promptTokens, completionTokens,
  avgMs: Math.round(outcomes.reduce((s, o) => s + o.ms, 0) / Math.max(1, outcomes.length)),
};
console.log('\n' + JSON.stringify(summary, null, 2));
if (items.length === golden.length) {
  writeFileSync(`tests/eval/results-${mode}.json`, JSON.stringify({ summary, outcomes }, null, 2));
  const scoreFile = 'src/core/ai/evalScore.json';
  const prev = existsSync(scoreFile) ? (JSON.parse(readFileSync(scoreFile, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(scoreFile, JSON.stringify({ ...prev, [mode]: { scorePct: summary.scorePct, passed, total: summary.total, date: today, model: summary.model, unsafeExecuted } }, null, 2) + '\n');
}
