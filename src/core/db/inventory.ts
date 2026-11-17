// App-side writes and reads for products, stock and manual entries. Every write here is a fixed,
// parameterised statement written by us: the AI never reaches this file.
import type { DbEngine } from './engine';
import { DbError } from './engine';
import type { AdjustKind, ProductInput, ProductRow, Row } from '../types';
import { toPaise } from '../util/money';
import { addDays, todayISO } from '../util/dates';

const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.name, p.category, p.unit, p.cost_paise / 100.0 AS cost, p.price_paise / 100.0 AS price,
         st.on_hand AS stock, p.reorder_level, p.lead_time_days, p.is_active, sup.name AS supplier, st.last_sale_date,
         CASE WHEN st.on_hand <= 0 THEN 'out' WHEN st.on_hand <= p.reorder_level THEN 'low'
              WHEN p.reorder_level > 0 AND st.on_hand > p.reorder_level * 5 THEN 'overstock' ELSE 'ok' END AS status,
         d.avg_daily AS avg_daily_demand,
         CASE WHEN d.avg_daily > 0 THEN ROUND(MAX(st.on_hand, 0) / d.avg_daily, 1) ELSE NULL END AS days_of_cover
  FROM products p
  JOIN _v_stock st ON st.product_id = p.id
  LEFT JOIN suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN (SELECT product_id, SUM(qty) / 28.0 AS avg_daily FROM sales WHERE sale_date > ? AND sale_date <= ? GROUP BY product_id) d ON d.product_id = p.id`;

export function listProducts(e: DbEngine, opts: { search?: string; category?: string; status?: string; includeArchived?: boolean; today?: string; limit?: number } = {}): ProductRow[] {
  const today = opts.today ?? todayISO();
  const where: string[] = [];
  const params: unknown[] = [addDays(today, -28), today];
  if (!opts.includeArchived) where.push('p.is_active = 1');
  if (opts.category) { where.push('p.category = ?'); params.push(opts.category); }
  const term = (opts.search ?? '').trim();
  if (term) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\')");
    const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    params.push(like, like, like);
  }
  let sql = `SELECT * FROM (${PRODUCT_SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''})`;
  if (opts.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
  sql += ' ORDER BY name COLLATE NOCASE LIMIT ?';
  params.push(opts.limit ?? 2000);
  return e.all<ProductRow>(sql, params);
}

export function getProduct(e: DbEngine, id: number, today = todayISO()): ProductRow | null {
  return e.one<ProductRow>(PRODUCT_SELECT + ' WHERE p.id = ?', [addDays(today, -28), today, id]);
}

export function listCategories(e: DbEngine): string[] {
  return e.all<{ category: string }>("SELECT DISTINCT category FROM products WHERE is_active = 1 AND category IS NOT NULL ORDER BY category COLLATE NOCASE").map((r) => r.category);
}

/** Names for fuzzy matching spoken product names (id, name, sku only). */
export function productNames(e: DbEngine): Array<{ id: number; name: string; sku: string; unit: string }> {
  return e.all('SELECT id, name, sku, unit FROM products WHERE is_active = 1');
}

function supplierId(e: DbEngine, name?: string | null): number | null {
  const n = name?.trim();
  if (!n) return null;
  const id = e.scalar<number>('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE', [n]);
  if (id) return id;
  e.run('INSERT INTO suppliers(name) VALUES (?)', [n]);
  return e.lastId();
}

function nextSku(e: DbEngine): string {
  let n = (e.scalar<number>('SELECT COUNT(*) FROM products') ?? 0) + 1;
  for (;;) {
    const sku = `P${String(n).padStart(4, '0')}`;
    if (!e.scalar('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE', [sku])) return sku;
    n++;
  }
}

export function saveProduct(e: DbEngine, input: ProductInput, id?: number | null, today = todayISO()): number {
  const name = input.name?.trim();
  if (!name) throw new DbError('Enter a product name.', 'VALIDATION');
  for (const [label, v] of [['Cost', input.cost], ['Price', input.price], ['Reorder level', input.reorder_level]] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0)) throw new DbError(`${label} cannot be negative.`, 'VALIDATION');
  }
  const sku = input.sku?.trim() || (id ? null : nextSku(e));
  const out = e.tx(() => {
    if (sku) {
      const clash = e.scalar<number>('SELECT id FROM products WHERE sku = ? COLLATE NOCASE', [sku]);
      if (clash && clash !== id) throw new DbError(`SKU ${sku} is already used by another product.`, 'DUPLICATE_SKU');
    }
    const sup = supplierId(e, input.supplier);
    if (id) {
      e.run(`UPDATE products SET sku = COALESCE(?, sku), name = ?, category = ?, unit = ?, cost_paise = ?, price_paise = ?, reorder_level = ?, lead_time_days = ?, supplier_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [sku, name, input.category?.trim() || 'Uncategorised', input.unit?.trim() || 'pcs', toPaise(input.cost ?? 0), toPaise(input.price ?? 0), input.reorder_level ?? 0, Math.max(0, Math.round(input.lead_time_days ?? 7)), sup, id]);
      return id;
    }
    e.run('INSERT INTO products(sku, name, category, unit, cost_paise, price_paise, reorder_level, lead_time_days, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sku, name, input.category?.trim() || 'Uncategorised', input.unit?.trim() || 'pcs', toPaise(input.cost ?? 0), toPaise(input.price ?? 0), input.reorder_level ?? 0, Math.max(0, Math.round(input.lead_time_days ?? 7)), sup]);
    const newId = e.lastId();
    if (input.opening_stock) e.run("INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, note) VALUES (?, ?, 'opening', ?, 'Opening stock')", [newId, today, input.opening_stock]);
    return newId;
  });
  e.changed();
  return out;
}

