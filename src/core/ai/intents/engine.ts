// Offline intent engine: answers the most common shop questions with no network, no key and no model.
// Each intent maps a phrase pattern (plus period / product / number slots) to SQL over the same views the
// AI uses, or to a deterministic tool. Matching takes well under a millisecond per question.
import type { Row } from '../../types';
import { formatDate } from '../../util/dates';
import { formatINR, formatPct, formatQty, spokenINR } from '../../util/money';
import { matchProducts, normName, type NameCandidate } from '../../util/fuzzy';
import { parseComparison, parsePeriod, type ParsedPeriod } from './periods';

export interface IntentContext { today: string; products: NameCandidate[] }
export interface ChartHint { type: 'auto' | 'kpi' | 'line' | 'bar' | 'hbar' | 'donut' | 'table' | 'forecast'; x?: string; y?: string[] }
export interface IntentMatch {
  id: string;
  confidence: number;
  title: string;
  sql?: string;
  tool?: { name: 'forecast' | 'reorder' | 'abc'; args: Record<string, unknown> };
  chart: ChartHint;
  assumptions: string[];
  say: (rows: Row[]) => string;
  followups: string[];
  didYouMean?: string;
}

const STOP = new Set(('a an the is are was were be been do does did i me my we our us you your it its of for to in on at by with from and or as that this these those what which who how much many when where why show tell give get list display ' +
  'can could would should will shall please pls kindly have has had there here now currently right up so far then than about any all some each per into over out also just only total overall business shop store item items product products goods thing things ' +
  'rupees rs inr amount number count value figures figure numbers data report details detail info information me whats what\'s hows how\'s made make making got doing').split(' '));

const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const between = (col: string, p: { from: string; to: string }): string => `${col} BETWEEN '${p.from}' AND '${p.to}'`;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const plural = (n: number, one: string, many = one + 's'): string => `${formatQty(n)} ${n === 1 ? one : many}`;

function wordNumber(t: string): number | null {
  const m = /\b(\d{1,3})\b/.exec(t);
  if (m) return Number(m[1]);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  return null;
}

type Slot = { kind: 'one'; product: NameCandidate; score: number } | { kind: 'family'; term: string; names: string[] } | null;

/** Resolves a spoken product phrase to one product, or to a family ("sugar" -> Sugar 1kg, Sugar 5kg ...). */
export function resolveProduct(phrase: string, products: NameCandidate[]): Slot {
  const term = normName(phrase.replace(/\b(my|the|our|any|some|stock|of|left|remaining|available|packets?|pkts?|pieces?|units?|bottles?|bags?)\b/g, ' '));
  if (!term) return null;
  const exact = products.find((p) => normName(p.name) === term || p.sku.toLowerCase() === term.replace(/ /g, '-') || p.sku.toLowerCase() === term);
  if (exact) return { kind: 'one', product: exact, score: 1 };
  const tokens = term.split(' ');
  const family = products.filter((p) => { const n = ` ${normName(p.name)} `; return tokens.every((tk) => n.includes(` ${tk} `) || n.includes(` ${tk}s `) || (tk.endsWith('s') && n.includes(` ${tk.slice(0, -1)} `))); });
  if (family.length === 1) return { kind: 'one', product: family[0], score: 0.97 };
  if (family.length > 1) return { kind: 'family', term: tokens.map((tk) => (tk.endsWith('s') && tk.length > 3 ? tk.slice(0, -1) : tk)).join(' '), names: family.map((f) => f.name) };
  const best = matchProducts(term, products, 2);
  if (best.length && best[0].score >= 0.8) return { kind: 'one', product: best[0].item, score: best[0].score };
  return null;
}

const productFilter = (slot: NonNullable<Slot>, col: string): string =>
  slot.kind === 'one' ? `${col} = ${q(slot.product.name)}` : slot.term.split(' ').map((tk) => `${col} LIKE ${q('%' + tk + '%')}`).join(' AND ');
const productLabel = (slot: NonNullable<Slot>): string => (slot.kind === 'one' ? slot.product.name : `"${slot.term}" products`);

interface Built { match: Omit<IntentMatch, 'confidence'>; used: string[]; base?: number }
type Rule = { id: string; re: RegExp; build: (m: RegExpExecArray, t: string, ctx: IntentContext, period: ParsedPeriod | null) => Built | null };

const PRODUCT_COLS = 'name, category, stock_on_hand, unit, reorder_level, stock_status';
const defaultPeriod = (ctx: IntentContext, phrase: string): ParsedPeriod => parsePeriod(phrase, ctx.today)!;

function metricOf(t: string): { col: string; label: string; word: string } {
  if (/\b(units?|quantity|qty|volume|pieces|numbers? sold)\b/.test(t)) return { col: 'units', label: 'units sold', word: 'units' };
  if (/\b(profit|profitable|margin|earning)\b/.test(t)) return { col: 'gross_profit', label: 'gross profit', word: 'profit' };
  return { col: 'revenue', label: 'revenue', word: 'revenue' };
}

