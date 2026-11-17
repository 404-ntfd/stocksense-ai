// Column mapping: matches spreadsheet headers to the fields of each import target using a
// synonym dictionary plus fuzzy matching, and suggests which target a file most likely is.
import type { ImportTarget } from '../types';
import { jaroWinkler } from '../util/fuzzy';

export interface FieldDef { key: string; label: string; required?: boolean; kind: 'text' | 'sku' | 'number' | 'money' | 'qty' | 'date' | 'unit'; synonyms: string[]; help?: string }

const SKU: FieldDef = { key: 'sku', label: 'SKU / code', kind: 'sku', synonyms: ['sku', 'code', 'item code', 'product code', 'barcode', 'bar code', 'item no', 'item id', 'product id', 'part no', 'part number', 'article', 'ean', 'upc'] };
const NAME: FieldDef = { key: 'name', label: 'Product name', kind: 'text', synonyms: ['name', 'item', 'item name', 'product', 'product name', 'particulars', 'description', 'item description', 'goods', 'material', 'product description', 'items'] };

export const TARGET_FIELDS: Record<Exclude<ImportTarget, 'custom'>, FieldDef[]> = {
  products: [
    { ...NAME, required: true },
    SKU,
    { key: 'category', label: 'Category', kind: 'text', synonyms: ['category', 'group', 'item group', 'product group', 'department', 'class', 'type', 'item category', 'sub category'] },
    { key: 'unit', label: 'Unit', kind: 'unit', synonyms: ['unit', 'uom', 'units', 'unit of measure', 'measure', 'pack'] },
    { key: 'cost', label: 'Cost price', kind: 'money', synonyms: ['cost', 'cost price', 'purchase rate', 'purchase price', 'cp', 'buy price', 'buying price', 'landing cost', 'landed cost', 'unit cost', 'p rate'] },
    { key: 'price', label: 'Selling price', kind: 'money', synonyms: ['price', 'selling price', 'sale price', 'sales price', 'mrp', 'rate', 'sp', 'sales rate', 'retail price', 'unit price', 's rate'] },
    { key: 'stock', label: 'Stock on hand', kind: 'qty', synonyms: ['stock', 'qty', 'quantity', 'closing stock', 'stock qty', 'on hand', 'balance', 'available', 'current stock', 'closing qty', 'stock in hand', 'opening stock', 'pcs', 'nos', 'bal qty', 'cl stock'] },
    { key: 'reorder_level', label: 'Reorder level', kind: 'qty', synonyms: ['reorder level', 'min stock', 'minimum stock', 'minimum', 'reorder', 'rol', 'min qty', 'reorder point', 'min level', 'alert qty'] },
    { key: 'lead_time_days', label: 'Lead time (days)', kind: 'number', synonyms: ['lead time', 'lead days', 'lead time days', 'delivery days'] },
    { key: 'supplier', label: 'Supplier', kind: 'text', synonyms: ['supplier', 'vendor', 'supplier name', 'vendor name', 'distributor', 'company'] },
  ],
  sales: [
    { key: 'date', label: 'Date', kind: 'date', required: true, synonyms: ['date', 'bill date', 'inv date', 'invoice date', 'sale date', 'sales date', 'txn date', 'voucher date', 'order date', 'transaction date', 'dt'] },
    { key: 'invoice_no', label: 'Invoice no.', kind: 'sku', synonyms: ['invoice', 'invoice no', 'bill no', 'inv no', 'voucher no', 'order no', 'receipt no', 'bill number', 'invoice number', 'order id', 'bill', 'vch no', 'ref no'] },
    SKU,
    NAME,
    { key: 'qty', label: 'Quantity', kind: 'qty', required: true, synonyms: ['qty', 'quantity', 'pcs', 'nos', 'units', 'sold qty', 'sale qty', 'qty sold', 'billed qty', 'no of units'] },
    { key: 'unit_price', label: 'Unit price', kind: 'money', synonyms: ['rate', 'price', 'unit price', 'selling price', 'mrp', 'sp', 'sale rate', 'sales rate', 'sale price', 'unit rate'] },
    { key: 'amount', label: 'Line amount', kind: 'money', synonyms: ['amount', 'total', 'net amount', 'line total', 'value', 'gross amount', 'sale amount', 'taxable value', 'total amount', 'amt', 'net amt', 'sales value'] },
    { key: 'discount', label: 'Discount (₹)', kind: 'money', synonyms: ['discount', 'disc', 'discount amount', 'disc amt', 'less'] },
    { key: 'tax', label: 'Tax (₹)', kind: 'money', synonyms: ['tax', 'gst', 'tax amount', 'gst amount', 'vat', 'gst amt', 'tax amt', 'igst', 'cgst sgst'] },
    { key: 'customer', label: 'Customer', kind: 'text', synonyms: ['customer', 'customer name', 'party', 'party name', 'buyer', 'client', 'sold to', 'cust name', 'billed to'] },
    { key: 'unit_cost', label: 'Unit cost', kind: 'money', synonyms: ['cost', 'cost price', 'purchase rate', 'cp', 'unit cost'] },
  ],
  purchases: [
    { key: 'date', label: 'Date', kind: 'date', required: true, synonyms: ['date', 'bill date', 'purchase date', 'inv date', 'invoice date', 'grn date', 'received date', 'voucher date', 'dt'] },
    { key: 'bill_no', label: 'Bill no.', kind: 'sku', synonyms: ['bill no', 'bill number', 'invoice no', 'invoice', 'grn no', 'purchase no', 'voucher no', 'po no', 'ref no', 'bill'] },
    SKU,
    NAME,
    { key: 'qty', label: 'Quantity', kind: 'qty', required: true, synonyms: ['qty', 'quantity', 'pcs', 'nos', 'units', 'received qty', 'purchase qty', 'qty received', 'recd qty'] },
    { key: 'unit_cost', label: 'Unit cost', kind: 'money', synonyms: ['rate', 'cost', 'purchase rate', 'unit cost', 'price', 'cp', 'cost price', 'purchase price', 'unit price', 'p rate'] },
    { key: 'amount', label: 'Line amount', kind: 'money', synonyms: ['amount', 'total', 'net amount', 'line total', 'value', 'total amount', 'amt', 'purchase value', 'taxable value'] },
    { key: 'tax', label: 'Tax (₹)', kind: 'money', synonyms: ['tax', 'gst', 'tax amount', 'gst amount', 'vat', 'gst amt'] },
    { key: 'supplier', label: 'Supplier', kind: 'text', synonyms: ['supplier', 'vendor', 'supplier name', 'vendor name', 'party', 'party name', 'purchased from', 'distributor'] },
  ],
  expenses: [
    { key: 'date', label: 'Date', kind: 'date', required: true, synonyms: ['date', 'expense date', 'paid on', 'payment date', 'voucher date', 'txn date', 'dt'] },
    { key: 'category', label: 'Category', kind: 'text', required: true, synonyms: ['category', 'expense', 'expense type', 'head', 'account', 'expense head', 'type', 'ledger', 'expense category', 'particulars', 'account head'] },
    { key: 'amount', label: 'Amount', kind: 'money', required: true, synonyms: ['amount', 'value', 'total', 'paid', 'debit', 'amt', 'expense amount', 'payment'] },
    { key: 'note', label: 'Note', kind: 'text', synonyms: ['note', 'notes', 'remarks', 'description', 'narration', 'details', 'memo', 'comment'] },
    { key: 'payment_mode', label: 'Payment mode', kind: 'text', synonyms: ['mode', 'payment mode', 'paid by', 'method', 'payment method', 'pay mode', 'paid via'] },
  ],
  stock_count: [
    SKU,
    NAME,
    { key: 'qty', label: 'Counted quantity', kind: 'qty', required: true, synonyms: ['counted', 'count', 'physical', 'physical stock', 'actual', 'actual stock', 'qty', 'quantity', 'stock', 'closing stock', 'counted qty', 'physical qty', 'on hand', 'balance'] },
    { key: 'date', label: 'Count date', kind: 'date', synonyms: ['date', 'count date', 'as on', 'as of', 'stock date'] },
  ],
};

