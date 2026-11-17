// Write requests by voice or text ("sold 3 Parle-G at 10", "add 20 units of rice").
// Nothing here writes anything: it only builds a confirmation card. The app applies the change with its
// own parameterised statements, and only after the user taps Confirm.
import type { NameCandidate } from '../util/fuzzy';
import { resolveProduct } from '../ai/intents/engine';
import { formatINR, formatQty } from '../util/money';
import { formatDate } from '../util/dates';

export type ActionKind = 'purchase' | 'sale' | 'price' | 'count' | 'damage' | 'expense';
export interface ActionCard {
  kind: ActionKind;
  productId?: number;
  productName?: string;
  qty?: number;
  /** unit price (sale), unit cost (purchase) or new price (price) */
  unitAmount?: number | null;
  amount?: number;
  category?: string;
  party?: string | null;
  date: string;
  summary: string;
  didYouMean?: string;
}
export type ActionParse = { ok: true; card: ActionCard } | { ok: false; reason: string; options?: string[] } | null;

const WRITE_START = /^(?:please |kindly |can you |could you )?(?:add|record|enter|note|sold|sell|sale of|received|receive|bought|buy|purchased|purchase|update|change|set|adjust|correct|make|damaged?|write off|expired|delete|remove|restock(?:ed)?|stock in|got|i sold|we sold|i bought|we bought|i received|we received|i spent|we spent|i paid|we paid|spent|paid)\b/i;
const QUESTION_START = /^(?:how|what|which|when|where|why|who|show|list|is|are|do|does|did|tell|give|compare|top|total)\b/i;
const UNIT = '(?:units?|pcs|pieces?|packets?|pkts?|kg|kgs|g|l|litres?|bottles?|bags?|boxes?|nos|trays?|dozens?)';

export function looksLikeWrite(text: string): boolean {
  const t = text.trim();
  return WRITE_START.test(t) && !QUESTION_START.test(t) && !/\?$/.test(t);
}

const n = (s: string | undefined): number | null => { const v = Number((s ?? '').replace(/[₹,]/g, '')); return s != null && s !== '' && Number.isFinite(v) ? v : null; };

export function describeAction(c: ActionCard): string {
  const on = c.date ? ` on ${formatDate(c.date)}` : '';
  switch (c.kind) {
    case 'purchase': return `Add ${formatQty(c.qty)} of ${c.productName} to stock${c.unitAmount != null ? ` at ${formatINR(c.unitAmount, { decimals: 2 })} each` : ''}${c.party ? ` from ${c.party}` : ''}${on}`;
    case 'sale': return `Record a sale of ${formatQty(c.qty)} × ${c.productName}${c.unitAmount != null ? ` at ${formatINR(c.unitAmount, { decimals: 2 })} each` : ''}${c.party ? ` to ${c.party}` : ''}${on}`;
    case 'price': return `Change the selling price of ${c.productName} to ${formatINR(c.unitAmount ?? 0, { decimals: 2 })}`;
    case 'count': return `Set the stock of ${c.productName} to ${formatQty(c.qty)}${on}`;
    case 'damage': return `Write off ${formatQty(c.qty)} of ${c.productName} as damaged${on}`;
    case 'expense': return `Record an expense of ${formatINR(c.amount ?? 0)} under ${c.category}${on}`;
  }
}