const RULES: Rule[] = [
  { id: 'compare_periods', re: /\b(compare|comparison|versus|vs\.?|compared (?:to|with))\b/, build: (_m, t, ctx) => {
    const c = parseComparison(t, ctx.today);
    if (!c) return null;
    const expenses = /\b(expense|expenses|spend|spending|spent)\b/.test(t);
    const profit = /\bprofit\b/.test(t);
    const metric = expenses ? 'expenses' : profit ? 'gross_profit' : 'revenue';
    const label = expenses ? 'Expenses' : profit ? 'Gross profit' : 'Sales';
    const side = (p: ParsedPeriod): string => `SELECT ${q(p.label)} AS period, ROUND(COALESCE(SUM(${metric}), 0), 2) AS ${metric} FROM v_daily_summary WHERE ${between('day', p)}`;
    return {
      used: ['compare', 'comparison', 'versus', 'vs', 'compared', 'sales', 'sale', 'revenue', 'profit', 'expenses', 'expense', 'spend', 'spending', 'spent', 'gross'],
      match: {
        id: 'compare_periods', title: `${label}: ${c.a.label} vs ${c.b.label}`, sql: `${side(c.a)} UNION ALL ${side(c.b)}`, chart: { type: 'bar', x: 'period', y: [metric] },
        assumptions: [`${c.a.label}: ${formatDate(c.a.from)} to ${formatDate(c.a.to)}`, `${c.b.label}: ${formatDate(c.b.from)} to ${formatDate(c.b.to)}`],
        say: (rows) => {
          const a = num(rows[0]?.[metric]), b = num(rows[1]?.[metric]);
          if (!a && !b) return `There is no data for ${c.a.label} or ${c.b.label}.`;
          const diff = b ? ((a - b) / Math.abs(b)) * 100 : null;
          return `${label} were ${formatINR(a)} for ${c.a.label} against ${formatINR(b)} for ${c.b.label}${diff == null ? '' : `, ${diff >= 0 ? 'up' : 'down'} ${formatPct(Math.abs(diff))}`}.`;
        },
        followups: ['Top 5 products this month', 'Sales by category this month'],
      },
    };
  } },
  { id: 'stockout_forecast', re: /\b(?:when (?:will|does|do|would) (?:the |my |our )?(.+?) (?:run out|finish|get over|be over|end|go out of stock|stock ?out)|how (?:long|many days) (?:will|does|do|would) (?:the |my |our )?(.+?) (?:last|stock last)|days? of cover (?:for|of) (.+))/, build: (m, _t, ctx) => {
    const slot = resolveProduct(m[1] ?? m[2] ?? m[3] ?? '', ctx.products);
    if (!slot) return null;
    return { used: ['when', 'run', 'out', 'finish', 'last', 'long', 'days', 'day', 'cover', 'stock', 'stockout', 'over', 'end', 'go', 'get'], match: {
      id: 'stockout_forecast', title: `When will ${productLabel(slot)} run out?`, tool: { name: 'forecast', args: slot.kind === 'one' ? { sku: slot.product.sku } : { term: slot.term } },
      chart: { type: slot.kind === 'one' ? 'forecast' : 'table' }, assumptions: ['Estimate based on your past sales'], say: () => '', followups: ['What should I reorder?', 'Show low stock items'],
      didYouMean: slot.kind === 'one' && slot.score < 0.96 ? slot.product.name : undefined,
    } };
  } },
  { id: 'forecast_product', re: /\b(?:forecast|predict|prediction|projection|expected (?:sales|demand)|demand)\b(?: (?:for|of))? ?(.*)$/, build: (m, t, ctx) => {
    const phrase = (m[1] || t).replace(/\b(next|coming|upcoming)\b.*$/, '').replace(/\b(sales|demand|forecast|for|of|the)\b/g, ' ');
    const slot = resolveProduct(phrase, ctx.products);
    if (!slot) return null;
    return { used: ['forecast', 'predict', 'prediction', 'projection', 'expected', 'demand', 'sales', 'next', 'coming', 'upcoming', 'week', 'month', 'days', 'day', 'weeks', '7', '30'], match: {
      id: 'forecast_product', title: `Demand forecast: ${productLabel(slot)}`, tool: { name: 'forecast', args: slot.kind === 'one' ? { sku: slot.product.sku } : { term: slot.term } },
      chart: { type: slot.kind === 'one' ? 'forecast' : 'table' }, assumptions: ['Estimate based on your past sales'], say: () => '', followups: ['What should I reorder?', `Stock of ${slot.kind === 'one' ? slot.product.name : slot.term}`],
      didYouMean: slot.kind === 'one' && slot.score < 0.96 ? slot.product.name : undefined,
    } };
  } },
  { id: 'reorder', re: /\b(re-?order|what (?:should|do|must) (?:i|we) (?:order|buy|purchase|restock)|purchase list|order list|what to (?:order|buy|restock)|restock|need to (?:order|buy))\b/, build: () => ({
    used: ['reorder', 're-order', 'order', 'buy', 'purchase', 'restock', 'list', 'suggestions', 'suggestion', 'suggest', 'need', 'should', 'must', 'week', 'soon', 'today'],
    match: { id: 'reorder', title: 'What to reorder now', tool: { name: 'reorder', args: {} }, chart: { type: 'table' }, assumptions: ['Estimate based on your past sales, supplier lead time and a 14-day review period'], say: () => '', followups: ['Show low stock items', 'Show dead stock'] },
  }) },
  { id: 'abc', re: /\b(abc (?:analysis|class|classification)|pareto|which (?:few )?(?:items|products) matter most|80 ?\/? ?20)\b/, build: () => ({
    used: ['abc', 'analysis', 'class', 'classification', 'pareto', 'matter', 'most', 'few', '80', '20'],
    match: { id: 'abc', title: 'ABC analysis (last 90 days)', tool: { name: 'abc', args: {} }, chart: { type: 'table' }, assumptions: ['A = first 80% of revenue, B = next 15%, C = the rest'], say: () => '', followups: ['Show dead stock', 'Top 10 products last 90 days'] },
  }) },
  { id: 'out_of_stock', re: /\b(out of stock|stock ?outs?|zero stock|no stock|nil stock|sold out|finished items|what is finished|which (?:items|products) (?:are|have) (?:finished|over))\b/, build: (_m, t) => (/\blow\b|running (?:low|short)/.test(t) ? null : {
    used: ['out', 'stock', 'stockout', 'stockouts', 'zero', 'no', 'nil', 'sold', 'finished', 'over'],
    match: {
      id: 'out_of_stock', title: 'Out of stock', sql: `SELECT ${PRODUCT_COLS} FROM v_products WHERE stock_status = 'out' ORDER BY name LIMIT 200`, chart: { type: 'table' }, assumptions: [],
      say: (rows) => (rows.length ? `${plural(rows.length, 'product is', 'products are')} out of stock: ${rows.slice(0, 3).map((r) => r.name).join(', ')}${rows.length > 3 ? ' and more' : ''}.` : 'Nothing is out of stock right now.'),
      followups: ['What should I reorder?', 'Show low stock items'],
    },
  }) },
  { id: 'low_stock', re: /\b(low (?:on )?stock|running (?:low|out|short)|short(?:age)? of stock|low items|below reorder|need(?:s)? restocking|about to finish|getting over)\b/, build: () => ({
    used: ['low', 'stock', 'running', 'short', 'shortage', 'below', 'reorder', 'restocking', 'needs', 'need', 'finish', 'getting', 'over', 'level', 'out'],
    match: {
      id: 'low_stock', title: 'Low stock items', sql: `SELECT ${PRODUCT_COLS} FROM v_products WHERE stock_status IN ('low', 'out') ORDER BY stock_on_hand * 1.0 / MAX(reorder_level, 1), name LIMIT 200`, chart: { type: 'table' }, assumptions: ['Low = stock at or below the reorder level'],
      say: (rows) => {
        if (!rows.length) return 'No products are running low right now.';
        const out = rows.filter((r) => r.stock_status === 'out').length;
        return `${plural(rows.length, 'product is', 'products are')} at or below the reorder level${out ? `, including ${out} out of stock` : ''}. Most urgent: ${rows.slice(0, 3).map((r) => `${r.name} (${formatQty(num(r.stock_on_hand))} left)`).join(', ')}.`;
      },
      followups: ['What should I reorder?', 'Show out of stock items'],
    },
  }) },
  { id: 'dead_stock', re: /\b(dead stock|not moving|non[- ]moving|not selling|unsold|stuck stock|slow[- ]moving|slow movers|stagnant)\b/, build: (m) => {
    const slow = /slow/.test(m[1]);
    const days = slow ? 30 : 90;
    return { used: ['dead', 'stock', 'not', 'moving', 'non', 'selling', 'unsold', 'stuck', 'slow', 'movers', 'stagnant', 'non-moving', 'slow-moving'], match: {
      id: 'dead_stock', title: slow ? 'Slow-moving stock (30+ days without a sale)' : 'Dead stock (90+ days without a sale)',
      sql: `SELECT name, category, stock_on_hand, stock_value_at_cost, last_sale_date, days_since_last_sale FROM v_products WHERE stock_on_hand > 0 AND days_since_last_sale >= ${days} ORDER BY stock_value_at_cost DESC LIMIT 200`,
      chart: { type: 'table' }, assumptions: [`${slow ? 'Slow moving' : 'Dead stock'} = in stock but not sold for ${days} days or more`],
      say: (rows) => (rows.length ? `${plural(rows.length, 'product has', 'products have')} not sold for ${days}+ days, holding ${formatINR(rows.reduce((s, r) => s + num(r.stock_value_at_cost), 0))} of stock at cost. Largest: ${rows[0].name}.` : `Nothing has gone ${days} days without a sale.`),
      followups: ['ABC analysis', 'Inventory value'],
    } };
  } },
  { id: 'inventory_value', re: /\b(inventory value|stock value|value of (?:my |the |our )?(?:stock|inventory)|worth of stock|how much (?:stock|inventory) (?:do i|do we|is there)|total (?:stock|inventory))\b/, build: () => ({
    used: ['inventory', 'stock', 'value', 'worth', 'cost', 'hand', 'holding'],
    match: {
      id: 'inventory_value', title: 'Inventory value at cost', sql: `SELECT ROUND(SUM(stock_value_at_cost), 2) AS inventory_value, COUNT(*) AS products, ROUND(SUM(stock_on_hand), 3) AS units_in_stock FROM v_products WHERE stock_on_hand > 0`, chart: { type: 'kpi' }, assumptions: ['Valued at cost price'],
      say: (rows) => `Your stock is worth ${spokenINR(num(rows[0]?.inventory_value))} at cost, across ${plural(num(rows[0]?.products), 'product')}.`,
      followups: ['Show dead stock', 'Stock value by category'],
    },
  }) },
  { id: 'margin_by_category', re: /\b(margins?|profitability|profit) (?:by|per|for each|across|of each) categor(?:y|ies)|category[- ]wise (?:margin|profit)|which categor(?:y|ies) (?:is|are|has|have|gives?|makes?) (?:the )?(?:most|more|best|highest) (?:profit|margin|profitable)/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'last 30 days');
    return { used: ['margin', 'margins', 'profitability', 'profit', 'profitable', 'category', 'categories', 'wise', 'category-wise', 'most', 'more', 'best', 'highest', 'gives', 'makes', 'gross', 'each', 'across'], match: {
      id: 'margin_by_category', title: `Margin by category, ${p.label}`,
      sql: `SELECT category, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(gross_profit), 2) AS gross_profit, ROUND(100.0 * SUM(gross_profit) / NULLIF(SUM(revenue), 0), 2) AS margin_pct FROM v_sales WHERE ${between('sale_date', p)} GROUP BY category ORDER BY margin_pct DESC`,
      chart: { type: 'hbar', x: 'category', y: ['margin_pct'] }, assumptions: period ? [] : ['No period given, so I used the last 30 days'],
      say: (rows) => (rows.length ? `${rows[0].category} has the best margin at ${formatPct(num(rows[0].margin_pct))}; ${rows[rows.length - 1].category} the lowest at ${formatPct(num(rows[rows.length - 1].margin_pct))}.` : `There are no sales for ${p.label}.`),
      followups: ['Sales by category this month', 'Top 5 products by profit last month'],
    } };
  } },
  { id: 'expenses_by_category', re: /\b(expenses?|spend(?:ing)?|costs?) (?:by|per|across|for each) (?:category|type|head)|where (?:does|is|did) (?:the |my |our )?money go|(?:category|head)[- ]wise expenses?|expense break ?(?:up|down)|break ?(?:up|down) of (?:my |the |our )?expenses/, build: (_m, _t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    return { used: ['expenses', 'expense', 'spend', 'spending', 'costs', 'cost', 'category', 'type', 'head', 'money', 'go', 'wise', 'breakup', 'breakdown', 'break', 'down', 'up', 'does', 'goes'], match: {
      id: 'expenses_by_category', title: `Expenses by category, ${p.label}`, sql: `SELECT category, ROUND(SUM(amount), 2) AS amount FROM v_expenses WHERE ${between('expense_date', p)} GROUP BY category ORDER BY amount DESC`,
      chart: { type: 'donut', x: 'category', y: ['amount'] }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (rows.length ? `You spent ${formatINR(rows.reduce((s, r) => s + num(r.amount), 0))} in ${p.label}. The biggest head is ${rows[0].category} at ${formatINR(num(rows[0].amount))}.` : `No expenses are recorded for ${p.label}.`),
      followups: ['Net profit this month', 'Compare expenses this month vs last month'],
    } };
  } },
  { id: 'expenses_total', re: /\b(expenses?|how much (?:did|have) (?:i|we) (?:spend|spent)|total spend(?:ing)?|running costs?|overheads?|spent on)\b/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    const cat = /\b(?:on|for) (rent|salary|salaries|electricity|transport|packaging|maintenance|phone|internet)\b/.exec(t);
    const catSql = cat ? ` AND category LIKE ${q('%' + cat[1].replace(/ies$/, 'y').replace(/s$/, '') + '%')}` : '';
    return { used: ['expenses', 'expense', 'spend', 'spent', 'spending', 'running', 'costs', 'cost', 'overheads', 'overhead', 'on', cat?.[1] ?? ''], match: {
      id: 'expenses_total', title: `Expenses${cat ? ` on ${cat[1]}` : ''}, ${p.label}`, sql: `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS total_expenses, COUNT(*) AS entries FROM v_expenses WHERE ${between('expense_date', p)}${catSql}`,
      chart: { type: 'kpi' }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (num(rows[0]?.entries) ? `Expenses${cat ? ` on ${cat[1]}` : ''} for ${p.label} were ${formatINR(num(rows[0].total_expenses))} across ${plural(num(rows[0].entries), 'entry', 'entries')}.` : `No expenses are recorded for ${p.label}.`),
      followups: ['Expenses by category this month', 'Net profit this month'],
    } };
  } },
  { id: 'top_customers', re: /\b(top|best|biggest|largest|main|regular) (?:\w+ )?customers?\b|\bwho (?:buys|bought|purchases|purchased) (?:the )?most\b/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'last 90 days');
    const n = Math.min(50, wordNumber(t.replace(p.matched, ' ')) ?? 5);
    return { used: ['top', 'best', 'biggest', 'largest', 'main', 'regular', 'customers', 'customer', 'who', 'buys', 'bought', 'purchases', 'purchased', 'most', 'revenue', 'sales', String(n)], match: {
      id: 'top_customers', title: `Top ${n} customers, ${p.label}`,
      sql: `SELECT customer_name, ROUND(SUM(revenue), 2) AS revenue, COUNT(DISTINCT invoice_no) AS orders FROM v_sales WHERE customer_name IS NOT NULL AND ${between('sale_date', p)} GROUP BY customer_name ORDER BY revenue DESC LIMIT ${n}`,
      chart: { type: 'hbar', x: 'customer_name', y: ['revenue'] }, assumptions: [period ? '' : 'No period given, so I used the last 90 days', 'Walk-in sales without a customer name are left out'].filter(Boolean),
      say: (rows) => (rows.length ? `${rows[0].customer_name} is your top named customer for ${p.label} with ${formatINR(num(rows[0].revenue))} over ${plural(num(rows[0].orders), 'order')}.` : `No named customers bought anything in ${p.label}.`),
      followups: ['Top 5 products this month', 'Total sales this month'],
    } };
  } },
  { id: 'busiest_day', re: /\b(busiest|best|peak|slowest|worst|quietest) (?:day|days|weekday)\b|\bwhich (?:day|weekday)s? (?:of the week )?(?:is|are|sells?|has|have|do i sell|do we sell)\b|\b(?:day|weekday)[- ]wise sales\b|\bsales by (?:day of (?:the )?week|weekday)\b/, build: (_m, _t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'last 90 days');
    return { used: ['busiest', 'best', 'peak', 'slowest', 'worst', 'quietest', 'day', 'days', 'weekday', 'week', 'sells', 'sell', 'sales', 'most', 'wise', 'highest', 'more', 'busy'], match: {
      id: 'busiest_day', title: `Sales by weekday, ${p.label}`,
      sql: `SELECT weekday, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(revenue) / COUNT(DISTINCT sale_date), 2) AS avg_per_day FROM v_sales WHERE ${between('sale_date', p)} GROUP BY weekday ORDER BY avg_per_day DESC`,
      chart: { type: 'bar', x: 'weekday', y: ['avg_per_day'] }, assumptions: period ? [] : ['No period given, so I used the last 90 days'],
      say: (rows) => (rows.length ? `${rows[0].weekday} is your busiest day, averaging ${formatINR(num(rows[0].avg_per_day))}; ${rows[rows.length - 1].weekday} is the quietest at ${formatINR(num(rows[rows.length - 1].avg_per_day))}.` : `There are no sales for ${p.label}.`),
      followups: ['Sales trend last 30 days', 'Top 5 products this month'],
    } };
  } },
  { id: 'sales_by_category', re: /\b(?:sales?|revenue|turnover)\b.*\b(?:by|per|across|for each) categor(?:y|ies)|category[- ]wise (?:sales?|revenue)|(?:top|best|which) (?:\w+ )?categor(?:y|ies)|where does (?:the |my |our )?revenue come from/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    return { used: ['sales', 'sale', 'revenue', 'turnover', 'category', 'categories', 'wise', 'category-wise', 'top', 'best', 'come', 'comes', 'selling', 'sells', 'most', 'each', 'across'], match: {
      id: 'sales_by_category', title: `Sales by category, ${p.label}`, sql: `SELECT category, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(gross_profit), 2) AS gross_profit FROM v_sales WHERE ${between('sale_date', p)} GROUP BY category ORDER BY revenue DESC`,
      chart: { type: 'auto', x: 'category', y: ['revenue'] }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (rows.length ? `${rows[0].category} leads with ${formatINR(num(rows[0].revenue))} of ${formatINR(rows.reduce((s, r) => s + num(r.revenue), 0))} total for ${p.label}.` : `There are no sales for ${p.label}.`),
      followups: ['Margin by category', 'Top 5 products this month'],
    } };
  } },
  { id: 'top_products', re: /\b(top|best|highest|most|fastest)[- ]?(?:selling|sellers?|sold|moving|profitable)?\b.*\b(products?|items?|sellers?|sku|skus)\b|\bbest[- ]?sell(?:ers?|ing)\b|\bwhat sells (?:the )?(?:most|best)\b/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'last 30 days');
    const n = Math.min(50, wordNumber(t.replace(p.matched, ' ')) ?? 5);
    const metric = metricOf(t);
    return { used: ['top', 'best', 'highest', 'most', 'fastest', 'selling', 'seller', 'sellers', 'sold', 'moving', 'profitable', 'sku', 'skus', 'sells', 'sell', 'by', 'revenue', 'sales', 'units', 'unit', 'quantity', 'qty', 'profit', 'margin', 'volume', 'best-selling', 'bestselling', 'bestsellers', 'best-sellers', String(n), 'five', 'ten', 'three'], match: {
      id: 'top_products', title: `Top ${n} products by ${metric.label}, ${p.label}`,
      sql: `SELECT product_name, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(qty), 3) AS units, ROUND(SUM(gross_profit), 2) AS gross_profit FROM v_sales WHERE ${between('sale_date', p)} GROUP BY sku, product_name ORDER BY ${metric.col} DESC LIMIT ${n}`,
      chart: { type: 'hbar', x: 'product_name', y: [metric.col] }, assumptions: [period ? '' : 'No period given, so I used the last 30 days', metric.col === 'revenue' ? 'Ranked by revenue' : ''].filter(Boolean),
      say: (rows) => (rows.length ? `Your top product by ${metric.word} for ${p.label} is ${rows[0].product_name} with ${metric.col === 'units' ? plural(num(rows[0].units), 'unit') : formatINR(num(rows[0][metric.col]))}.` : `There are no sales for ${p.label}.`),
      followups: ['Bottom 5 products last 30 days', 'Sales by category this month'],
    } };
  } },
  { id: 'bottom_products', re: /\b(bottom|worst|least|lowest|slowest)[- ]?(?:selling|sellers?|sold|moving|profitable)?\b.*\b(products?|items?|sellers?|sku|skus)\b|\bwhat sells (?:the )?least\b/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'last 30 days');
    const n = Math.min(50, wordNumber(t.replace(p.matched, ' ')) ?? 5);
    const metric = metricOf(t);
    return { used: ['bottom', 'worst', 'least', 'lowest', 'slowest', 'selling', 'seller', 'sellers', 'sold', 'moving', 'profitable', 'sku', 'skus', 'sells', 'by', 'revenue', 'sales', 'units', 'unit', 'quantity', 'qty', 'profit', 'margin', String(n), 'five', 'ten', 'three'], match: {
      id: 'bottom_products', title: `Bottom ${n} products by ${metric.label}, ${p.label}`,
      sql: `SELECT product_name, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(qty), 3) AS units, ROUND(SUM(gross_profit), 2) AS gross_profit FROM v_sales WHERE ${between('sale_date', p)} GROUP BY sku, product_name ORDER BY ${metric.col} ASC LIMIT ${n}`,
      chart: { type: 'hbar', x: 'product_name', y: [metric.col] }, assumptions: [period ? '' : 'No period given, so I used the last 30 days', 'Only products that sold at least once in the period are ranked'].filter(Boolean),
      say: (rows) => (rows.length ? `The weakest seller by ${metric.word} for ${p.label} is ${rows[0].product_name} with ${metric.col === 'units' ? plural(num(rows[0].units), 'unit') : formatINR(num(rows[0][metric.col]))}.` : `There are no sales for ${p.label}.`),
      followups: ['Show dead stock', 'Top 5 products last 30 days'],
    } };
  } },
  { id: 'orders_count', re: /\b(how many|number of|count of|no of|total) (?:\w+ )?(orders?|bills?|invoices?|transactions?|customers? served)\b|\b(average|avg) (?:order|bill|invoice|basket|ticket) (?:value|size|amount)\b|\baov\b/, build: (_m, _t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    return { used: ['how', 'many', 'number', 'count', 'no', 'orders', 'order', 'bills', 'bill', 'invoices', 'invoice', 'transactions', 'transaction', 'average', 'avg', 'basket', 'ticket', 'value', 'size', 'aov', 'customers', 'served'], match: {
      id: 'orders_count', title: `Orders, ${p.label}`, sql: `SELECT COALESCE(SUM(orders), 0) AS orders, ROUND(COALESCE(SUM(revenue), 0), 2) AS revenue, ROUND(SUM(revenue) / NULLIF(SUM(orders), 0), 2) AS avg_order_value FROM v_daily_summary WHERE ${between('day', p)}`,
      chart: { type: 'kpi' }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (num(rows[0]?.orders) ? `You had ${plural(num(rows[0].orders), 'order')} in ${p.label}, averaging ${formatINR(num(rows[0].avg_order_value))} each.` : `There were no orders in ${p.label}.`),
      followups: ['Total sales this month', 'Which day is busiest?'],
    } };
  } },
  { id: 'purchases_total', re: /\b(purchases?|how much (?:did|have) (?:i|we) (?:buy|bought|purchase|purchased)|stock (?:bought|purchased)|bought from suppliers?)\b/, build: (_m, _t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    return { used: ['purchases', 'purchase', 'buy', 'bought', 'purchased', 'stock', 'suppliers', 'supplier', 'from'], match: {
      id: 'purchases_total', title: `Purchases, ${p.label}`, sql: `SELECT ROUND(COALESCE(SUM(cost_total), 0), 2) AS total_purchases, COUNT(DISTINCT bill_no) AS bills, COUNT(DISTINCT supplier_name) AS suppliers FROM v_purchases WHERE ${between('purchase_date', p)}`,
      chart: { type: 'kpi' }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (num(rows[0]?.bills) ? `You bought ${formatINR(num(rows[0].total_purchases))} of stock in ${p.label}, on ${plural(num(rows[0].bills), 'bill')} from ${plural(num(rows[0].suppliers), 'supplier')}.` : `No purchases are recorded for ${p.label}.`),
      followups: ['Total sales this month', 'Inventory value'],
    } };
  } },
  { id: 'sales_trend', re: /\b(trend|daily sales|day[- ]wise sales|sales (?:per|by|each) day|monthly sales|month[- ]wise sales|sales (?:per|by|each) month|are sales (?:going )?(?:up|down)|sales (?:graph|chart))\b/, build: (m, _t, ctx, period) => {
    const monthly = /month/.test(m[1]);
    const p = period ?? defaultPeriod(ctx, monthly ? 'last 12 months' : 'last 30 days');
    const sql = monthly
      ? `SELECT month, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(gross_profit), 2) AS gross_profit FROM v_sales WHERE ${between('sale_date', p)} GROUP BY month ORDER BY month`
      : `SELECT day, revenue, gross_profit FROM v_daily_summary WHERE ${between('day', p)} ORDER BY day`;
    return { used: ['trend', 'daily', 'day', 'wise', 'sales', 'sale', 'per', 'each', 'monthly', 'month', 'going', 'up', 'down', 'graph', 'chart', 'revenue', 'day-wise', 'month-wise'], match: {
      id: 'sales_trend', title: `${monthly ? 'Monthly' : 'Daily'} sales, ${p.label}`, sql, chart: { type: 'line', x: monthly ? 'month' : 'day', y: ['revenue'] }, assumptions: period ? [] : [`No period given, so I used ${p.label}`],
      say: (rows) => {
        if (rows.length < 2) return rows.length ? `Sales were ${formatINR(num(rows[0].revenue))}.` : `There are no sales for ${p.label}.`;
        const half = Math.floor(rows.length / 2);
        const a = rows.slice(0, half).reduce((s, r) => s + num(r.revenue), 0) / half, b = rows.slice(-half).reduce((s, r) => s + num(r.revenue), 0) / half;
        const ch = a ? ((b - a) / a) * 100 : 0;
        return `Sales averaged ${formatINR(rows.reduce((s, r) => s + num(r.revenue), 0) / rows.length)} per ${monthly ? 'month' : 'day'} over ${p.label}; the second half ran ${ch >= 0 ? 'up' : 'down'} ${formatPct(Math.abs(ch))} on the first.`;
      },
      followups: ['Which day is busiest?', 'Compare this month vs last month'],
    } };
  } },
  { id: 'profit_total', re: /\b(profit|profits|margin|earnings?|earned|am i making money|how much (?:did|do|have) (?:i|we) (?:make|made|earn|earned))\b/, build: (_m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    const net = /\bnet\b|after expenses|making money|take home/.test(t);
    return { used: ['profit', 'profits', 'margin', 'earnings', 'earning', 'earned', 'earn', 'gross', 'net', 'making', 'money', 'after', 'expenses', 'take', 'home', 'am', 'make', 'made'], match: net ? {
      id: 'profit_total', title: `Net profit, ${p.label}`, sql: `SELECT ROUND(COALESCE(SUM(net_profit), 0), 2) AS net_profit, ROUND(COALESCE(SUM(gross_profit), 0), 2) AS gross_profit, ROUND(COALESCE(SUM(expenses), 0), 2) AS expenses, ROUND(COALESCE(SUM(revenue), 0), 2) AS revenue FROM v_daily_summary WHERE ${between('day', p)}`,
      chart: { type: 'kpi' }, assumptions: [period ? '' : 'No period given, so I used this month', 'Net profit = gross profit minus recorded expenses'].filter(Boolean),
      say: (rows) => (num(rows[0]?.revenue) || num(rows[0]?.expenses) ? `Net profit for ${p.label} is ${formatINR(num(rows[0].net_profit))}: ${formatINR(num(rows[0].gross_profit))} gross profit less ${formatINR(num(rows[0].expenses))} of expenses.` : `There is no data for ${p.label}.`),
      followups: ['Expenses by category this month', 'Margin by category'],
    } : {
      id: 'profit_total', title: `Gross profit, ${p.label}`, sql: `SELECT ROUND(COALESCE(SUM(gross_profit), 0), 2) AS gross_profit, ROUND(COALESCE(SUM(revenue), 0), 2) AS revenue, ROUND(100.0 * SUM(gross_profit) / NULLIF(SUM(revenue), 0), 2) AS margin_pct FROM v_sales WHERE ${between('sale_date', p)}`,
      chart: { type: 'kpi' }, assumptions: [period ? '' : 'No period given, so I used this month', 'Profit means gross profit (sales minus cost of goods); say "net profit" to subtract expenses'].filter(Boolean),
      say: (rows) => (num(rows[0]?.revenue) ? `Gross profit for ${p.label} is ${formatINR(num(rows[0].gross_profit))} on sales of ${formatINR(num(rows[0].revenue))}, a margin of ${formatPct(num(rows[0].margin_pct))}.` : `There are no sales for ${p.label}.`),
      followups: ['Net profit this month', 'Margin by category'],
    } };
  } },
  { id: 'summary', re: /\b(how (?:are|is) (?:we|the business|business|the shop|the store|things|my shop|my business) (?:doing|going)|how(?:'s| is) business|business (?:summary|overview|health|snapshot)|summary|overview|give me a snapshot|how did (?:we|i) do)\b/, build: (_m, _t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    return { used: ['doing', 'going', 'summary', 'overview', 'health', 'snapshot', 'things', 'do', 'did', 'quick', 'performance'], match: {
      id: 'summary', title: `Business summary, ${p.label}`, sql: `SELECT ROUND(COALESCE(SUM(revenue), 0), 2) AS revenue, ROUND(COALESCE(SUM(gross_profit), 0), 2) AS gross_profit, ROUND(COALESCE(SUM(expenses), 0), 2) AS expenses, ROUND(COALESCE(SUM(net_profit), 0), 2) AS net_profit, COALESCE(SUM(orders), 0) AS orders FROM v_daily_summary WHERE ${between('day', p)}`,
      chart: { type: 'kpi' }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (num(rows[0]?.revenue) || num(rows[0]?.expenses) ? `For ${p.label}: sales ${formatINR(num(rows[0].revenue))} from ${plural(num(rows[0].orders), 'order')}, gross profit ${formatINR(num(rows[0].gross_profit))}, expenses ${formatINR(num(rows[0].expenses))}, net profit ${formatINR(num(rows[0].net_profit))}.` : `There is no data for ${p.label} yet.`),
      followups: ['Compare this month vs last month', 'Show low stock items'],
    } };
  } },
  { id: 'product_price', re: /\b(?:(?:selling |sale |cost |purchase )?(?:price|rate|mrp|cost|margin) (?:of|for|on) (.+)|how much (?:is|does|do) (.+?) (?:cost|sell for)|what does (.+?) cost)/, build: (m, _t, ctx) => {
    const slot = resolveProduct(m[1] ?? m[2] ?? m[3] ?? '', ctx.products);
    if (!slot) return null;
    return { used: ['price', 'rate', 'mrp', 'cost', 'margin', 'selling', 'sale', 'purchase', 'sell', 'costs'], match: {
      id: 'product_price', title: `Price: ${productLabel(slot)}`, sql: `SELECT name, selling_price, cost_price, ROUND(100.0 * (selling_price - cost_price) / NULLIF(selling_price, 0), 2) AS margin_pct, unit FROM v_products WHERE ${productFilter(slot, 'name')} ORDER BY name LIMIT 50`,
      chart: { type: slot.kind === 'one' ? 'kpi' : 'table' }, assumptions: [],
      say: (rows) => (rows.length === 1 ? `${rows[0].name} sells at ${formatINR(num(rows[0].selling_price))} and costs ${formatINR(num(rows[0].cost_price))}${rows[0].margin_pct == null || !num(rows[0].cost_price) ? '' : `, a margin of ${formatPct(num(rows[0].margin_pct))}`}.` : rows.length ? `${rows.length} products match; prices are in the table.` : 'I could not find that product.'),
      followups: [`Stock of ${slot.kind === 'one' ? slot.product.name : slot.term}`, `Sales of ${slot.kind === 'one' ? slot.product.name : slot.term} this month`],
      didYouMean: slot.kind === 'one' && slot.score < 0.96 ? slot.product.name : undefined,
    } };
  } },
  { id: 'product_sales', re: /\b(?:(?:sales?|revenue|units sold) (?:of|for) (.+)|how (?:many|much) (.+?) (?:did (?:i|we) sell|(?:was|were|got|have been) sold|sold)|(.+?) sales)\b/, build: (m, t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(p.matched, ' ').replace(/\b(in|for|during|did|i|we|sell|of)\b/g, ' ');
    const slot = resolveProduct(raw, ctx.products);
    if (!slot) return null;
    return { used: ['sales', 'sale', 'revenue', 'units', 'sold', 'sell', 'how', 'many', 'much', 'did'], match: {
      id: 'product_sales', title: `Sales of ${productLabel(slot)}, ${p.label}`, sql: `SELECT product_name, ROUND(SUM(qty), 3) AS units, ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(gross_profit), 2) AS gross_profit FROM v_sales WHERE ${productFilter(slot, 'product_name')} AND ${between('sale_date', p)} GROUP BY sku, product_name ORDER BY revenue DESC LIMIT 50`,
      chart: { type: slot.kind === 'one' ? 'kpi' : 'hbar', x: 'product_name', y: ['revenue'] }, assumptions: period ? [] : ['No period given, so I used this month'],
      say: (rows) => (rows.length === 1 ? `You sold ${plural(num(rows[0].units), 'unit')} of ${rows[0].product_name} in ${p.label}, worth ${formatINR(num(rows[0].revenue))}.` : rows.length ? `${rows.length} matching products sold ${formatINR(rows.reduce((s, r) => s + num(r.revenue), 0))} in ${p.label}; ${rows[0].product_name} led.` : `No sales of ${productLabel(slot)} in ${p.label}.`),
      followups: [`Stock of ${slot.kind === 'one' ? slot.product.name : slot.term}`, `When will ${slot.kind === 'one' ? slot.product.name : slot.term} run out?`],
      didYouMean: slot.kind === 'one' && slot.score < 0.96 ? slot.product.name : undefined,
    } };
  } },
  { id: 'stock_of_product', re: /\b(?:stock (?:of|for|on) (.+)|how (?:much|many) (.+?) (?:do (?:i|we) have|(?:is|are) (?:left|there|remaining|available|in stock)|left|remaining|in stock)|(.+?) (?:stock|quantity|balance)(?: left| level| position)?|do (?:i|we) have (?:any |enough )?(.+))$/, build: (m, _t, ctx) => {
    const slot = resolveProduct(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '', ctx.products);
    if (!slot) return null;
    return { used: ['stock', 'how', 'much', 'many', 'have', 'left', 'remaining', 'available', 'quantity', 'balance', 'level', 'position', 'enough', 'in', 'on', 'hand'], match: {
      id: 'stock_of_product', title: `Stock: ${productLabel(slot)}`, sql: `SELECT ${PRODUCT_COLS} FROM v_products WHERE ${productFilter(slot, 'name')} ORDER BY name LIMIT 50`,
      chart: { type: slot.kind === 'one' ? 'kpi' : 'table' }, assumptions: [],
      say: (rows) => (rows.length === 1
        ? `You have ${formatQty(num(rows[0].stock_on_hand))} ${rows[0].unit} of ${rows[0].name}${rows[0].stock_status === 'out' ? ' - it is out of stock' : rows[0].stock_status === 'low' ? `, which is below the reorder level of ${formatQty(num(rows[0].reorder_level))}` : ''}.`
        : rows.length ? `${rows.length} products match: ${rows.slice(0, 4).map((r) => `${r.name} ${formatQty(num(r.stock_on_hand))}`).join(', ')}${rows.length > 4 ? '…' : ''}.` : 'I could not find that product.'),
      followups: [`When will ${slot.kind === 'one' ? slot.product.name : slot.term} run out?`, 'Show low stock items'],
      didYouMean: slot.kind === 'one' && slot.score < 0.96 ? slot.product.name : undefined,
    } };
  } },
  { id: 'product_count', re: /\bhow many (?:products|items|skus)\b|\bnumber of (?:products|items|skus)\b/, build: () => ({
    used: ['how', 'many', 'number', 'sku', 'skus', 'sell', 'stock', 'carry', 'keep', 'have'],
    match: { id: 'product_count', title: 'Products', sql: `SELECT COUNT(*) AS products, COUNT(DISTINCT category) AS categories, SUM(stock_on_hand > 0) AS in_stock FROM v_products`, chart: { type: 'kpi' }, assumptions: [],
      say: (rows) => `You have ${plural(num(rows[0]?.products), 'product')} in ${plural(num(rows[0]?.categories), 'category', 'categories')}; ${formatQty(num(rows[0]?.in_stock))} are in stock.`, followups: ['Show low stock items', 'Inventory value'] },
  }) },
  { id: 'sales_total', re: /\b(sales?|revenue|turnover|sold|sell|business done|collection|takings)\b/, build: (_m, _t, ctx, period) => {
    const p = period ?? defaultPeriod(ctx, 'this month');
    return { used: ['sales', 'sale', 'revenue', 'turnover', 'sold', 'sell', 'done', 'collection', 'takings', 'were', 'was', 'did'], match: {
      id: 'sales_total', title: `Total sales, ${p.label}`, sql: `SELECT ROUND(COALESCE(SUM(revenue), 0), 2) AS total_sales, COUNT(DISTINCT invoice_no) AS orders, ROUND(COALESCE(SUM(qty), 0), 3) AS units_sold FROM v_sales WHERE ${between('sale_date', p)}`,
      chart: { type: 'kpi' }, assumptions: [period ? '' : 'No period given, so I used this month', `${p.label}: ${formatDate(p.from)}${p.from === p.to ? '' : ` to ${formatDate(p.to)}`}`].filter(Boolean),
      say: (rows) => (num(rows[0]?.orders) ? `Total sales for ${p.label} were ${spokenINR(num(rows[0].total_sales))} (${formatINR(num(rows[0].total_sales))}) from ${plural(num(rows[0].orders), 'order')}.` : `There were no sales for ${p.label}.`),
      followups: ['Top 5 products this month', 'Compare this month vs last month'],
    } };
  } },
];