export const TARGET_LABELS: Record<ImportTarget, string> = {
  products: 'Products', sales: 'Sales', purchases: 'Purchases', expenses: 'Expenses', stock_count: 'Stock count', custom: 'New custom table',
};

export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Confidence 0..1 that `header` means the field described by `synonyms`. */
export function matchScore(header: string, synonyms: string[]): number {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  const words = h.split(' ');
  for (const syn of synonyms) {
    let s = 0;
    if (h === syn) s = 1;
    else if (h.replace(/ /g, '') === syn.replace(/ /g, '')) s = 0.97;
    else if (words.length > 1 && (h.startsWith(syn + ' ') || h.endsWith(' ' + syn) || h.includes(' ' + syn + ' '))) s = syn.includes(' ') ? 0.88 : 0.7;
    else if (syn.includes(' ') && syn.split(' ').every((w) => words.includes(w))) s = 0.84;
    else {
      const jw = jaroWinkler(h, syn);
      if (jw >= 0.93 && Math.abs(h.length - syn.length) <= 2 && h.length >= 4) s = 0.78;
    }
    if (s > best) best = s;
  }
  return best;
}

export interface MappingSuggestion { field: string; column: number | null; confidence: number }

/** Greedy best-first assignment: each column feeds at most one field. */
export function suggestMapping(headers: string[], target: Exclude<ImportTarget, 'custom'>): MappingSuggestion[] {
  const fields = TARGET_FIELDS[target];
  const candidates: Array<{ f: number; c: number; s: number }> = [];
  fields.forEach((fd, f) => headers.forEach((h, c) => {
    const s = matchScore(h, fd.synonyms) - f * 0.0001; // stable tie-break: earlier fields win
    if (s >= 0.6) candidates.push({ f, c, s });
  }));
  candidates.sort((a, b) => b.s - a.s);
  const usedF = new Set<number>(), usedC = new Set<number>();
  const out: MappingSuggestion[] = fields.map((fd) => ({ field: fd.key, column: null, confidence: 0 }));
  for (const cand of candidates) {
    if (usedF.has(cand.f) || usedC.has(cand.c)) continue;
    usedF.add(cand.f); usedC.add(cand.c);
    out[cand.f] = { field: fields[cand.f].key, column: cand.c, confidence: Math.min(1, Math.round(cand.s * 100) / 100) };
  }
  return out;
}

