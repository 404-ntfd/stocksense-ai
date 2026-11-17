// Builds the plan request (system prompt + grounded user message) and parses the model's JSON plan.
import planTemplate from './prompts/plan.md?raw';
import { VIEW_DOCS } from '../db/semantic';
import type { SchemaDoc, Turn } from '../types';
import type { LlmMessage } from './types';
import { datesLine, dateTokens, fillTokens } from './dateTokens';
import type { GoldenItem } from './fewshot';

export const PLAN_PROMPT_VERSION = '1.2';
export const MAX_QUESTION_CHARS = 2000;

/** Compact, static schema text: one line per view with every column described. */
export function staticSchemaText(): string {
  return VIEW_DOCS.map((v) => `${v.name} -- ${v.grain}. ${v.description}\n  ${v.columns.map((c) => `${c.name} ${c.type}: ${c.description}`).join('; ')}`).join('\n');
}

export function systemPrompt(): string {
  return planTemplate.replace('{{SCHEMA}}', staticSchemaText());
}

export interface PlanInput {
  question: string;
  today: string;
  businessName?: string | null;
  schema: SchemaDoc;
  examples: GoldenItem[];
  history: Turn[];
  /** Exact product names that look relevant to the question (fuzzy matched locally). */
  productHints?: string[];
  /** When false (privacy toggle), no values from the database are included. */
  includeSamples?: boolean;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

/** Everything that comes from the user's data goes into the user message inside <data> tags, never into the system prompt. */
export function buildPlanMessages(inp: PlanInput): LlmMessage[] {
  const t = dateTokens(inp.today);
  const lines: string[] = [];
  lines.push(`Dates (IST): ${datesLine(t)}.`);
  const data: string[] = [];
  if (inp.businessName) data.push(`business name: ${clip(inp.businessName, 60)}`);
  if (inp.includeSamples !== false) {
    const seen = new Set<string>();
    for (const table of inp.schema.tables) {
      if (table.isCustom) continue;
      for (const c of table.columns) {
        if (!c.samples?.length || seen.has(c.name)) continue;
        if (c.name === 'supplier_name' || c.name === 'payment_mode' || c.name === 'unit') continue; // rarely needed, saves tokens
        seen.add(c.name);
        const label = table.name === 'v_expenses' && c.name === 'category' ? 'expense category' : c.name === 'category' ? 'product category' : c.name;
        data.push(`${label} values: ${c.samples.slice(0, 15).map((s) => clip(s, 40)).join(' | ')}`);
      }
      if (table.name === 'v_expenses') seen.delete('category');
    }
    if (inp.productHints?.length) data.push(`product names that may be meant: ${inp.productHints.slice(0, 8).map((s) => `"${clip(s, 40)}"`).join(', ')}`);
  }
  for (const table of inp.schema.tables.filter((x) => x.isCustom).slice(0, 6)) {
    data.push(`custom table ${table.name} (${clip(table.description, 80)}; ${table.rowCount ?? 0} rows): ` +
      table.columns.slice(0, 30).map((c) => `${c.name} ${c.type} "${clip(c.description, 50)}"${inp.includeSamples !== false && c.samples?.length ? ` e.g. ${c.samples.slice(0, 5).map((s) => clip(s, 30)).join(' | ')}` : ''}`).join('; '));
  }
  if (data.length) lines.push(`<data>\n${data.join('\n')}\n</data>`);
  if (inp.examples.length) {
    lines.push('Examples:');
    for (const ex of inp.examples) {
      lines.push(`Q: ${ex.q}`);
      lines.push(ex.tool ? `A: {"intent":"tool","tool":${JSON.stringify({ name: ex.tool.name, args: ex.tool.args ?? {} })}}` : `A: ${fillTokens(ex.sql ?? '', t)}`);
    }
  }
  const turns = inp.history.slice(-3);
  if (turns.length) {
    lines.push('Conversation so far (use it to resolve follow-ups such as "and last month?"):');
    for (const h of turns) lines.push(`User: ${clip(h.question, 200)}${h.sql ? `\nSQL used: ${clip(h.sql, 400)}` : ''}${h.resultShape ? `\nResult: ${h.resultShape}` : ''}`);
  }
  lines.push(`Question: ${clip(inp.question, MAX_QUESTION_CHARS)}`);
  return [{ role: 'system', content: systemPrompt() }, { role: 'user', content: lines.join('\n') }];
}

export function buildRepairMessages(base: LlmMessage[], badSql: string, error: string): LlmMessage[] {
  return [...base,
    { role: 'assistant', content: JSON.stringify({ intent: 'sql', sql: badSql }) },
    { role: 'user', content: `That query failed with: ${clip(error, 300)}\nFix it. Use only the listed views and columns. Reply with the same JSON object.` }];
}

export interface Plan {
  intent: 'sql' | 'tool' | 'clarify' | 'unsupported';
  sql?: string;
  tool?: { name: 'forecast' | 'reorder' | 'abc'; args: Record<string, unknown> };
  chart?: { type?: string; x?: string | null; y?: string[] | null };
  title?: string;
  assumptions: string[];
  clarify?: string | null;
  options: string[];
}

/** Pulls the first balanced {...} out of text that may have code fences or prose around it. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json|sql)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* look for an object inside */ }
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

export function parsePlan(text: string): Plan | null {
  let j = extractJson(text) as Record<string, unknown> | null;
  if (!j || typeof j !== 'object') {
    // some models answer with bare SQL
    const m = /\b(select|with)\b[\s\S]+/i.exec(text.replace(/```(?:sql)?/gi, ''));
    if (!m) return null;
    j = { intent: 'sql', sql: m[0].trim() };
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  let intent = str(j.intent)?.toLowerCase() as Plan['intent'] | undefined;
  const sql = str(j.sql);
  const toolRaw = j.tool as { name?: unknown; args?: unknown } | string | undefined;
  const toolName = (typeof toolRaw === 'string' ? toolRaw : str(toolRaw?.name))?.toLowerCase();
  if (!intent || !['sql', 'tool', 'clarify', 'unsupported'].includes(intent)) intent = sql ? 'sql' : toolName ? 'tool' : str(j.clarify) ? 'clarify' : undefined;
  if (!intent) return null;
  if (intent === 'sql' && !sql) return null;
  const plan: Plan = {
    intent, sql,
    assumptions: Array.isArray(j.assumptions) ? j.assumptions.filter((a): a is string => typeof a === 'string').slice(0, 5).map((a) => a.slice(0, 200)) : [],
    options: Array.isArray(j.options) ? j.options.filter((a): a is string => typeof a === 'string').slice(0, 4).map((a) => a.slice(0, 80)) : [],
    clarify: str(j.clarify)?.slice(0, 300) ?? null,
    title: str(j.title)?.slice(0, 120),
  };
  if (intent === 'tool') {
    if (!toolName || !['forecast', 'reorder', 'abc'].includes(toolName)) return null;
    const args = typeof toolRaw === 'object' && toolRaw && typeof toolRaw.args === 'object' && toolRaw.args ? (toolRaw.args as Record<string, unknown>) : {};
    plan.tool = { name: toolName as 'forecast' | 'reorder' | 'abc', args };
  }
  if (j.chart && typeof j.chart === 'object') {
    const c = j.chart as Record<string, unknown>;
    plan.chart = { type: str(c.type), x: str(c.x) ?? null, y: Array.isArray(c.y) ? c.y.filter((v): v is string => typeof v === 'string') : null };
  }
  return plan;
}