export const INTENT_IDS: string[] = RULES.map((r) => r.id);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’`]/g, "'").replace(/[?!,;:"()]/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Returns the best offline match, or null. Confidence 0.9+ means every meaningful word was understood;
 * left-over words (a filter we do not support, an unknown product) pull it below the 0.85 routing threshold
 * so the question goes to the AI when one is available.
 */
export function matchIntent(text: string, ctx: IntentContext): IntentMatch | null {
  const t = normalise(text);
  if (!t || t.length > 300) return null;
  const period = parsePeriod(t, ctx.today);
  for (const rule of RULES) {
    const m = rule.re.exec(t);
    if (!m) continue;
    const built = rule.build(m, t, ctx, period);
    if (!built) continue;
    // which words did nothing explain?
    let rest = ` ${t} `;
    if (period) rest = rest.replace(period.matched, ' ');
    const cmp = /compare/.test(rule.id) ? parseComparison(t, ctx.today) : null;
    if (cmp) rest = rest.replace(cmp.a.matched, ' ').replace(cmp.b.matched, ' ');
    const known = new Set(built.used.filter(Boolean));
    const title = normName(built.match.title + ' ' + (built.match.didYouMean ?? ''));
    const left = rest.replace(/[^a-z0-9' -]/g, ' ').split(/[\s-]+/).filter((w) => w && !STOP.has(w) && !known.has(w) && !/^\d+$/.test(w) && !title.split(' ').includes(w));
    const confidence = left.length === 0 ? 0.93 : left.length === 1 ? 0.8 : 0.6;
    return { ...built.match, confidence };
  }
  return null;
}

/** Example questions the offline engine understands, shown as chips and as "closest supported questions". */
export const OFFLINE_EXAMPLES: string[] = [
  'Total sales this month', 'Top 5 products last month', 'Show low stock items', 'What should I reorder?', 'Profit this month', 'Net profit last month',
  'Sales by category this month', 'Show dead stock', 'Expenses by category', 'Compare this month vs last month', 'Inventory value', 'Which day is busiest?',
  'Sales trend last 30 days', 'Out of stock items', 'Top customers', 'How are we doing?', 'ABC analysis', 'Margin by category',
];

/** The supported questions most like what was asked (word overlap), for the offline fallback message. */
export function closestExamples(text: string, n = 3): string[] {
  const words = new Set(normalise(text).split(' ').filter((w) => !STOP.has(w)));
  return OFFLINE_EXAMPLES.map((ex) => ({ ex, s: normalise(ex).split(' ').filter((w) => words.has(w) || words.has(w + 's') || words.has(w.replace(/s$/, ''))).length }))
    .sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.ex);
}
