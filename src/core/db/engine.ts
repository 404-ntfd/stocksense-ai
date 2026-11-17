// DbEngine: everything that touches SQLite. It is synchronous and has no browser dependencies,
// so the same class runs inside the Web Worker (app) and directly in Node (tests, eval script).
import type { Database, SqlJsStatic, Statement } from 'sql.js';
import schemaSql from './schema.sql?raw';
import viewsSql from './views.sql?raw';
import { ALLOWED_VIEWS, BASE_TABLES, VIEW_DOCS } from './semantic';
import { guardSql } from '../ai/sqlGuard';
import type { QueryOpts, QueryResult, Row, SchemaDoc, SchemaTable } from '../types';

export const SCHEMA_VERSION = 1;

/** Ordered migrations. Version 1 is schema.sql itself; later versions append ALTER statements here. */
export const MIGRATIONS: Array<{ v: number; sql: string }> = [];

type Param = string | number | null | Uint8Array;

export class DbError extends Error {
  constructor(message: string, public code: string = 'DB_ERROR') { super(message); this.name = 'DbError'; }
}

export class DbEngine {
  db!: Database;
  /** Called after every data change (the worker uses it to schedule a save). */
  onChange: (() => void) | null = null;
  private stmts = new Map<string, Statement>();
  private schemaCache: SchemaDoc | null = null;
  private inTx = false;
  changeCount = 0;

  constructor(private SQL: SqlJsStatic, bytes?: Uint8Array | null, private onBeforeMigrate?: (fromVersion: number, bytes: Uint8Array) => void) {
    this.open(bytes ?? null);
  }

  private open(bytes: Uint8Array | null): void {
    this.db = bytes ? new this.SQL.Database(bytes) : new this.SQL.Database();
    this.db.run('PRAGMA foreign_keys = ON');
    const hasVersion = this.scalar<string>("SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_version'");
    const current = hasVersion ? this.scalar<number>('SELECT MAX(v) FROM _schema_version') ?? 0 : 0;
    if (current > SCHEMA_VERSION) throw new DbError('This data file was created by a newer version of StockSense AI. Please update the app.', 'NEWER_SCHEMA');
    if (bytes && current > 0 && current < SCHEMA_VERSION) this.onBeforeMigrate?.(current, bytes);
    this.db.exec(schemaSql); // idempotent: CREATE ... IF NOT EXISTS
    for (const m of MIGRATIONS) if (m.v > current && m.v <= SCHEMA_VERSION) this.db.exec(m.sql);
    if (current !== SCHEMA_VERSION) {
      this.db.run('DELETE FROM _schema_version');
      this.db.run('INSERT INTO _schema_version(v) VALUES (?)', [SCHEMA_VERSION]);
    }
    this.db.exec(viewsSql);
    this.recoverIncompleteImports();
  }

  // ---------- low-level helpers ----------
  private freeStatements(): void {
    for (const s of this.stmts.values()) { try { s.free(); } catch { /* already freed */ } }
    this.stmts.clear();
  }
  private stmt(sql: string): Statement {
    let s = this.stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }
  /** One-off write. */
  run(sql: string, params?: unknown[]): void { this.db.run(sql, (params ?? []) as Param[]); }
  /** Write through a cached prepared statement: use inside loops (imports, demo data). */
  runFast(sql: string, params: unknown[]): void { this.stmt(sql).run(params as Param[]); }
  lastId(): number { return this.scalar<number>('SELECT last_insert_rowid()') ?? 0; }

  all<T = Row>(sql: string, params?: unknown[], maxRows = Number.POSITIVE_INFINITY): T[] {
    return this.select<T>(sql, params, maxRows).rows;
  }
  one<T = Row>(sql: string, params?: unknown[]): T | null { return this.select<T>(sql, params, 1).rows[0] ?? null; }
  scalar<T = unknown>(sql: string, params?: unknown[]): T | null {
    const st = this.db.prepare(sql);
    try {
      if (params?.length) st.bind(params as Param[]);
      return st.step() ? ((st.get()[0] ?? null) as T | null) : null;
    } finally { st.free(); }
  }
  private select<T>(sql: string, params: unknown[] | undefined, maxRows: number): { columns: string[]; rows: T[]; truncated: boolean } {
    const st = this.db.prepare(sql);
    try {
      if (params?.length) st.bind(params as Param[]);
      const raw = st.getColumnNames();
      const seen = new Map<string, number>();
      const columns = raw.map((c) => { const n = (seen.get(c) ?? 0) + 1; seen.set(c, n); return n === 1 ? c : `${c}_${n}`; });
      const rows: T[] = [];
      let truncated = false;
      while (st.step()) {
        if (rows.length >= maxRows) { truncated = true; break; }
        const vals = st.get();
        const o: Row = {};
        for (let i = 0; i < columns.length; i++) o[columns[i]] = vals[i];
        rows.push(o as T);
      }
      return { columns, rows, truncated };
    } finally { st.free(); }
  }

