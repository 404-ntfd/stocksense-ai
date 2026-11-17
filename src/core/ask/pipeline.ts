// The Ask pipeline: question -> (write card | offline intent | LLM plan) -> guarded SQL or tool -> chart -> grounded answer.
// The model never produces a number the user sees: it writes SQL or picks a tool, and optionally phrases a
// sentence that is then checked against the result.
import type { ChartSpec, QueryOpts, QueryResult, Row, SchemaDoc, Turn } from '../types';
import { guardSql } from '../ai/sqlGuard';
import { matchIntent, closestExamples, type IntentMatch } from '../ai/intents/engine';
import { parsePeriod } from '../ai/intents/periods';
import { buildPlanMessages, buildRepairMessages, MAX_QUESTION_CHARS, parsePlan, type Plan } from '../ai/plan';
import { retrieveExamples, type GoldenItem } from '../ai/fewshot';
import { buildNarrationMessages, checkGrounding, localNarration, parseNarration } from '../ai/narrate';
import { completeWithRetry } from '../ai/providers/openaiCompat';
import { LlmError, type LlmMessage, type LlmProvider } from '../ai/types';
import { pickChart } from '../analytics/chartPicker';
import { matchProducts, type NameCandidate } from '../util/fuzzy';
import { normaliseTranscript } from '../voice/normalise';
import { ACTION_SYSTEM, describeAction, looksLikeWrite, parseAction, type ActionCard, type ActionKind } from './actions';
import { runTool, type ForecastChartData, type ToolDb } from './tools';
import { extractJson } from '../ai/plan';

export interface AskDb extends ToolDb {
  query<T = Row>(sql: string, params?: unknown[], opts?: QueryOpts): Promise<QueryResult<T>>;
  productNames(): Promise<Array<{ id: number; name: string; sku: string; unit: string }>>;
  schemaForLlm(withSamples?: boolean): Promise<SchemaDoc>;
  allowedTables(): Promise<string[]>;
  logQa(entry: { question: string; sql?: string | null; ok: boolean; ms: number; route: string; error?: string | null }): Promise<number>;
}

export interface AskSettings {
  planModel: string; narrateModel: string; fallbackModel: string;
  /** Privacy mode: never send result rows or data samples to the AI. */
  privacyMode: boolean;
  aiNarration: boolean;
  businessName?: string | null;
}

export interface AskDeps {
  db: AskDb;
  /** Returns the provider, or null when no key is configured. */
  llm: () => Promise<LlmProvider | null> | LlmProvider | null;
  settings: () => AskSettings;
  today: () => string;
  online: () => boolean;
  golden: GoldenItem[];
  /** Makes sure the forecast table is fresh before a forecast tool runs. */
  ensureForecasts?: () => Promise<void>;
  /** Leave-one-out for the eval: never retrieve the question being asked as its own example. */
  excludeExampleId?: string;
  retryBackoffMs?: number[];
  /** Eval only: skip the offline engine so the score measures the model's text-to-SQL. */
  forceAi?: boolean;
}

export type Route = 'offline' | 'ai' | 'tool' | 'action' | 'none';
export interface AskAnswer {
  qaId: number | null;
  route: Route;
  question: string;
  title: string;
  text: string;
  textSource: 'template' | 'ai';
  sql: string | null;
  columns: string[];
  rows: Row[];
  truncated: boolean;
  chart: ChartSpec;
  forecastChart?: ForecastChartData;
  assumptions: string[];
  followups: string[];
  didYouMean?: string;
  /** e.g. "closest supported question" when the offline engine answered a fuzzy match */
  note?: string;
  ms: number;
  model?: string;
  tool?: { name: string; args: Record<string, unknown> };
}

export type AskEvent =
  | { type: 'stage'; stage: 'understanding' | 'thinking' | 'querying' | 'repairing' | 'forecasting' | 'writing'; detail?: string }
  | { type: 'sql'; sql: string }
  | { type: 'rows'; columns: string[]; rows: Row[]; truncated: boolean }
  | { type: 'chart'; chart: ChartSpec }
  | { type: 'answer'; answer: AskAnswer }
  | { type: 'action'; card: ActionCard }
  | { type: 'clarify'; question: string; options: string[] }
  | { type: 'error'; code: ErrorCode; message: string; suggestions: string[] };