/** Regex-first parse. Returns null when the text is not a write request at all. */
export function parseAction(text: string, ctx: { today: string; products: NameCandidate[] }): ActionParse {
  const raw = text.trim().replace(/[.!]+$/, '');
  if (!looksLikeWrite(raw)) return null;
  const t = raw.toLowerCase().replace(/\s+/g, ' ').replace(/^(?:please |kindly |can you |could you )/, '');
  if (/^(delete|remove)\b/.test(t)) return { ok: false, reason: 'I cannot delete data by voice. Use the Data screen to remove rows, or Inventory to archive a product.' };
  const date = /\byesterday\b/.test(t) ? new Date(Date.UTC(+ctx.today.slice(0, 4), +ctx.today.slice(5, 7) - 1, +ctx.today.slice(8, 10) - 1)).toISOString().slice(0, 10) : ctx.today;
  const body = t.replace(/\b(today|yesterday)\b/g, ' ').replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;

  if ((m = /^(?:add |record |enter |note )?(?:an? )?expense (?:of )?₹?([\d,.]+) (?:for|on|towards|under) (.+)$/.exec(body)) || (m = /^(?:i |we )?(?:spent|paid) ₹?([\d,.]+) (?:on|for|towards) (.+)$/.exec(body))) {
    const amount = n(m[1]);
    if (!amount || amount <= 0) return { ok: false, reason: 'How much was the expense?' };
    const category = m[2].trim().replace(/^(the|my|our) /, '').replace(/\b\w/, (c) => c.toUpperCase()).slice(0, 40);
    const card: ActionCard = { kind: 'expense', amount, category, date, summary: '' };
    return { ok: true, card: { ...card, summary: describeAction(card) } };
  }
  const product = (phrase: string): { id: number; name: string; didYouMean?: string } | ActionParse => {
    const slot = resolveProduct(phrase, ctx.products);
    if (!slot) return { ok: false, reason: `I could not find a product called "${phrase.trim()}". Check the name in Inventory.` };
    if (slot.kind === 'family') return { ok: false, reason: `Which one do you mean?`, options: slot.names.slice(0, 4) };
    return { id: slot.product.id, name: slot.product.name, didYouMean: slot.score < 0.96 ? slot.product.name : undefined };
  };
  const finish = (kind: ActionKind, phrase: string, fields: Partial<ActionCard>): ActionParse => {
    const p = product(phrase);
    if (p && 'ok' in p) return p;
    const pr = p as { id: number; name: string; didYouMean?: string };
    const card: ActionCard = { kind, productId: pr.id, productName: pr.name, date, summary: '', didYouMean: pr.didYouMean, ...fields };
    return { ok: true, card: { ...card, summary: describeAction(card) } };
  };

  if ((m = /^(?:update|change|set|make|correct) (?:the )?(?:selling |sale )?(?:price|rate|mrp) (?:of|for) (.+?) (?:to|as|at) ₹?([\d,.]+)$/.exec(body))) {
    const price = n(m[2]);
    if (price == null || price < 0) return { ok: false, reason: 'What should the new price be?' };
    return finish('price', m[1], { unitAmount: price });
  }
  if ((m = new RegExp(`^(?:set|update|change|correct|adjust|make) (?:the )?(?:stock|quantity|count) (?:of|for) (.+?) (?:to|as|at) ([\\d,.]+)(?: ?${UNIT})?$`).exec(body))) {
    const qty = n(m[2]);
    if (qty == null || qty < 0) return { ok: false, reason: 'What is the counted quantity?' };
    return finish('count', m[1], { qty });
  }
  if ((m = new RegExp(`^(?:damaged?|write off|expired) ([\\d,.]+) ?${UNIT}? ?(?:of )?(.+)$`).exec(body)) || (m = new RegExp(`^(?:record |add |note )?([\\d,.]+) ?${UNIT}? ?(?:of )?(.+?) (?:is |are |got |were |was )?(?:damaged|expired|broken|spoiled|spoilt)$`).exec(body))) {
    const qty = n(m[1]);
    if (!qty || qty <= 0) return { ok: false, reason: 'How many were damaged?' };
    return finish('damage', m[2], { qty });
  }
  if ((m = new RegExp(`^(?:i |we )?(?:sold|sell|sale of|record (?:a )?sale of) ([\\d,.]+) ?${UNIT}? ?(?:of )?(.+?)(?: (?:at|for|@) ₹?([\\d,.]+)(?: each| per \\w+| a piece)?)?(?: to (.+))?$`).exec(body))) {
    const qty = n(m[1]);
    if (!qty || qty <= 0) return { ok: false, reason: 'How many did you sell?' };
    return finish('sale', m[2], { qty, unitAmount: n(m[3]), party: m[4]?.trim().replace(/\b\w/g, (c) => c.toUpperCase()) ?? null });
  }
  if ((m = new RegExp(`^(?:i |we )?(?:add|added|received|receive|bought|buy|purchased|purchase|got|stock in|restock(?:ed)?) ([\\d,.]+) ?(?:more )?${UNIT}? ?(?:of )?(.+?)(?: (?:at|for|@) ₹?([\\d,.]+)(?: each| per \\w+| a piece)?)?(?: from (.+))?$`).exec(body))) {
    const qty = n(m[1]);
    if (!qty || qty <= 0) return { ok: false, reason: 'How many did you receive?' };
    return finish('purchase', m[2].replace(/ (?:to|in|into) (?:the )?(?:stock|inventory)$/, ''), { qty, unitAmount: n(m[3]), party: m[4]?.trim().replace(/\b\w/g, (c) => c.toUpperCase()) ?? null });
  }
  return { ok: false, reason: 'I could not work out that change. Try something like "sold 3 Parle-G at ₹10", "received 20 Sugar 1kg at ₹41" or "set price of Tata Salt 1kg to ₹30".' };
}

/** Prompt for the model when the regexes cannot parse a write request. It only extracts fields; the app still builds the card. */
export const ACTION_SYSTEM = `Extract a stock or sales change from the user's sentence. Reply with JSON only:
{"action":"purchase|sale|price|count|damage|expense|none","product":"name or null","qty":number or null,"unit_amount":number or null,"amount":number or null,"category":"expense category or null","party":"customer or supplier or null"}
purchase = stock received; sale = sold; price = change selling price (unit_amount = new price); count = set stock to qty; damage = write off qty; expense = money spent (amount, category).
Use "none" if the sentence is not a request to change data. Never invent numbers.`;