/** Products with history are archived (hidden, data kept); products with none are really deleted. */
export function removeProduct(e: DbEngine, id: number): 'deleted' | 'archived' {
  const used = (e.scalar<number>('SELECT (SELECT COUNT(*) FROM sales WHERE product_id = ?) + (SELECT COUNT(*) FROM purchases WHERE product_id = ?)', [id, id]) ?? 0) > 0;
  e.tx(() => {
    if (used) e.run("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
    else {
      e.run('DELETE FROM stock_movements WHERE product_id = ?', [id]);
      e.run('DELETE FROM _forecast WHERE product_id = ?', [id]);
      e.run('DELETE FROM products WHERE id = ?', [id]);
    }
  });
  e.changed();
  return used ? 'archived' : 'deleted';
}

export function restoreProduct(e: DbEngine, id: number): void { e.run('UPDATE products SET is_active = 1 WHERE id = ?', [id]); e.changed(); }

/**
 * Stock adjustment. `count` sets the stock to the counted quantity (the movement stores the difference);
 * damage and return_out take stock away; return_in adds; adjustment takes a signed quantity.
 */
export function adjustStock(e: DbEngine, productId: number, kind: AdjustKind, qty: number, note?: string | null, date = todayISO()): number {
  if (!Number.isFinite(qty)) throw new DbError('Enter a quantity.', 'VALIDATION');
  const onHand = e.scalar<number>('SELECT on_hand FROM _v_stock WHERE product_id = ?', [productId]);
  if (onHand == null) throw new DbError('Product not found.', 'NOT_FOUND');
  let delta: number;
  if (kind === 'count') { if (qty < 0) throw new DbError('A counted quantity cannot be negative.', 'VALIDATION'); delta = qty - onHand; }
  else if (kind === 'damage' || kind === 'return_out') delta = -Math.abs(qty);
  else if (kind === 'return_in') delta = Math.abs(qty);
  else delta = qty;
  delta = Math.round(delta * 1000) / 1000;
  if (delta === 0) return onHand;
  e.run('INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, note) VALUES (?, ?, ?, ?, ?)', [productId, date, kind, delta, note?.trim() || null]);
  e.changed();
  return Math.round((onHand + delta) * 1000) / 1000;
}

function customerId(e: DbEngine, name?: string | null): number | null {
  const n = name?.trim();
  if (!n) return null;
  const id = e.scalar<number>('SELECT id FROM customers WHERE name = ? COLLATE NOCASE', [n]);
  if (id) return id;
  e.run('INSERT INTO customers(name) VALUES (?)', [n]);
  return e.lastId();
}

export interface SaleInput { product_id: number; qty: number; unit_price?: number | null; date?: string; invoice_no?: string | null; customer?: string | null; discount?: number | null }
export function saveSale(e: DbEngine, s: SaleInput, id?: number | null): number {
  if (!(s.qty > 0)) throw new DbError('Quantity must be more than zero.', 'VALIDATION');
  const p = e.one<{ price_paise: number; cost_paise: number }>('SELECT price_paise, cost_paise FROM products WHERE id = ?', [s.product_id]);
  if (!p) throw new DbError('Choose a product.', 'VALIDATION');
  const unit = s.unit_price != null ? toPaise(s.unit_price) : p.price_paise;
  if (unit < 0) throw new DbError('Price cannot be negative.', 'VALIDATION');
  const out = e.tx(() => {
    const cust = customerId(e, s.customer);
    if (id) {
      e.run('UPDATE sales SET sale_date = ?, product_id = ?, qty = ?, unit_price_paise = ?, discount_paise = ?, invoice_no = ?, customer_id = ? WHERE id = ?',
        [s.date ?? todayISO(), s.product_id, s.qty, unit, toPaise(s.discount ?? 0), s.invoice_no?.trim() || null, cust, id]);
      return id;
    }
    e.run('INSERT INTO sales(invoice_no, sale_date, product_id, customer_id, qty, unit_price_paise, discount_paise, unit_cost_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [s.invoice_no?.trim() || null, s.date ?? todayISO(), s.product_id, cust, s.qty, unit, toPaise(s.discount ?? 0), p.cost_paise || null]);
    return e.lastId();
  });
  e.changed();
  return out;
}

export interface PurchaseInput { product_id: number; qty: number; unit_cost?: number | null; date?: string; bill_no?: string | null; supplier?: string | null }
export function savePurchase(e: DbEngine, s: PurchaseInput, id?: number | null): number {
  if (!(s.qty > 0)) throw new DbError('Quantity must be more than zero.', 'VALIDATION');
  const p = e.one<{ cost_paise: number }>('SELECT cost_paise FROM products WHERE id = ?', [s.product_id]);
  if (!p) throw new DbError('Choose a product.', 'VALIDATION');
  const unit = s.unit_cost != null ? toPaise(s.unit_cost) : p.cost_paise;
  if (unit < 0) throw new DbError('Cost cannot be negative.', 'VALIDATION');
  const out = e.tx(() => {
    const sup = supplierId(e, s.supplier);
    if (id) {
      e.run('UPDATE purchases SET purchase_date = ?, product_id = ?, qty = ?, unit_cost_paise = ?, bill_no = ?, supplier_id = ? WHERE id = ?', [s.date ?? todayISO(), s.product_id, s.qty, unit, s.bill_no?.trim() || null, sup, id]);
      return id;
    }
    e.run('INSERT INTO purchases(bill_no, purchase_date, product_id, supplier_id, qty, unit_cost_paise) VALUES (?, ?, ?, ?, ?, ?)', [s.bill_no?.trim() || null, s.date ?? todayISO(), s.product_id, sup, s.qty, unit]);
    return e.lastId();
  });
  e.changed();
  return out;
}

export interface ExpenseInput { date?: string; category: string; amount: number; note?: string | null; payment_mode?: string | null }
export function saveExpense(e: DbEngine, x: ExpenseInput, id?: number | null): number {
  if (!x.category?.trim()) throw new DbError('Enter a category.', 'VALIDATION');
  if (!(x.amount > 0)) throw new DbError('Amount must be more than zero.', 'VALIDATION');
  if (id) e.run('UPDATE expenses SET expense_date = ?, category = ?, amount_paise = ?, note = ?, payment_mode = ? WHERE id = ?', [x.date ?? todayISO(), x.category.trim(), toPaise(x.amount), x.note?.trim() || null, x.payment_mode?.trim() || null, id]);
  else e.run('INSERT INTO expenses(expense_date, category, amount_paise, note, payment_mode) VALUES (?, ?, ?, ?, ?)', [x.date ?? todayISO(), x.category.trim(), toPaise(x.amount), x.note?.trim() || null, x.payment_mode?.trim() || null]);
  const out = id ?? e.lastId();
  e.changed();
  return out;
}

export function updatePrice(e: DbEngine, productId: number, price: number): void {
  if (!(price >= 0) || !Number.isFinite(price)) throw new DbError('Price cannot be negative.', 'VALIDATION');
  e.run("UPDATE products SET price_paise = ?, updated_at = datetime('now') WHERE id = ?", [toPaise(price), productId]);
  e.changed();
}

/** Raw row for the edit forms on the Data screen (rupees, not paise). */
export function getEditRow(e: DbEngine, table: string, id: number): Row | null {
  if (table === 'sales') return e.one(`SELECT s.id, s.sale_date AS date, s.product_id, s.qty, s.unit_price_paise / 100.0 AS unit_price, s.discount_paise / 100.0 AS discount, s.invoice_no, c.name AS customer FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`, [id]);
  if (table === 'purchases') return e.one(`SELECT pu.id, pu.purchase_date AS date, pu.product_id, pu.qty, pu.unit_cost_paise / 100.0 AS unit_cost, pu.bill_no, s.name AS supplier FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id WHERE pu.id = ?`, [id]);
  if (table === 'expenses') return e.one('SELECT id, expense_date AS date, category, amount_paise / 100.0 AS amount, note, payment_mode FROM expenses WHERE id = ?', [id]);
  return null;
}

export interface ProductDetail {
  product: ProductRow;
  movements: Array<{ id: number; move_date: string; kind: string; qty_delta: number; note: string | null }>;
  /** Daily units for the last 90 days (zero-filled). */
  history: Array<{ day: string; units: number }>;
  totals: { units90: number; revenue90: number; profit90: number };
  forecast: Row | null;
}

export function productDetail(e: DbEngine, id: number, today = todayISO()): ProductDetail | null {
  const product = getProduct(e, id, today);
  if (!product) return null;
  const from = addDays(today, -89);
  const byDay = new Map(e.all<{ d: string; u: number }>('SELECT sale_date AS d, SUM(qty) AS u FROM sales WHERE product_id = ? AND sale_date BETWEEN ? AND ? GROUP BY sale_date', [id, from, today]).map((r) => [r.d, r.u]));
  const history: Array<{ day: string; units: number }> = [];
  for (let i = 0; i < 90; i++) { const day = addDays(from, i); history.push({ day, units: byDay.get(day) ?? 0 }); }
  const t = e.one<{ u: number; r: number; c: number }>(`SELECT COALESCE(SUM(qty), 0) AS u, COALESCE(SUM(ROUND((qty * unit_price_paise - discount_paise) / 100.0, 2)), 0) AS r,
      COALESCE(SUM(ROUND(qty * COALESCE(unit_cost_paise, (SELECT cost_paise FROM products WHERE id = sales.product_id)) / 100.0, 2)), 0) AS c
    FROM sales WHERE product_id = ? AND sale_date BETWEEN ? AND ?`, [id, from, today]);
  return {
    product,
    movements: e.all('SELECT id, move_date, kind, qty_delta, note FROM stock_movements WHERE product_id = ? ORDER BY move_date DESC, id DESC LIMIT 40', [id]),
    history,
    totals: { units90: t?.u ?? 0, revenue90: Math.round((t?.r ?? 0) * 100) / 100, profit90: Math.round(((t?.r ?? 0) - (t?.c ?? 0)) * 100) / 100 },
    forecast: e.one('SELECT * FROM _forecast WHERE product_id = ?', [id]),
  };
}