export type ErrorCode = 'no_key' | 'offline' | 'busy' | 'auth' | 'bad_sql' | 'too_heavy' | 'unsupported' | 'timeout' | 'empty' | 'action' | 'unknown';

export interface AskPipeline { ask(q: { text: string; lang: string; history: Turn[] }): AsyncGenerator<AskEvent> }

const shape = (columns: string[], rows: Row[]): string => `${rows.length} row(s); columns: ${columns.join(', ')}`;

/** "and last month?" / "what about yesterday" -> the previous question with its period swapped. */
export function rewriteFollowup(prev: string | undefined, text: string, today: string): string | null {
  if (!prev) return null;
  const m = /^(?:and|what about|how about|same for|and for|then|now)\b[\s,]*(.+)$/i.exec(text.trim().replace(/\?+$/, ''));
  if (!m) return null;
  const next = parsePeriod(m[1], today);
  if (!next) return null;
  const old = parsePeriod(prev, today);
  const base = old ? prev.toLowerCase().replace(old.matched, ' ').replace(/\s+/g, ' ').trim() : prev.trim();
  return `${base.replace(/\?+$/, '')} ${next.matched}`.trim();
}

export function createAskPipeline(deps: AskDeps): AskPipeline {
  let namesCache: { at: number; names: NameCandidate[] } | null = null;
  const names = async (): Promise<NameCandidate[]> => {
    if (!namesCache || Date.now() - namesCache.at > 15000) namesCache = { at: Date.now(), names: await deps.db.productNames() };
    return namesCache.names;
  };
  const log = async (question: string, sql: string | null, ok: boolean, ms: number, route: string, error?: string): Promise<number | null> => {
    try { return await deps.db.logQa({ question, sql, ok, ms, route, error: error ?? null }); } catch { return null; }
  };

  async function narrate(llm: LlmProvider | null, question: string, title: string, columns: string[], rows: Row[], extraAllowed: string[]): Promise<{ text: string; followups: string[] } | null> {
    const s = deps.settings();
    if (!llm || s.privacyMode || !s.aiNarration || !deps.online() || !rows.length) return null;
    try {
      const res = await completeWithRetry(llm, { model: s.narrateModel, messages: buildNarrationMessages(question, title, columns, rows), json: true, maxTokens: 500, timeoutMs: 12000 }, { backoffMs: [] });
      const n = parseNarration(res.text);
      if (!n) return null;
      const g = checkGrounding(n.answer, rows, [question, title, ...extraAllowed]);
      return g.ok ? { text: n.answer, followups: n.followups } : null; // any untraceable number: discard
    } catch { return null; }
  }

  async function* run(q: { text: string; lang: string; history: Turn[] }): AsyncGenerator<AskEvent> {
    const t0 = Date.now();
    const today = deps.today();
    let text = normaliseTranscript(q.text).trim();
    const tooLong = text.length > MAX_QUESTION_CHARS;
    if (tooLong) text = text.slice(0, MAX_QUESTION_CHARS);
    if (!text) { yield { type: 'error', code: 'empty', message: 'Ask a question by typing or tapping the mic.', suggestions: closestExamples('sales stock', 3) }; return; }
    yield { type: 'stage', stage: 'understanding' };
    const products = await names();
    const settings = deps.settings();
    const llm = await deps.llm();
    const canAi = !!llm && deps.online();

    // 1. write requests never reach SQL: they become a confirmation card
    if (looksLikeWrite(text)) {
      let parsed = parseAction(text, { today, products });
      if (parsed && !parsed.ok && !parsed.options && canAi && /could not work out/.test(parsed.reason)) {
        try {
          const res = await completeWithRetry(llm!, { model: settings.narrateModel, messages: [{ role: 'system', content: ACTION_SYSTEM }, { role: 'user', content: text.slice(0, 400) }], json: true, maxTokens: 300, timeoutMs: 12000 }, { backoffMs: [] });
          const j = extractJson(res.text) as { action?: string; product?: string; qty?: number; unit_amount?: number; amount?: number; category?: string; party?: string } | null;
          if (j && j.action && j.action !== 'none') {
            const kind = j.action as ActionKind;
            if (kind === 'expense' && typeof j.amount === 'number' && j.amount > 0) {
              const card: ActionCard = { kind, amount: j.amount, category: (j.category || 'Other').slice(0, 40), date: today, summary: '' };
              parsed = { ok: true, card: { ...card, summary: describeAction(card) } };
            } else if (j.product) {
              const best = matchProducts(j.product, products, 1)[0];
              if (best && best.score >= 0.8 && ['purchase', 'sale', 'price', 'count', 'damage'].includes(kind)) {
                const card: ActionCard = { kind, productId: best.item.id, productName: best.item.name, qty: typeof j.qty === 'number' ? j.qty : undefined, unitAmount: typeof j.unit_amount === 'number' ? j.unit_amount : null, party: j.party ?? null, date: today, summary: '', didYouMean: best.score < 0.96 ? best.item.name : undefined };
                if ((kind === 'price' && card.unitAmount != null) || (kind !== 'price' && card.qty != null && card.qty >= 0)) parsed = { ok: true, card: { ...card, summary: describeAction(card) } };
              }
            }
          }
        } catch { /* keep the regex result */ }
      }
      if (parsed) {
        if (parsed.ok) { await log(text, null, true, Date.now() - t0, 'action'); yield { type: 'action', card: parsed.card }; return; }
        if (parsed.options?.length) { yield { type: 'clarify', question: parsed.reason, options: parsed.options.map((o) => text.replace(/\b(of|for)\b.*$/i, '').trim() ? `${text} (${o})` : o) }; return; }
        yield { type: 'error', code: 'action', message: parsed.reason, suggestions: ['Sold 2 Sugar 1kg at ₹46', 'Received 20 Tata Salt 1kg', 'Set price of Maggi Noodles 70g to ₹15'] };
        return;
      }
    }

    // 2. offline intent engine
    const prevQuestion = q.history[q.history.length - 1]?.question;
    const rewritten = rewriteFollowup(prevQuestion, text, today);
    const intent = matchIntent(rewritten ?? text, { today, products });
    const useOffline = (m: IntentMatch | null, min: number): m is IntentMatch => !!m && m.confidence >= min;

    const finishSql = async function* (route: Route, sql: string, meta: { title: string; chartHint?: { type?: string; x?: string | null; y?: string[] | null }; assumptions: string[]; say?: (rows: Row[]) => string; followups: string[]; didYouMean?: string; note?: string; model?: string }, result: QueryResult<Row>): AsyncGenerator<AskEvent> {
      yield { type: 'rows', columns: result.columns, rows: result.rows, truncated: result.truncated };
      const chart = pickChart(result.columns, result.rows, { ...meta.chartHint, title: `${meta.title} ${text}` });
      yield { type: 'chart', chart };
      yield { type: 'stage', stage: 'writing' };
      let answerText = meta.say ? meta.say(result.rows) : localNarration(meta.title, result.columns, result.rows);
      let textSource: AskAnswer['textSource'] = 'template';
      let followups = meta.followups;
      if (route === 'ai') {
        const n = await narrate(llm, text, meta.title, result.columns, result.rows, meta.assumptions);
        if (n) { answerText = n.text; textSource = 'ai'; if (n.followups.length) followups = n.followups; }
      }
      const assumptions = [...meta.assumptions];
      if (result.truncated) assumptions.push(`Showing the first ${result.rows.length} rows`);
      if (tooLong) assumptions.push('Your question was very long, so only the first 2,000 characters were used');
      const ms = Date.now() - t0;
      const qaId = await log(text, sql, true, ms, route);
      yield { type: 'answer', answer: { qaId, route, question: text, title: meta.title, text: answerText, textSource, sql, columns: result.columns, rows: result.rows, truncated: result.truncated, chart, assumptions, followups, didYouMean: meta.didYouMean, note: meta.note, ms, model: meta.model } };
    };

    const finishTool = async function* (tool: { name: string; args: Record<string, unknown> }, extra: { note?: string; didYouMean?: string; model?: string }): AsyncGenerator<AskEvent> {
      yield { type: 'stage', stage: 'forecasting' };
      try { await deps.ensureForecasts?.(); } catch { /* use whatever forecasts exist */ }
      const r = await runTool(deps.db, tool, { today, products });
      yield { type: 'rows', columns: r.columns, rows: r.rows, truncated: false };
      yield { type: 'chart', chart: r.chart };
      const ms = Date.now() - t0;
      const qaId = await log(text, `tool:${tool.name} ${JSON.stringify(tool.args)}`, true, ms, 'tool');
      yield { type: 'answer', answer: { qaId, route: 'tool', question: text, title: r.title, text: r.text, textSource: 'template', sql: null, columns: r.columns, rows: r.rows, truncated: false, chart: r.chart, forecastChart: r.forecastChart, assumptions: r.assumptions, followups: r.followups, didYouMean: extra.didYouMean ?? r.didYouMean, note: extra.note, ms, model: extra.model, tool } };
    };

    const runOffline = async function* (m: IntentMatch, note?: string): AsyncGenerator<AskEvent> {
      if (m.tool) { yield* finishTool(m.tool, { note, didYouMean: m.didYouMean }); return; }
      const g = guardSql(m.sql!, await deps.db.allowedTables());
      if (!g.ok) throw new Error(g.reason);
      yield { type: 'sql', sql: m.sql! };
      yield { type: 'stage', stage: 'querying' };
      const result = await deps.db.query<Row>(m.sql!, [], { readOnly: true, timeoutMs: 3000 });
      yield* finishSql('offline', m.sql!, { title: m.title, chartHint: m.chart, assumptions: m.assumptions, say: m.say, followups: m.followups, didYouMean: m.didYouMean, note }, result);
    };

    try {
      if (!(deps.forceAi && canAi) && useOffline(intent, 0.85)) { yield* runOffline(intent); return; }

      // 3. the LLM plan call
      if (canAi) {
        yield { type: 'stage', stage: 'thinking' };
        const schema = await deps.db.schemaForLlm(!settings.privacyMode);
        const hints = settings.privacyMode ? [] : matchProducts(text, products, 6).filter((h) => h.score >= 0.7).map((h) => h.item.name);
        const base = buildPlanMessages({ question: text, today, businessName: settings.businessName, schema, examples: retrieveExamples(deps.golden, text, 6, deps.excludeExampleId), history: q.history, productHints: hints, includeSamples: !settings.privacyMode });
        let messages: LlmMessage[] = base;
        let lastError = '';
        let lastSql: string | null = null;
        let model = settings.planModel;
        try {
          for (let attempt = 0; attempt <= 2; attempt++) {
            const res = await completeWithRetry(llm!, { model, messages, json: true, maxTokens: 1200, timeoutMs: 20000 }, { fallbackModel: settings.fallbackModel, backoffMs: deps.retryBackoffMs, onSwitch: (m) => { model = m; } });
            const plan: Plan | null = parsePlan(res.text);
            if (!plan) { lastError = 'The reply was not valid JSON with an "intent".'; messages = [...base, { role: 'assistant', content: res.text.slice(0, 600) }, { role: 'user', content: 'Reply again with only the JSON object described in the rules.' }]; yield { type: 'stage', stage: 'repairing' }; continue; }
            if (plan.intent === 'clarify') { yield { type: 'clarify', question: plan.clarify ?? 'Could you say a bit more?', options: plan.options }; await log(text, null, true, Date.now() - t0, 'ai'); return; }
            if (plan.intent === 'unsupported') {
              await log(text, null, false, Date.now() - t0, 'ai', 'unsupported');
              yield { type: 'error', code: 'unsupported', message: plan.clarify ?? "I can only answer questions about this business's sales, stock, purchases and expenses, and I don't have that data.", suggestions: closestExamples(text, 3) };
              return;
            }
            if (plan.intent === 'tool' && plan.tool) { yield* finishTool(plan.tool, { model: res.model }); return; }
            const sql = plan.sql!;
            lastSql = sql;
            const g = guardSql(sql, await deps.db.allowedTables());
            if (!g.ok) { lastError = g.reason; messages = buildRepairMessages(base, sql, `Not allowed: ${g.reason}`); await log(text, sql, false, Date.now() - t0, 'ai', `guard: ${g.code}`); yield { type: 'stage', stage: 'repairing' }; continue; }
            yield { type: 'sql', sql };
            yield { type: 'stage', stage: 'querying' };
            let result: QueryResult<Row>;
            try {
              result = await deps.db.query<Row>(sql, [], { readOnly: true, timeoutMs: 3000 });
            } catch (e) {
              if ((e as Error).name === 'QueryTimeoutError') throw e;
              lastError = (e as Error).message;
              messages = buildRepairMessages(base, sql, lastError);
              yield { type: 'stage', stage: 'repairing', detail: lastError };
              continue;
            }
            yield* finishSql('ai', sql, { title: plan.title ?? text, chartHint: plan.chart, assumptions: plan.assumptions, followups: closestExamples(text, 2), model: res.model }, result);
            return;
          }
          await log(text, lastSql, false, Date.now() - t0, 'ai', lastError.slice(0, 300));
          yield { type: 'error', code: 'bad_sql', message: "I couldn't work that out. Try rephrasing the question.", suggestions: closestExamples(text, 3) };
          return;
        } catch (e) {
          if ((e as Error).name === 'QueryTimeoutError') throw e;
          if (!(e instanceof LlmError)) throw e;
          // the AI is unavailable: fall back to the closest offline answer when there is one
          if (useOffline(intent, 0.6)) { yield* runOffline(intent, e.kind === 'rate_limit' ? 'The AI is busy, so this is the closest question I can answer offline.' : 'The AI is not reachable, so this is the closest question I can answer offline.'); return; }
          const code: ErrorCode = e.kind === 'auth' ? 'auth' : e.kind === 'rate_limit' || e.kind === 'server' ? 'busy' : e.kind === 'timeout' ? 'timeout' : e.kind === 'network' ? 'offline' : 'unknown';
          const message = e.kind === 'auth' ? 'Your API key was rejected. Check it in Settings.' : code === 'busy' ? 'The AI is busy. Try again in a minute, or switch provider in Settings.' : code === 'timeout' ? 'The AI took too long. Try again.' : code === 'offline' ? "You're offline, so I can only answer the common questions." : e.message;
          await log(text, null, false, Date.now() - t0, 'ai', `${e.kind}: ${e.message}`.slice(0, 300));
          yield { type: 'error', code, message, suggestions: closestExamples(text, 3) };
          return;
        }
      }

      // 4. no AI available
      if (useOffline(intent, 0.6)) { yield* runOffline(intent, 'This is the closest question I can answer without the AI.'); return; }
      await log(text, null, false, Date.now() - t0, 'none', llm ? 'offline' : 'no_key');
      if (!llm) yield { type: 'error', code: 'no_key', message: 'I can answer the common questions offline. Add a free Groq key in Settings to ask anything.', suggestions: closestExamples(text, 3) };
      else yield { type: 'error', code: 'offline', message: "You're offline, so I can only answer the common questions.", suggestions: closestExamples(text, 3) };
    } catch (e) {
      const err = e as Error;
      const heavy = err.name === 'QueryTimeoutError';
      await log(text, null, false, Date.now() - t0, 'error', err.message?.slice(0, 300));
      yield { type: 'error', code: heavy ? 'too_heavy' : 'unknown', message: heavy ? 'That question is too heavy to compute. Try narrowing the period.' : `Something went wrong: ${err.message}`, suggestions: closestExamples(text, 3) };
    }
  }

  return { ask: run };
}

/** Compact description of an answer for the next turn's conversation context. */
export function toTurn(a: AskAnswer): Turn {
  return { question: a.question, sql: a.sql ?? undefined, resultShape: shape(a.columns, a.rows), answer: a.text };
}
