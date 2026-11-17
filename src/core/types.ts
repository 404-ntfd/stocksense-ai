// Shared types for the data, import, analytics and ask layers.

export type Row = Record<string, unknown>;

export interface QueryResult<T = Row> {
  columns: string[];
  rows: T[];
  /** True when more rows existed than maxRows allowed. */
  truncated: boolean;
  ms: number;
}

export interface QueryOpts { readOnly?: boolean; timeoutMs?: number; maxRows?: number }

// ---------- import ----------
export type ImportTarget = 'products' | 'sales' | 'purchases' | 'expenses' | 'stock_count' | 'custom';
export type ImportMode = 'append' | 'upsert' | 'replace';

export interface RowError { row: number; column?: string; code: string; message: string; raw?: unknown[] }

export interface ImportReport {
  batchId: string;
  target: ImportTarget;
  mode: ImportMode;
  fileName: string;
  rowsOk: number;
  rowsFailed: number;
  createdProducts: number;
  warnings: string[];
  errors: RowError[];
  customTable?: string;
  cancelled?: boolean;
  ms: number;
}

export interface ImportBatchInfo {
  id: string; file_name: string; target: string; mode: string; rows_ok: number; rows_failed: number;
  created_at: string; status: string; created_products: number; custom_table: string | null;
}

export interface ColumnSpec { name: string; display: string; type: 'INTEGER' | 'REAL' | 'TEXT' | 'DATE'; semType: SemType; description: string }
export type SemType = 'date' | 'money' | 'qty' | 'category' | 'id' | 'text' | 'number';

export interface ImportMeta {
  fileName: string;
  fileHash?: string;
  /** Only for target === 'custom'. */
  custom?: { tableName: string; displayName: string; columns: ColumnSpec[] };
  /** Row-level errors found before the rows reached the database (coercion). */
  preErrors?: RowError[];
  preWarnings?: string[];
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
  total?: number;
}

// ---------- schema shown to the LLM ----------
export interface SchemaColumn { name: string; type: string; description: string; samples?: string[] }
export interface SchemaTable { name: string; description: string; grain: string; columns: SchemaColumn[]; isCustom: boolean; rowCount?: number }
export interface SchemaDoc { tables: SchemaTable[] }

// ---------- product / inventory ----------
export interface ProductRow {
  id: number; sku: string; name: string; category: string; unit: string;
  cost: number; price: number; stock: number; reorder_level: number; lead_time_days: number;
  status: 'out' | 'low' | 'ok' | 'overstock'; supplier: string | null; is_active: number;
  last_sale_date: string | null; days_of_cover: number | null; avg_daily_demand: number | null;
}

export interface ProductInput {
  sku?: string; name: string; category?: string; unit?: string; cost?: number; price?: number;
  reorder_level?: number; lead_time_days?: number; supplier?: string; opening_stock?: number;
}

export type AdjustKind = 'count' | 'damage' | 'return_in' | 'return_out' | 'adjustment';

// ---------- analytics ----------
export interface Kpi { value: number | null; prev: number | null; deltaPct: number | null }

export interface DashboardData {
  asOf: string;
  range: { from: string; to: string; prevFrom: string; prevTo: string; label: string; key: string };
  hasData: boolean;
  kpis: {
    revenue: Kpi; grossProfit: Kpi; marginPct: Kpi; netProfit: Kpi; orders: Kpi; avgOrderValue: Kpi; units: Kpi; expenses: Kpi;
    inventoryValue: number; lowStock: number; outOfStock: number; deadStockValue: number; deadStockPct: number | null; productCount: number;
  };
  trend: Array<{ day: string; revenue: number; gross_profit: number }>;
  monthly: Array<{ month: string; revenue: number; gross_profit: number }>;
  topProducts: Array<{ name: string; sku: string; revenue: number; units: number; gross_profit: number }>;
  categories: Array<{ category: string; revenue: number }>;
  lowStockList: Array<{ id: number; name: string; sku: string; stock: number; reorder_level: number; unit: string; status: string }>;
}

export interface ForecastResult {
  product_id: number;
  avg_daily_demand: number;
  forecast_7d: number;
  forecast_30d: number;
  band_low_30d: number;
  band_high_30d: number;
  days_of_cover: number | null;
  predicted_stockout_date: string | null;
  suggested_reorder_qty: number;
  reorder_point: number;
  safety_stock: number;
  method: 'holt' | 'croston' | 'moving_average';
  confidence: 'high' | 'medium' | 'low';
  wape: number | null;
  history_days: number;
  /** Daily forecast for the next 30 days (used by the product chart, not stored). */
  daily?: number[];
  sigma?: number;
}

export interface ForecastInput {
  today: string;
  products: Array<{ id: number; stock: number; lead_time_days: number; first_sale: string; series: number[] }>;
}

// ---------- ask ----------
export interface ChartSpec {
  type: 'kpi' | 'line' | 'bar' | 'hbar' | 'donut' | 'scatter' | 'table' | 'forecast';
  x?: string;
  y?: string[];
  series?: string | null;
  /** Rows after top-N + "Others" folding etc. */
  rows?: Row[];
  movingAverage?: boolean;
}

export interface Turn { question: string; sql?: string; resultShape?: string; answer?: string }