/** Scores every target for a header row; the wizard pre-selects the best one. */
export function suggestTarget(headers: string[], fileName = ''): { target: ImportTarget; scores: Record<string, number> } {
  const scores: Record<string, number> = {};
  const hs = headers.map(norm);
  const has = (re: RegExp): boolean => hs.some((h) => re.test(h));
  const fname = norm(fileName);
  for (const target of Object.keys(TARGET_FIELDS) as Array<Exclude<ImportTarget, 'custom'>>) {
    const m = suggestMapping(headers, target);
    const fields = TARGET_FIELDS[target];
    let score = 0, missingRequired = 0;
    m.forEach((s, i) => {
      if (s.column != null) score += s.confidence * (fields[i].required ? 2 : 1);
      else if (fields[i].required) missingRequired++;
    });
    if ((target === 'sales' || target === 'purchases' || target === 'stock_count') && m.find((x) => x.field === 'sku')?.column == null && m.find((x) => x.field === 'name')?.column == null) missingRequired++;
    score -= missingRequired * 2.5;
    scores[target] = score;
  }
  const hasDate = has(/\bdate\b|\bdt\b/);
  if (has(/invoice|customer|sold|sale/)) scores.sales += 1.5;
  if (has(/supplier|vendor|purchase|grn|received/) && hasDate) scores.purchases += 2;
  if (has(/expense|narration|ledger|paid/) ) scores.expenses += 2;
  if (has(/reorder|mrp|category|min stock|selling price|cost price/) && !hasDate) scores.products += 1.5;
  if (has(/counted|physical|actual/)) scores.stock_count += 2.5;
  if (!hasDate) { scores.sales -= 3; scores.purchases -= 3; scores.expenses -= 3; }
  if (hasDate) { scores.products -= 2; scores.stock_count -= 0.5; }
  if (/sale|invoice|billing/.test(fname)) scores.sales += 1.5;
  if (/purchase|grn|inward/.test(fname)) scores.purchases += 1.5;
  if (/expense|spend/.test(fname)) scores.expenses += 1.5;
  if (/stock count|stocktake|physical|count/.test(fname)) scores.stock_count += 1.5;
  else if (/stock|product|item|inventory|price ?list/.test(fname)) scores.products += 1.5;
  let best: ImportTarget = 'custom', bestScore = 2.4; // below this nothing fits well: offer a custom table
  for (const [t, s] of Object.entries(scores)) if (s > bestScore) { best = t as ImportTarget; bestScore = s; }
  return { target: best, scores };
}
