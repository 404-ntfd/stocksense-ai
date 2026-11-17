// Writes coerced rows into the database, one transaction per chunk, tagging every row with its
// import batch so the whole import can be undone later.
import type { DbEngine } from './engine';
import { DbError } from './engine';
import type { ColumnSpec, ImportBatchInfo, ImportMeta, ImportMode, ImportReport, ImportTarget, Row, RowError } from '../types';
import { toPaise } from '../util/money';
import { normName } from '../util/fuzzy';
import { todayISO } from '../util/dates';
import { WARNING_TEXT } from '../import/pipeline';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const MAX_ERRORS = 500;

export function newBatchId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export class ImportRun {
  readonly report: ImportReport;
  private skuMap = new Map<string, number>();
  private nameMap = new Map<string, number>();
  private cost = new Map<number, number>();
  private price = new Map<number, number>();
  private suppliers = new Map<string, number>();
  private customers = new Map<string, number>();
  private stock = new Map<number, number>();
  private seenSkus = new Map<string, number>();
  private counts: Record<string, number> = {};
  private autoSeq = 0;
  private t0 = Date.now();
  private done = false;
  private customCols: ColumnSpec[] = [];
  private customInsert = '';

  constructor(private e: DbEngine, private target: ImportTarget, private mode: ImportMode, batchId: string, private meta: ImportMeta) {
    this.report = { batchId, target, mode, fileName: meta.fileName, rowsOk: 0, rowsFailed: 0, createdProducts: 0, warnings: [...(meta.preWarnings ?? [])], errors: [], ms: 0 };
  }

  begin(): void {
    const e = this.e;
    for (const p of e.all<{ id: number; sku: string; name: string; cost_paise: number; price_paise: number }>('SELECT id, sku, name, cost_paise, price_paise FROM products')) {
      this.skuMap.set(p.sku.toLowerCase(), p.id);
      if (!this.nameMap.has(normName(p.name))) this.nameMap.set(normName(p.name), p.id);
      this.cost.set(p.id, p.cost_paise ?? 0);
      this.price.set(p.id, p.price_paise ?? 0);
    }
    for (const s of e.all<{ id: number; name: string }>('SELECT id, name FROM suppliers')) this.suppliers.set(s.name.toLowerCase(), s.id);
    for (const c of e.all<{ id: number; name: string }>('SELECT id, name FROM customers WHERE name IS NOT NULL')) this.customers.set(c.name.toLowerCase(), c.id);
    if (this.target === 'products' || this.target === 'stock_count') {
      for (const s of e.all<{ product_id: number; on_hand: number }>('SELECT product_id, on_hand FROM _v_stock')) this.stock.set(s.product_id, s.on_hand);
    }
    this.autoSeq = e.scalar<number>("SELECT COUNT(*) FROM products WHERE sku LIKE 'AUTO-%'") ?? 0;
    e.tx(() => {
      e.run("INSERT INTO _import_batches(id, file_name, target, mode, created_at, status, file_hash, custom_table) VALUES (?, ?, ?, ?, datetime('now'), 'running', ?, ?)",
        [this.report.batchId, this.meta.fileName, this.target, this.mode, this.meta.fileHash ?? null, this.meta.custom?.tableName ?? null]);
      if (this.target === 'custom') this.prepareCustomTable();
      else if (this.mode === 'replace') this.clearTarget();
    });
  }

  private clearTarget(): void {
    const e = this.e;
    if (this.target === 'sales') e.run('DELETE FROM sales');
    else if (this.target === 'purchases') e.run('DELETE FROM purchases');
    else if (this.target === 'expenses') e.run('DELETE FROM expenses');
    else if (this.target === 'products') {
      // products that other data points at cannot be deleted: archive them; the file re-activates the ones it contains
      e.run(`DELETE FROM stock_movements WHERE kind IN ('opening','count') AND product_id NOT IN (SELECT product_id FROM sales UNION SELECT product_id FROM purchases)`);
      e.run('DELETE FROM _forecast');
      e.run(`DELETE FROM products WHERE id NOT IN (SELECT product_id FROM sales UNION SELECT product_id FROM purchases UNION SELECT product_id FROM stock_movements)`);
      e.run('UPDATE products SET is_active = 0');
    }
  }

  private prepareCustomTable(): void {
    const c = this.meta.custom;
    if (!c || !/^u_[a-z0-9_]{1,60}$/.test(c.tableName)) throw new DbError('Invalid custom table name.', 'BAD_TABLE');
    this.customCols = c.columns;
    const e = this.e;
    const exists = !!e.scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [c.tableName]);
    if (exists && this.mode === 'replace') { e.run(`DROP TABLE "${c.tableName}"`); e.run('DELETE FROM _meta_columns WHERE table_name = ?', [c.tableName]); }
    if (!exists || this.mode === 'replace') {
      const defs = c.columns.map((col) => `"${col.name}" ${col.type === 'DATE' ? 'TEXT' : col.type}`).join(', ');
      e.run(`CREATE TABLE "${c.tableName}" (${defs}, "_import_batch" TEXT)`);
      e.run('INSERT INTO _meta_tables(table_name, display_name, description, is_custom) VALUES (?, ?, ?, 1) ON CONFLICT(table_name) DO UPDATE SET display_name = excluded.display_name, description = excluded.description',
        [c.tableName, c.displayName, `Uploaded from ${this.meta.fileName}`]);
      for (const col of c.columns) {
        e.run('INSERT OR REPLACE INTO _meta_columns(table_name, column_name, display_name, description, sem_type) VALUES (?, ?, ?, ?, ?)', [c.tableName, col.name, col.display, col.description, col.semType]);
      }
    } else {
      const have = new Set(e.all<{ name: string }>(`PRAGMA table_info("${c.tableName}")`).map((r) => r.name));
      const missing = c.columns.filter((col) => !have.has(col.name));
      if (missing.length) throw new DbError(`The table "${c.displayName}" already exists with different columns (${missing.map((m) => m.display).join(', ')} are new). Choose Replace, or import under a new name.`, 'CUSTOM_MISMATCH');
    }
    this.customInsert = `INSERT INTO "${c.tableName}" (${c.columns.map((col) => `"${col.name}"`).join(', ')}, "_import_batch") VALUES (${c.columns.map(() => '?').join(', ')}, ?)`;
  }

  private warn(key: string, n = 1): void { this.counts[key] = (this.counts[key] ?? 0) + n; }
  mergeWarnCounts(counts: Record<string, number>): void { for (const [k, v] of Object.entries(counts)) this.warn(k, v); }
  addErrors(errors: RowError[]): void {
    this.report.rowsFailed += errors.length;
    for (const er of errors) if (this.report.errors.length < MAX_ERRORS) this.report.errors.push(er);
  }
  private fail(r: Row, code: string, message: string): void {
    this.report.rowsFailed++;
    if (this.report.errors.length < MAX_ERRORS) this.report.errors.push({ row: Number(r.__row ?? 0), code, message });
  }

  private supplierId(name: string | null): number | null {
    if (!name) return null;
    const k = name.toLowerCase();
    let id = this.suppliers.get(k);
    if (!id) {
      this.e.runFast('INSERT INTO suppliers(name, import_batch) VALUES (?, ?)', [name, this.report.batchId]);
      id = this.e.lastId();
      this.suppliers.set(k, id);
    }
    return id;
  }
  private customerId(name: string | null): number | null {
    if (!name) return null;
    const k = name.toLowerCase();
    let id = this.customers.get(k);
    if (!id) {
      this.e.runFast('INSERT INTO customers(name, import_batch) VALUES (?, ?)', [name, this.report.batchId]);
      id = this.e.lastId();
      this.customers.set(k, id);
    }
    return id;
  }
  private findProduct(r: Row): number | null {
    const sku = str(r.sku), name = str(r.name);
    if (sku) { const id = this.skuMap.get(sku.toLowerCase()); if (id) return id; }
    if (name) { const id = this.nameMap.get(normName(name)); if (id) return id; }
    return null;
  }
  private nextAutoSku(): string {
    let sku: string;
    do { this.autoSeq++; sku = `AUTO-${String(this.autoSeq).padStart(4, '0')}`; } while (this.skuMap.has(sku.toLowerCase()));
    return sku;
  }
  /** Sales and purchases may mention products that are not in the list yet: create them and count them. */
  private resolveOrCreateProduct(r: Row, pricePaise: number, costPaise: number): number | null {
    const found = this.findProduct(r);
    if (found) return found;
    const sku = str(r.sku), name = str(r.name);
    if (!sku && !name) return null;
    const newSku = sku ?? this.nextAutoSku();
    this.e.runFast('INSERT INTO products(sku, name, price_paise, cost_paise, import_batch) VALUES (?, ?, ?, ?, ?)', [newSku, name ?? newSku, pricePaise, costPaise, this.report.batchId]);
    const id = this.e.lastId();
    this.skuMap.set(newSku.toLowerCase(), id);
    this.nameMap.set(normName(name ?? newSku), id);
    this.cost.set(id, costPaise);
    this.price.set(id, pricePaise);
    this.report.createdProducts++;
    return id;
  }
  private saveUndo(table: string, id: number): void {
    const old = this.e.one<Row>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (old) this.e.runFast('INSERT INTO _import_undo(batch_id, table_name, row_id, old_json) VALUES (?, ?, ?, ?)', [this.report.batchId, table, id, JSON.stringify(old)]);
  }

  /** One chunk = one transaction. A row that violates a constraint is reported and skipped, the rest still go in. */
  addChunk(rows: Row[]): void {
    if (this.done) throw new DbError('Import already finished.', 'IMPORT_DONE');
    this.e.tx(() => {
      for (const r of rows) {
        try {
          if (this.rowIn(r)) this.report.rowsOk++;
        } catch (err) {
          this.fail(r, 'DB_ERROR', err instanceof Error ? err.message : String(err));
        }
      }
    });
  }

  private rowIn(r: Row): boolean {
    const e = this.e, batch = this.report.batchId;
    switch (this.target) {
      case 'products': {
        const name = str(r.name);
        if (!name) { this.fail(r, 'MISSING_NAME', 'Product name is empty'); return false; }
        const givenSku = str(r.sku);
        const key = (givenSku ?? 'name:' + normName(name)).toLowerCase();
        if (this.seenSkus.has(key)) this.warn('duplicate_sku');
        const costP = num(r.cost) != null ? toPaise(num(r.cost)!) : null;
        const priceP = num(r.price) != null ? toPaise(num(r.price)!) : null;
        if (costP != null && costP < 0 || priceP != null && priceP < 0) { this.fail(r, 'NEGATIVE_PRICE', 'Price and cost cannot be negative'); return false; }
        const supplier = this.supplierId(str(r.supplier));
        const existing = this.seenSkus.get(key) ?? (givenSku ? this.skuMap.get(givenSku.toLowerCase()) : this.nameMap.get(normName(name))) ?? null;
        let id: number;
        if (existing) {
          const fromThisFile = this.seenSkus.has(key);
          if (this.mode === 'append' && !fromThisFile) { this.fail(r, 'DUPLICATE_SKU', `${givenSku ?? name} already exists (choose "Update existing" to change it)`); return false; }
          id = existing;
          if (!fromThisFile) { this.saveUndo('products', id); this.warn('updated'); }
          e.runFast(`UPDATE products SET name = ?, category = COALESCE(?, category), unit = COALESCE(?, unit), cost_paise = COALESCE(?, cost_paise), price_paise = COALESCE(?, price_paise),
            reorder_level = COALESCE(?, reorder_level), lead_time_days = COALESCE(?, lead_time_days), supplier_id = COALESCE(?, supplier_id), extra = COALESCE(?, extra), is_active = 1, updated_at = datetime('now') WHERE id = ?`,
            [name, str(r.category), str(r.unit), costP, priceP, num(r.reorder_level), num(r.lead_time_days), supplier, str(r.extra), id]);
        } else {
          const sku = givenSku ?? this.nextAutoSku();
          e.runFast('INSERT INTO products(sku, name, category, unit, cost_paise, price_paise, reorder_level, lead_time_days, supplier_id, import_batch, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [sku, name, str(r.category) ?? 'Uncategorised', str(r.unit) ?? 'pcs', costP ?? 0, priceP ?? 0, num(r.reorder_level) ?? 0, Math.max(0, Math.round(num(r.lead_time_days) ?? 7)), supplier, batch, str(r.extra)]);
          id = e.lastId();
          this.skuMap.set(sku.toLowerCase(), id);
          this.nameMap.set(normName(name), id);
        }
        this.seenSkus.set(key, id);
        if (costP != null) this.cost.set(id, costP);
        if (priceP != null) this.price.set(id, priceP);
        const stock = num(r.stock);
        if (stock != null) {
          const onHand = this.stock.get(id) ?? 0;
          const delta = Math.round((stock - onHand) * 1000) / 1000;
          if (delta !== 0) {
            e.runFast('INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, note, import_batch) VALUES (?, ?, ?, ?, ?, ?)',
              [id, todayISO(), existing ? 'count' : 'opening', delta, existing ? 'Stock set by import' : 'Opening stock', batch]);
            this.stock.set(id, stock);
          }
        }
        return true;
      }
      case 'sales': {
        const qty = num(r.qty);
        if (qty == null || qty === 0) { this.fail(r, 'BAD_QTY', 'Quantity is empty or zero'); return false; }
        const absQty = Math.abs(qty);
        let unit = num(r.unit_price);
        const amount = num(r.amount);
        if (unit == null && amount != null) unit = Math.abs(amount) / absQty;
        const givenCost = num(r.unit_cost);
        const pid = this.resolveOrCreateProduct(r, unit != null ? toPaise(unit) : 0, givenCost != null ? toPaise(givenCost) : 0);
        if (!pid) { this.fail(r, 'NO_PRODUCT', 'Row has no product name or SKU'); return false; }
        if (qty < 0) { // a return: stock comes back, no sale line
          e.runFast("INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, note, import_batch) VALUES (?, ?, 'return_in', ?, ?, ?)", [pid, r.date, absQty, str(r.invoice_no) ? `Return ${str(r.invoice_no)}` : 'Return', batch]);
          this.warn('returns');
          return true;
        }
        const unitP = unit != null ? toPaise(unit) : this.price.get(pid) ?? 0;
        if (unitP < 0) { this.fail(r, 'NEGATIVE_PRICE', 'Price cannot be negative'); return false; }
        if (unitP === 0) this.warn('zero_price');
        const costP = givenCost != null ? toPaise(givenCost) : (this.cost.get(pid) || null);
        if (costP && unitP > 0 && unitP < costP) this.warn('below_cost');
        const discP = toPaise(Math.abs(num(r.discount) ?? 0)), taxP = toPaise(Math.abs(num(r.tax) ?? 0));
        const invoice = str(r.invoice_no);
        const customer = this.customerId(str(r.customer));
        if (this.mode === 'upsert' && invoice) {
          const id = e.scalar<number>('SELECT id FROM sales WHERE invoice_no = ? AND product_id = ?', [invoice, pid]);
          if (id) {
            if (e.scalar<string>('SELECT import_batch FROM sales WHERE id = ?', [id]) !== batch) this.saveUndo('sales', id);
            e.runFast('UPDATE sales SET sale_date = ?, qty = ?, unit_price_paise = ?, discount_paise = ?, tax_paise = ?, unit_cost_paise = ?, customer_id = COALESCE(?, customer_id), extra = COALESCE(?, extra) WHERE id = ?',
              [r.date, qty, unitP, discP, taxP, costP, customer, str(r.extra), id]);
            this.warn('updated');
            return true;
          }
        }
        e.runFast('INSERT INTO sales(invoice_no, sale_date, product_id, customer_id, qty, unit_price_paise, discount_paise, tax_paise, unit_cost_paise, import_batch, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [invoice, r.date, pid, customer, qty, unitP, discP, taxP, costP, batch, str(r.extra)]);
        return true;
      }
      case 'purchases': {
        const qty = num(r.qty);
        if (qty == null || qty <= 0) { this.fail(r, 'BAD_QTY', 'Quantity must be more than zero'); return false; }
        let unit = num(r.unit_cost);
        const amount = num(r.amount);
        if (unit == null && amount != null) unit = Math.abs(amount) / qty;
        const pid = this.resolveOrCreateProduct(r, 0, unit != null ? toPaise(unit) : 0);
        if (!pid) { this.fail(r, 'NO_PRODUCT', 'Row has no product name or SKU'); return false; }
        const unitP = unit != null ? toPaise(unit) : this.cost.get(pid) ?? 0;
        if (unitP < 0) { this.fail(r, 'NEGATIVE_PRICE', 'Cost cannot be negative'); return false; }
        if (!this.cost.get(pid) && unitP > 0) { // first known cost for this product
          e.runFast('UPDATE products SET cost_paise = ? WHERE id = ? AND COALESCE(cost_paise, 0) = 0', [unitP, pid]);
          this.cost.set(pid, unitP);
        }
        const bill = str(r.bill_no);
        const supplier = this.supplierId(str(r.supplier));
        if (this.mode === 'upsert' && bill) {
          const id = e.scalar<number>('SELECT id FROM purchases WHERE bill_no = ? AND product_id = ?', [bill, pid]);
          if (id) {
            if (e.scalar<string>('SELECT import_batch FROM purchases WHERE id = ?', [id]) !== batch) this.saveUndo('purchases', id);
            e.runFast('UPDATE purchases SET purchase_date = ?, qty = ?, unit_cost_paise = ?, tax_paise = ?, supplier_id = COALESCE(?, supplier_id) WHERE id = ?', [r.date, qty, unitP, toPaise(Math.abs(num(r.tax) ?? 0)), supplier, id]);
            this.warn('updated');
            return true;
          }
        }
        e.runFast('INSERT INTO purchases(bill_no, purchase_date, product_id, supplier_id, qty, unit_cost_paise, tax_paise, import_batch, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [bill, r.date, pid, supplier, qty, unitP, toPaise(Math.abs(num(r.tax) ?? 0)), batch, str(r.extra)]);
        return true;
      }
      case 'expenses': {
        const amount = num(r.amount);
        if (amount == null) { this.fail(r, 'MISSING_AMOUNT', 'Amount is empty'); return false; }
        e.runFast('INSERT INTO expenses(expense_date, category, amount_paise, note, payment_mode, import_batch, extra) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.date, str(r.category) ?? 'Other', toPaise(Math.abs(amount)), str(r.note), str(r.payment_mode), batch, str(r.extra)]);
        return true;
      }
      case 'stock_count': {
        const qty = num(r.qty);
        if (qty == null) { this.fail(r, 'BAD_QTY', 'Counted quantity is empty'); return false; }
        const pid = this.findProduct(r);
        if (!pid) { this.warn('unknown_product'); this.fail(r, 'UNKNOWN_PRODUCT', `${str(r.sku) ?? str(r.name) ?? 'Product'} is not in your product list`); return false; }
        const delta = Math.round((qty - (this.stock.get(pid) ?? 0)) * 1000) / 1000;
        if (delta !== 0) e.runFast("INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, note, import_batch) VALUES (?, ?, 'count', ?, 'Stock count', ?)", [pid, str(r.date) ?? todayISO(), delta, batch]);
        this.stock.set(pid, qty);
        return true;
      }
      case 'custom': {
        e.runFast(this.customInsert, [...this.customCols.map((c) => (r[c.name] ?? null) as never), batch]);
        return true;
      }
    }
  }

  finish(): ImportReport {
    if (this.done) return this.report;
    this.done = true;
    const e = this.e, rep = this.report;
    if (this.meta.preErrors?.length) this.addErrors(this.meta.preErrors);
    if (rep.createdProducts) this.warn('created_products', rep.createdProducts);
    for (const [k, n] of Object.entries(this.counts)) if (n > 0 && WARNING_TEXT[k]) rep.warnings.push(WARNING_TEXT[k](n));
    if (this.target === 'custom') rep.customTable = this.meta.custom?.tableName;
    rep.ms = Date.now() - this.t0;
    e.run("UPDATE _import_batches SET status = 'done', rows_ok = ?, rows_failed = ?, created_products = ?, warnings = ? WHERE id = ?",
      [rep.rowsOk, rep.rowsFailed, rep.createdProducts, JSON.stringify(rep.warnings), rep.batchId]);
    e.changed();
    return rep;
  }

  /** Cancel: remove everything this run wrote. */
  abort(): ImportReport {
    this.done = true;
    undoImport(this.e, this.report.batchId, 'cancelled');
    this.report.cancelled = true;
    this.report.ms = Date.now() - this.t0;
    return this.report;
  }
}

/** Runs a whole import from in-memory chunks (used by tests, scripts and the demo loader). */
export function importRows(e: DbEngine, target: ImportTarget, chunks: Iterable<Row[]>, mode: ImportMode, batchId: string, meta: ImportMeta): ImportReport {
  const run = new ImportRun(e, target, mode, batchId, meta);
  run.begin();
  for (const c of chunks) run.addChunk(c);
  return run.finish();
}

/**
 * Removes one import: its rows, the stock movements they caused and products/customers/suppliers it
 * created (unless later data depends on them). Rows that an "update existing" import changed get their
 * previous values back.
 */
export function undoImport(e: DbEngine, batchId: string, status: 'undone' | 'cancelled' = 'undone'): { removed: number; keptProducts: number } {
  const b = e.one<{ id: string; custom_table: string | null; undone: number }>('SELECT id, custom_table, undone FROM _import_batches WHERE id = ?', [batchId]);
  if (!b) throw new DbError('That import was not found.', 'NO_BATCH');
  if (b.undone) return { removed: 0, keptProducts: 0 };
  let removed = 0, keptProducts = 0;
  const count = (table: string): number => e.scalar<number>(`SELECT COUNT(*) FROM ${table} WHERE import_batch = ?`, [batchId]) ?? 0;
  e.tx(() => {
    for (const u of e.all<{ table_name: string; row_id: number; old_json: string }>('SELECT table_name, row_id, old_json FROM _import_undo WHERE batch_id = ? ORDER BY rowid DESC', [batchId])) {
      if (!['products', 'sales', 'purchases'].includes(u.table_name)) continue;
      const old = JSON.parse(u.old_json) as Row;
      const cols = Object.keys(old).filter((k) => k !== 'id');
      e.run(`UPDATE ${u.table_name} SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => old[c]), u.row_id]);
    }
    for (const t of ['sales', 'purchases', 'expenses', 'stock_movements']) { removed += count(t); e.run(`DELETE FROM ${t} WHERE import_batch = ?`, [batchId]); }
    // products created by this import: delete when nothing else refers to them, otherwise keep them
    const inUse = `(SELECT product_id FROM sales UNION SELECT product_id FROM purchases UNION SELECT product_id FROM stock_movements)`;
    keptProducts = e.scalar<number>(`SELECT COUNT(*) FROM products WHERE import_batch = ? AND id IN ${inUse}`, [batchId]) ?? 0;
    e.run(`DELETE FROM _forecast WHERE product_id IN (SELECT id FROM products WHERE import_batch = ? AND id NOT IN ${inUse})`, [batchId]);
    removed += e.scalar<number>(`SELECT COUNT(*) FROM products WHERE import_batch = ? AND id NOT IN ${inUse}`, [batchId]) ?? 0;
    e.run(`DELETE FROM products WHERE import_batch = ? AND id NOT IN ${inUse}`, [batchId]);
    e.run('UPDATE products SET import_batch = NULL WHERE import_batch = ?', [batchId]);
    e.run('DELETE FROM customers WHERE import_batch = ? AND id NOT IN (SELECT customer_id FROM sales WHERE customer_id IS NOT NULL)', [batchId]);
    e.run('DELETE FROM suppliers WHERE import_batch = ? AND id NOT IN (SELECT supplier_id FROM purchases WHERE supplier_id IS NOT NULL UNION SELECT supplier_id FROM products WHERE supplier_id IS NOT NULL)', [batchId]);
    if (b.custom_table && /^u_[a-z0-9_]+$/.test(b.custom_table) && e.scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [b.custom_table])) {
      removed += e.scalar<number>(`SELECT COUNT(*) FROM "${b.custom_table}" WHERE "_import_batch" = ?`, [batchId]) ?? 0;
      e.run(`DELETE FROM "${b.custom_table}" WHERE "_import_batch" = ?`, [batchId]);
      if ((e.scalar<number>(`SELECT COUNT(*) FROM "${b.custom_table}"`) ?? 0) === 0) { // nothing left: remove the empty table too
        e.run(`DROP TABLE "${b.custom_table}"`);
        e.run('DELETE FROM _meta_tables WHERE table_name = ?', [b.custom_table]);
        e.run('DELETE FROM _meta_columns WHERE table_name = ?', [b.custom_table]);
      }
    }
    e.run('DELETE FROM _import_undo WHERE batch_id = ?', [batchId]);
    e.run('UPDATE _import_batches SET undone = 1, status = ? WHERE id = ?', [status, batchId]);
  });
  e.changed();
  return { removed, keptProducts };
}

export function listImports(e: DbEngine, limit = 30): ImportBatchInfo[] {
  return e.all<ImportBatchInfo>('SELECT id, file_name, target, mode, rows_ok, rows_failed, created_at, status, created_products, custom_table FROM _import_batches ORDER BY created_at DESC, rowid DESC LIMIT ?', [limit]);
}

/** True when a finished, not-undone import of the same file bytes already exists. */
export function isDuplicateFile(e: DbEngine, fileHash: string): boolean {
  return !!e.scalar("SELECT 1 FROM _import_batches WHERE file_hash = ? AND status = 'done' AND undone = 0", [fileHash]);
}
