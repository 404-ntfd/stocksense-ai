-- StockSense AI base schema (version 1).
-- Base tables are the single source of truth: money is integer paise, stock is a ledger of movements.
-- The AI never sees these tables; it only sees the views in views.sql.

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, phone TEXT, email TEXT, import_batch TEXT);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT, phone TEXT, import_batch TEXT);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT 'Uncategorised',
  unit TEXT DEFAULT 'pcs', cost_paise INTEGER DEFAULT 0, price_paise INTEGER DEFAULT 0, reorder_level REAL DEFAULT 0,
  lead_time_days INTEGER DEFAULT 7, supplier_id INTEGER REFERENCES suppliers(id), is_active INTEGER DEFAULT 1,
  import_batch TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT, extra TEXT);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY, invoice_no TEXT, sale_date TEXT NOT NULL /*YYYY-MM-DD*/, product_id INTEGER NOT NULL REFERENCES products(id),
  customer_id INTEGER REFERENCES customers(id), qty REAL NOT NULL CHECK(qty > 0), unit_price_paise INTEGER NOT NULL,
  discount_paise INTEGER DEFAULT 0, tax_paise INTEGER DEFAULT 0, unit_cost_paise INTEGER /*snapshot at sale*/, import_batch TEXT, extra TEXT);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, bill_no TEXT, purchase_date TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id),
  supplier_id INTEGER REFERENCES suppliers(id), qty REAL NOT NULL CHECK(qty > 0), unit_cost_paise INTEGER NOT NULL,
  tax_paise INTEGER DEFAULT 0, import_batch TEXT, extra TEXT);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), move_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('opening','purchase','sale','return_in','return_out','adjustment','damage','count')),
  qty_delta REAL NOT NULL, ref_table TEXT, ref_id INTEGER, note TEXT, import_batch TEXT);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, expense_date TEXT NOT NULL, category TEXT NOT NULL, amount_paise INTEGER NOT NULL,
  note TEXT, payment_mode TEXT, import_batch TEXT, extra TEXT);

-- Internal bookkeeping (names start with "_": never exposed to the AI).
CREATE TABLE IF NOT EXISTS _import_batches (
  id TEXT PRIMARY KEY, file_name TEXT, target TEXT, mode TEXT, rows_ok INTEGER DEFAULT 0, rows_failed INTEGER DEFAULT 0,
  created_at TEXT, undone INTEGER DEFAULT 0, status TEXT DEFAULT 'done' /*running|done|cancelled|undone*/,
  file_hash TEXT, created_products INTEGER DEFAULT 0, custom_table TEXT, warnings TEXT);
CREATE TABLE IF NOT EXISTS _import_undo (
  batch_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id INTEGER NOT NULL, old_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS _meta_tables (table_name TEXT PRIMARY KEY, display_name TEXT, description TEXT, is_custom INTEGER);
CREATE TABLE IF NOT EXISTS _meta_columns (
  table_name TEXT, column_name TEXT, display_name TEXT, description TEXT, sem_type TEXT /*date|money|qty|category|id|text|number*/,
  PRIMARY KEY(table_name, column_name));
CREATE TABLE IF NOT EXISTS _qa_log (id INTEGER PRIMARY KEY, asked_at TEXT, question TEXT, sql TEXT, ok INTEGER, ms INTEGER, feedback INTEGER, route TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS _settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS _schema_version (v INTEGER);
CREATE TABLE IF NOT EXISTS _kpi_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, computed_at TEXT);
CREATE TABLE IF NOT EXISTS _forecast (
  product_id INTEGER PRIMARY KEY REFERENCES products(id), avg_daily_demand REAL, forecast_7d REAL, forecast_30d REAL,
  band_low_30d REAL, band_high_30d REAL, days_of_cover REAL, predicted_stockout_date TEXT, suggested_reorder_qty REAL,
  reorder_point REAL, safety_stock REAL, method TEXT, confidence TEXT, wape REAL, history_days INTEGER, computed_at TEXT);

-- Every sale and purchase writes (and on delete removes) its own stock movement, so stock is always auditable.
CREATE TRIGGER IF NOT EXISTS trg_sales_ai AFTER INSERT ON sales BEGIN
  INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, ref_table, ref_id, import_batch)
  VALUES (NEW.product_id, NEW.sale_date, 'sale', -NEW.qty, 'sales', NEW.id, NEW.import_batch);
END;
CREATE TRIGGER IF NOT EXISTS trg_sales_ad AFTER DELETE ON sales BEGIN
  DELETE FROM stock_movements WHERE ref_table = 'sales' AND ref_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_sales_au AFTER UPDATE OF qty, sale_date, product_id ON sales BEGIN
  UPDATE stock_movements SET qty_delta = -NEW.qty, move_date = NEW.sale_date, product_id = NEW.product_id
  WHERE ref_table = 'sales' AND ref_id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_purchases_ai AFTER INSERT ON purchases BEGIN
  INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, ref_table, ref_id, import_batch)
  VALUES (NEW.product_id, NEW.purchase_date, 'purchase', NEW.qty, 'purchases', NEW.id, NEW.import_batch);
END;
CREATE TRIGGER IF NOT EXISTS trg_purchases_ad AFTER DELETE ON purchases BEGIN
  DELETE FROM stock_movements WHERE ref_table = 'purchases' AND ref_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_purchases_au AFTER UPDATE OF qty, purchase_date, product_id ON purchases BEGIN
  UPDATE stock_movements SET qty_delta = NEW.qty, move_date = NEW.purchase_date, product_id = NEW.product_id
  WHERE ref_table = 'purchases' AND ref_id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_product_date ON sales(product_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sales_batch ON sales(import_batch);
CREATE INDEX IF NOT EXISTS idx_purchases_product_date ON purchases(product_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_batch ON purchases(import_batch);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id, move_date, qty_delta);
CREATE INDEX IF NOT EXISTS idx_moves_ref ON stock_movements(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_moves_batch ON stock_movements(import_batch);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
