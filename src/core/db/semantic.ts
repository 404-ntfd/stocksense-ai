// Plain-English descriptions of the AI-facing views. Schema quality matters more than model size,
// so every column the model may use is described here once and reused in prompts, docs and the UI.

export interface ViewDoc {
  name: string;
  grain: string;
  description: string;
  columns: Array<{ name: string; type: string; description: string; sample?: boolean }>;
}

export const VIEW_DOCS: ViewDoc[] = [
  {
    name: 'v_products',
    grain: 'one row per active product',
    description: 'Product master with live stock. Use for stock levels, stock value, prices, low/out-of-stock and dead-stock questions.',
    columns: [
      { name: 'sku', type: 'TEXT', description: 'Unique product code' },
      { name: 'name', type: 'TEXT', description: 'Product name, e.g. "Sugar 1kg"' },
      { name: 'category', type: 'TEXT', description: 'Product category', sample: true },
      { name: 'unit', type: 'TEXT', description: 'Selling unit (pcs, kg, l, pkt)', sample: true },
      { name: 'cost_price', type: 'REAL', description: 'Purchase cost per unit in rupees' },
      { name: 'selling_price', type: 'REAL', description: 'Selling price per unit in rupees' },
      { name: 'stock_on_hand', type: 'REAL', description: 'Units in stock right now ("stock")' },
      { name: 'stock_value_at_cost', type: 'REAL', description: 'stock_on_hand x cost_price in rupees (inventory value)' },
      { name: 'reorder_level', type: 'REAL', description: 'Stock level at or below which the product counts as low' },
      { name: 'stock_status', type: 'TEXT', description: "'out' (stock <= 0), 'low' (stock <= reorder_level), 'ok', or 'overstock' (stock > 5 x reorder_level)", sample: true },
      { name: 'lead_time_days', type: 'INTEGER', description: 'Days the supplier takes to deliver' },
      { name: 'supplier_name', type: 'TEXT', description: 'Usual supplier', sample: true },
      { name: 'last_sale_date', type: 'TEXT', description: 'Date of the most recent sale (YYYY-MM-DD), NULL if never sold' },
      { name: 'days_since_last_sale', type: 'INTEGER', description: 'Days since last_sale_date; 30+ is slow moving, 90+ is dead stock' },
    ],
  },
  {
    name: 'v_sales',
    grain: 'one row per sale line (one product on one invoice)',
    description: 'Every sale line with revenue, cost and profit. Use for sales, revenue, profit, margin, best sellers and customer questions.',
    columns: [
      { name: 'sale_date', type: 'TEXT', description: 'Sale date, YYYY-MM-DD' },
      { name: 'month', type: 'TEXT', description: 'YYYY-MM of the sale' },
      { name: 'fy', type: 'TEXT', description: "Indian financial year (April-March), e.g. 'FY2026-27'" },
      { name: 'weekday', type: 'TEXT', description: "Day name, e.g. 'Sunday'" },
      { name: 'invoice_no', type: 'TEXT', description: 'Invoice/bill number; one invoice (order) has one or more lines' },
      { name: 'sku', type: 'TEXT', description: 'Product code' },
      { name: 'product_name', type: 'TEXT', description: 'Product name' },
      { name: 'category', type: 'TEXT', description: 'Product category', sample: true },
      { name: 'customer_name', type: 'TEXT', description: 'Customer name, NULL for walk-in customers' },
      { name: 'qty', type: 'REAL', description: 'Units sold on this line' },
      { name: 'unit_price', type: 'REAL', description: 'Selling price per unit in rupees on this line' },
      { name: 'discount', type: 'REAL', description: 'Discount given on this line in rupees' },
      { name: 'tax', type: 'REAL', description: 'Tax (GST) on this line in rupees, not included in revenue' },
      { name: 'revenue', type: 'REAL', description: 'Sales amount in rupees after discount, excluding tax ("sales")' },
      { name: 'cogs', type: 'REAL', description: 'Cost of the goods sold in rupees' },
      { name: 'gross_profit', type: 'REAL', description: 'revenue - cogs in rupees ("profit")' },
    ],
  },
  {
    name: 'v_purchases',
    grain: 'one row per purchase line',
    description: 'Stock bought from suppliers. Use for purchase totals and supplier questions.',
    columns: [
      { name: 'purchase_date', type: 'TEXT', description: 'Purchase date, YYYY-MM-DD' },
      { name: 'month', type: 'TEXT', description: 'YYYY-MM of the purchase' },
      { name: 'bill_no', type: 'TEXT', description: 'Supplier bill number' },
      { name: 'sku', type: 'TEXT', description: 'Product code' },
      { name: 'product_name', type: 'TEXT', description: 'Product name' },
      { name: 'category', type: 'TEXT', description: 'Product category', sample: true },
      { name: 'supplier_name', type: 'TEXT', description: 'Supplier name', sample: true },
      { name: 'qty', type: 'REAL', description: 'Units purchased' },
      { name: 'unit_cost', type: 'REAL', description: 'Cost per unit in rupees' },
      { name: 'cost_total', type: 'REAL', description: 'qty x unit_cost in rupees' },
    ],
  },
  {
    name: 'v_expenses',
    grain: 'one row per expense entry',
    description: 'Running costs such as rent, salary, electricity and transport.',
    columns: [
      { name: 'expense_date', type: 'TEXT', description: 'Expense date, YYYY-MM-DD' },
      { name: 'month', type: 'TEXT', description: 'YYYY-MM of the expense' },
      { name: 'category', type: 'TEXT', description: 'Expense category', sample: true },
      { name: 'amount', type: 'REAL', description: 'Amount in rupees' },
      { name: 'payment_mode', type: 'TEXT', description: 'How it was paid', sample: true },
      { name: 'note', type: 'TEXT', description: 'Free-text note' },
    ],
  },
  {
    name: 'v_daily_summary',
    grain: 'one row per calendar day that has sales or expenses',
    description: 'Daily totals. The best view for totals, trends, net profit and order counts over a period.',
    columns: [
      { name: 'day', type: 'TEXT', description: 'Date, YYYY-MM-DD' },
      { name: 'revenue', type: 'REAL', description: 'Total sales in rupees' },
      { name: 'cogs', type: 'REAL', description: 'Total cost of goods sold in rupees' },
      { name: 'gross_profit', type: 'REAL', description: 'revenue - cogs' },
      { name: 'expenses', type: 'REAL', description: 'Total expenses in rupees' },
      { name: 'net_profit', type: 'REAL', description: 'gross_profit - expenses' },
      { name: 'orders', type: 'INTEGER', description: 'Number of invoices (orders)' },
      { name: 'units', type: 'REAL', description: 'Total units sold' },
    ],
  },
  {
    name: 'v_product_performance',
    grain: 'one row per product per month',
    description: 'Monthly units, revenue, profit and margin per product.',
    columns: [
      { name: 'month', type: 'TEXT', description: 'YYYY-MM' },
      { name: 'sku', type: 'TEXT', description: 'Product code' },
      { name: 'product_name', type: 'TEXT', description: 'Product name' },
      { name: 'category', type: 'TEXT', description: 'Product category', sample: true },
      { name: 'units', type: 'REAL', description: 'Units sold in the month' },
      { name: 'revenue', type: 'REAL', description: 'Revenue in rupees in the month' },
      { name: 'gross_profit', type: 'REAL', description: 'Gross profit in rupees in the month' },
      { name: 'margin_pct', type: 'REAL', description: 'gross_profit / revenue x 100' },
    ],
  },
  {
    name: 'v_forecast',
    grain: 'one row per product that has enough sales history',
    description: 'Demand estimates computed by the app from past sales. Read-only; prefer the forecast/reorder tools for these questions.',
    columns: [
      { name: 'sku', type: 'TEXT', description: 'Product code' },
      { name: 'product_name', type: 'TEXT', description: 'Product name' },
      { name: 'category', type: 'TEXT', description: 'Product category', sample: true },
      { name: 'stock_on_hand', type: 'REAL', description: 'Units in stock now' },
      { name: 'avg_daily_demand', type: 'REAL', description: 'Average units sold per day over the last 28 days' },
      { name: 'forecast_7d', type: 'REAL', description: 'Estimated units sold in the next 7 days' },
      { name: 'forecast_30d', type: 'REAL', description: 'Estimated units sold in the next 30 days' },
      { name: 'days_of_cover', type: 'REAL', description: 'Days the current stock will last at the average daily demand' },
      { name: 'predicted_stockout_date', type: 'TEXT', description: 'Estimated date the stock runs out (YYYY-MM-DD), NULL if not within 180 days' },
      { name: 'reorder_point', type: 'REAL', description: 'Stock level at which to reorder (demand over lead time + safety stock)' },
      { name: 'suggested_reorder_qty', type: 'REAL', description: 'Suggested quantity to order now (0 if none needed)' },
      { name: 'method', type: 'TEXT', description: "Forecast method: 'holt', 'croston' or 'moving_average'" },
      { name: 'confidence', type: 'TEXT', description: "'high', 'medium' or 'low' from a 14-day backtest" },
    ],
  },
];

/** Names the SQL guard allows (plus any `u_` custom table). */
export const ALLOWED_VIEWS: string[] = VIEW_DOCS.map((v) => v.name);

/** Base tables shown in the Data screen, with friendly names. */
export const BASE_TABLES: Array<{ name: string; label: string; dateCol?: string }> = [
  { name: 'products', label: 'Products' },
  { name: 'sales', label: 'Sales', dateCol: 'sale_date' },
  { name: 'purchases', label: 'Purchases', dateCol: 'purchase_date' },
  { name: 'expenses', label: 'Expenses', dateCol: 'expense_date' },
  { name: 'stock_movements', label: 'Stock movements', dateCol: 'move_date' },
  { name: 'suppliers', label: 'Suppliers' },
  { name: 'customers', label: 'Customers' },
];