  /** Runs fn inside one transaction; rolls back and rethrows on error. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.run('BEGIN');
    try {
      const out = fn();
      this.db.run('COMMIT');
      return out;
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch { /* nothing to roll back */ }
      throw e;
    } finally { this.inTx = false; }
  }

  /** Call after any change to business data: drops caches and tells the worker to persist. */
  changed(): void {
    this.changeCount++;
    this.schemaCache = null;
    try {
      this.db.run('DELETE FROM _kpi_cache');
      this.db.run("INSERT INTO _settings(key, value) VALUES ('data_version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1");
    } catch { /* tables always exist after init */ }
    this.onChange?.();
  }
  /** Counter that goes up with every data change; forecasts remember which version they were computed for. */
  dataVersion(): number { return Number(this.getSetting('data_version') ?? 0); }
  /** Ask the worker to save without invalidating caches (settings, logs, forecasts). */
  persist(): void { this.onChange?.(); }

  // ---------- public DbClient surface ----------
  /** App-internal write. Never called with model-written SQL. */
  exec(sql: string, params?: unknown[]): void { this.run(sql, params); this.changed(); }

  execBatch(statements: Array<{ sql: string; params?: unknown[] }>): void {
    this.tx(() => { for (const s of statements) this.run(s.sql, s.params); });
    this.changed();
  }

  /**
   * Read query. With readOnly:true (every AI-written query) the SQL is guarded again here, then run with
   * PRAGMA query_only inside a savepoint that is always rolled back: three independent layers.
   */
  query<T = Row>(sql: string, params?: unknown[], opts: QueryOpts = {}): QueryResult<T> {
    const t0 = Date.now();
    const maxRows = opts.maxRows ?? (opts.readOnly ? 1000 : 5000);
    if (!opts.readOnly) {
      const r = this.select<T>(sql, params, maxRows);
      return { ...r, ms: Date.now() - t0 };
    }
    const g = guardSql(sql, this.allowedTables());
    if (!g.ok) throw new DbError(g.reason, 'GUARD_BLOCKED');
    this.db.run('PRAGMA query_only = ON');
    this.db.run('SAVEPOINT ask');
    try {
      const r = this.select<T>(g.sql, params, maxRows);
      return { ...r, ms: Date.now() - t0 };
    } finally {
      try { this.db.run('ROLLBACK TO ask'); this.db.run('RELEASE ask'); } catch { /* savepoint already gone */ }
      this.db.run('PRAGMA query_only = OFF');
    }
  }

  /** Views plus custom tables the AI may read. */
  allowedTables(): string[] {
    const custom = this.all<{ table_name: string }>('SELECT table_name FROM _meta_tables WHERE is_custom = 1').map((r) => r.table_name);
    return [...ALLOWED_VIEWS, ...custom];
  }

  snapshot(): Uint8Array {
    this.freeStatements();
    const bytes = this.db.export();
    this.db.run('PRAGMA foreign_keys = ON'); // export() may reopen the connection
    return bytes;
  }

  /** Replaces the whole database with a backup file after checking that it really is a StockSense database. */
  restore(bytes: Uint8Array): void {
    const header = new TextDecoder().decode(bytes.slice(0, 15));
    if (header !== 'SQLite format 3') throw new DbError('That file is not a StockSense backup.', 'BAD_BACKUP');
    let probe: Database | null = null;
    try {
      probe = new this.SQL.Database(bytes);
      const ok = probe.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('products','sales','_schema_version')");
      if (!ok.length || Number(ok[0].values[0][0]) < 3) throw new DbError('That file is not a StockSense backup.', 'BAD_BACKUP');
    } catch (e) {
      if (e instanceof DbError) throw e;
      throw new DbError('That backup file is damaged and cannot be opened.', 'BAD_BACKUP');
    } finally { probe?.close(); }
    this.freeStatements();
    const old = this.db;
    this.open(bytes);
    old.close();
    this.changed();
  }

  clearAll(): void {
    this.freeStatements();
    const old = this.db;
    this.open(null);
    old.close();
    this.changed();
  }

  // ---------- settings ----------
  getSetting(key: string): string | null { return this.scalar<string>('SELECT value FROM _settings WHERE key = ?', [key]); }
  setSetting(key: string, value: string | null): void {
    if (value == null) this.run('DELETE FROM _settings WHERE key = ?', [key]);
    else this.run('INSERT INTO _settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    this.onChange?.();
  }

  // ---------- schema for the LLM ----------
  schemaForLlm(withSamples = true): SchemaDoc {
    if (this.schemaCache && withSamples) return this.schemaCache;
    const sample = (table: string, col: string): string[] | undefined => {
      if (!withSamples) return undefined;
      try {
        return this.all<{ v: unknown }>(`SELECT DISTINCT "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL AND "${col}" <> '' LIMIT 15`)
          .map((r) => String(r.v).replace(/\s+/g, ' ').slice(0, 40));
      } catch { return undefined; }
    };
    const tables: SchemaTable[] = VIEW_DOCS.map((v) => ({
      name: v.name, description: v.description, grain: v.grain, isCustom: false,
      columns: v.columns.map((c) => ({ name: c.name, type: c.type, description: c.description, samples: c.sample ? sample(v.name, c.name) : undefined })),
    }));
    for (const t of this.all<{ table_name: string; display_name: string; description: string }>('SELECT * FROM _meta_tables WHERE is_custom = 1 ORDER BY table_name')) {
      const cols = this.all<{ column_name: string; description: string; sem_type: string }>('SELECT column_name, description, sem_type FROM _meta_columns WHERE table_name = ? ORDER BY rowid', [t.table_name]);
      const info = new Map(this.all<{ name: string; type: string }>(`PRAGMA table_info("${t.table_name}")`).map((c) => [c.name, c.type]));
      if (!info.size) continue;
      tables.push({
        name: t.table_name, description: `${t.display_name}: ${t.description ?? 'uploaded custom table'}`.slice(0, 200), grain: 'one row per uploaded row', isCustom: true,
        rowCount: this.scalar<number>(`SELECT COUNT(*) FROM "${t.table_name}"`) ?? 0,
        columns: cols.filter((c) => info.has(c.column_name)).map((c) => ({
          name: c.column_name, type: info.get(c.column_name) || 'TEXT', description: (c.description ?? '').slice(0, 120),
          samples: c.sem_type === 'category' ? sample(t.table_name, c.column_name) : undefined,
        })),
      });
    }
    const doc = { tables };
    if (withSamples) this.schemaCache = doc;
    return doc;
  }

  // ---------- table browser ----------
  private gridSql(table: string): { sql: string; editable: boolean } {
    switch (table) {
      case 'products': return { editable: false, sql: `SELECT p.id, p.sku, p.name, p.category, p.unit, p.cost_paise/100.0 AS cost, p.price_paise/100.0 AS price, st.on_hand AS stock, p.reorder_level, p.lead_time_days, s.name AS supplier, CASE p.is_active WHEN 1 THEN 'active' ELSE 'archived' END AS state FROM products p JOIN _v_stock st ON st.product_id = p.id LEFT JOIN suppliers s ON s.id = p.supplier_id` };
      case 'sales': return { editable: true, sql: `SELECT s.id, s.sale_date, s.invoice_no, p.name AS product, s.qty, s.unit_price_paise/100.0 AS unit_price, s.discount_paise/100.0 AS discount, ROUND((s.qty*s.unit_price_paise - s.discount_paise)/100.0, 2) AS amount, c.name AS customer FROM sales s JOIN products p ON p.id = s.product_id LEFT JOIN customers c ON c.id = s.customer_id` };
      case 'purchases': return { editable: true, sql: `SELECT pu.id, pu.purchase_date, pu.bill_no, p.name AS product, pu.qty, pu.unit_cost_paise/100.0 AS unit_cost, ROUND(pu.qty*pu.unit_cost_paise/100.0, 2) AS amount, s.name AS supplier FROM purchases pu JOIN products p ON p.id = pu.product_id LEFT JOIN suppliers s ON s.id = pu.supplier_id` };
      case 'expenses': return { editable: true, sql: `SELECT id, expense_date, category, amount_paise/100.0 AS amount, payment_mode, note FROM expenses` };
      case 'stock_movements': return { editable: false, sql: `SELECT m.id, m.move_date, p.name AS product, m.kind, m.qty_delta, m.note FROM stock_movements m JOIN products p ON p.id = m.product_id` };
      case 'suppliers': return { editable: false, sql: `SELECT id, name, phone, email FROM suppliers` };
      case 'customers': return { editable: false, sql: `SELECT id, name, phone FROM customers` };
      default: {
        if (!this.isCustomTable(table)) throw new DbError(`Unknown table ${table}`, 'UNKNOWN_TABLE');
        return { editable: true, sql: `SELECT rowid AS id, * FROM "${table}"` };
      }
    }
  }
  isCustomTable(name: string): boolean {
    return /^u_[a-z0-9_]+$/.test(name) && !!this.scalar('SELECT 1 FROM _meta_tables WHERE table_name = ? AND is_custom = 1', [name]);
  }

  tableList(): Array<{ name: string; label: string; rows: number; isCustom: boolean; description?: string }> {
    const out = BASE_TABLES.map((t) => ({ name: t.name, label: t.label, rows: this.scalar<number>(`SELECT COUNT(*) FROM ${t.name}`) ?? 0, isCustom: false }));
    for (const t of this.all<{ table_name: string; display_name: string; description: string }>('SELECT * FROM _meta_tables WHERE is_custom = 1 ORDER BY display_name')) {
      let rows = 0;
      try { rows = this.scalar<number>(`SELECT COUNT(*) FROM "${t.table_name}"`) ?? 0; } catch { continue; }
      out.push({ name: t.table_name, label: t.display_name || t.table_name, rows, isCustom: true, description: t.description } as never);
    }
    return out;
  }

  browse(table: string, opts: { offset?: number; limit?: number; search?: string; sort?: string; dir?: 'asc' | 'desc' } = {}): { columns: string[]; rows: Row[]; total: number; editable: boolean } {
    const g = this.gridSql(table);
    const probe = this.select<Row>(`SELECT * FROM (${g.sql}) LIMIT 0`, undefined, 0);
    const columns = probe.columns.filter((c) => c !== '_import_batch');
    const params: unknown[] = [];
    let where = '';
    const term = (opts.search ?? '').trim();
    if (term) {
      where = ' WHERE (' + columns.map((c) => `CAST("${c}" AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
      const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      for (let i = 0; i < columns.length; i++) params.push(like);
    }
    const sortCol = opts.sort && columns.includes(opts.sort) ? opts.sort : 'id';
    const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
    const total = this.scalar<number>(`SELECT COUNT(*) FROM (${g.sql})${where}`, params) ?? 0;
    const rows = this.all<Row>(`SELECT * FROM (${g.sql})${where} ORDER BY "${sortCol}" ${dir} LIMIT ? OFFSET ?`, [...params, Math.min(opts.limit ?? 50, 500), opts.offset ?? 0]);
    for (const r of rows) delete r._import_batch;
    return { columns, rows, total, editable: g.editable };
  }

  /** All rows of a table or allowed view, for CSV/XLSX export (capped). */
  exportRows(table: string, cap = 300000): { columns: string[]; rows: Row[] } {
    const sql = ALLOWED_VIEWS.includes(table) ? `SELECT * FROM ${table}` : this.gridSql(table).sql;
    const r = this.select<Row>(sql, undefined, cap);
    return { columns: r.columns, rows: r.rows };
  }

  deleteRow(table: string, id: number): void {
    if (table === 'sales' || table === 'purchases' || table === 'expenses') this.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    else if (this.isCustomTable(table)) this.run(`DELETE FROM "${table}" WHERE rowid = ?`, [id]);
    else throw new DbError('Rows in this table cannot be deleted here.', 'NOT_EDITABLE');
    this.changed();
  }

  // ---------- Q&A log ----------
  logQa(e: { question: string; sql?: string | null; ok: boolean; ms: number; route: string; error?: string | null }): number {
    this.run("INSERT INTO _qa_log(asked_at, question, sql, ok, ms, route, error) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)",
      [e.question.slice(0, 2000), e.sql ?? null, e.ok ? 1 : 0, Math.round(e.ms), e.route, e.error ?? null]);
    const id = this.lastId();
    this.run('DELETE FROM _qa_log WHERE id <= ?', [id - 500]); // keep the log small
    this.onChange?.();
    return id;
  }
  setQaFeedback(id: number, feedback: number): void { this.run('UPDATE _qa_log SET feedback = ? WHERE id = ?', [feedback, id]); this.onChange?.(); }
  qaLog(limit = 50): Row[] { return this.all('SELECT * FROM _qa_log ORDER BY id DESC LIMIT ?', [limit]); }

  // ---------- crash recovery ----------
  /** An import that was still "running" when the app died is rolled back on the next start. */
  private recoverIncompleteImports(): void {
    const stuck = this.all<{ id: string }>("SELECT id FROM _import_batches WHERE status = 'running'");
    if (!stuck.length) return;
    this.tx(() => {
      for (const b of stuck) {
        for (const t of ['sales', 'purchases', 'expenses', 'stock_movements']) this.run(`DELETE FROM ${t} WHERE import_batch = ?`, [b.id]);
        this.run("UPDATE _import_batches SET status = 'cancelled', undone = 1 WHERE id = ?", [b.id]);
        this.run('DELETE FROM _import_undo WHERE batch_id = ?', [b.id]);
      }
    });
  }
}
