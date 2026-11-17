-- The semantic layer: the only objects the AI may query. Friendly names, rupees as REAL, no internal ids.
-- Views are dropped and recreated on every start, so a new app version can change them without a migration.

DROP VIEW IF EXISTS v_forecast;
DROP VIEW IF EXISTS v_product_performance;
DROP VIEW IF EXISTS v_daily_summary;
DROP VIEW IF EXISTS v_expenses;
DROP VIEW IF EXISTS v_purchases;
DROP VIEW IF EXISTS v_sales;
DROP VIEW IF EXISTS v_products;
DROP VIEW IF EXISTS _v_stock;

-- Internal helper: current stock and last sale per product (also includes archived products).
CREATE VIEW _v_stock AS
SELECT p.id AS product_id,
       ROUND(COALESCE(m.on_hand, 0), 3) AS on_hand,
       ls.last_sale_date
FROM products p
LEFT JOIN (SELECT product_id, SUM(qty_delta) AS on_hand FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
LEFT JOIN (SELECT product_id, MAX(sale_date) AS last_sale_date FROM sales GROUP BY product_id) ls ON ls.product_id = p.id;

CREATE VIEW v_products AS
SELECT p.sku, p.name, p.category, p.unit,
       p.cost_paise / 100.0 AS cost_price,
       p.price_paise / 100.0 AS selling_price,
       st.on_hand AS stock_on_hand,
       ROUND(st.on_hand * p.cost_paise / 100.0, 2) AS stock_value_at_cost,
       p.reorder_level,
       CASE WHEN st.on_hand <= 0 THEN 'out'
            WHEN st.on_hand <= p.reorder_level THEN 'low'
            WHEN p.reorder_level > 0 AND st.on_hand > p.reorder_level * 5 THEN 'overstock'
            ELSE 'ok' END AS stock_status,
       p.lead_time_days,
       sup.name AS supplier_name,
       st.last_sale_date,
       CAST(julianday(date('now', 'localtime')) - julianday(st.last_sale_date) AS INTEGER) AS days_since_last_sale
FROM products p
JOIN _v_stock st ON st.product_id = p.id
LEFT JOIN suppliers sup ON sup.id = p.supplier_id
WHERE p.is_active = 1;

CREATE VIEW v_sales AS
SELECT s.sale_date,
       strftime('%Y-%m', s.sale_date) AS month,
       CASE WHEN CAST(strftime('%m', s.sale_date) AS INTEGER) >= 4
            THEN 'FY' || strftime('%Y', s.sale_date) || '-' || substr(CAST(CAST(strftime('%Y', s.sale_date) AS INTEGER) + 1 AS TEXT), 3, 2)
            ELSE 'FY' || CAST(CAST(strftime('%Y', s.sale_date) AS INTEGER) - 1 AS TEXT) || '-' || substr(strftime('%Y', s.sale_date), 3, 2) END AS fy,
       CASE CAST(strftime('%w', s.sale_date) AS INTEGER)
            WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
            WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' ELSE 'Saturday' END AS weekday,
       s.invoice_no, p.sku, p.name AS product_name, p.category, c.name AS customer_name, s.qty,
       s.unit_price_paise / 100.0 AS unit_price,
       s.discount_paise / 100.0 AS discount,
       s.tax_paise / 100.0 AS tax,
       ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2) AS revenue,
       ROUND(s.qty * COALESCE(s.unit_cost_paise, p.cost_paise) / 100.0, 2) AS cogs,
       ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2)
         - ROUND(s.qty * COALESCE(s.unit_cost_paise, p.cost_paise) / 100.0, 2) AS gross_profit
FROM sales s
JOIN products p ON p.id = s.product_id
LEFT JOIN customers c ON c.id = s.customer_id;

CREATE VIEW v_purchases AS
SELECT pu.purchase_date,
       strftime('%Y-%m', pu.purchase_date) AS month,
       pu.bill_no, p.sku, p.name AS product_name, p.category, sup.name AS supplier_name, pu.qty,
       pu.unit_cost_paise / 100.0 AS unit_cost,
       ROUND(pu.qty * pu.unit_cost_paise / 100.0, 2) AS cost_total
FROM purchases pu
JOIN products p ON p.id = pu.product_id
LEFT JOIN suppliers sup ON sup.id = pu.supplier_id;

CREATE VIEW v_expenses AS
SELECT e.expense_date,
       strftime('%Y-%m', e.expense_date) AS month,
       e.category,
       e.amount_paise / 100.0 AS amount,
       e.payment_mode, e.note
FROM expenses e;

CREATE VIEW v_daily_summary AS
SELECT d.day,
       COALESCE(s.revenue, 0) AS revenue,
       COALESCE(s.cogs, 0) AS cogs,
       ROUND(COALESCE(s.revenue, 0) - COALESCE(s.cogs, 0), 2) AS gross_profit,
       COALESCE(e.expenses, 0) AS expenses,
       ROUND(COALESCE(s.revenue, 0) - COALESCE(s.cogs, 0) - COALESCE(e.expenses, 0), 2) AS net_profit,
       COALESCE(s.orders, 0) AS orders,
       COALESCE(s.units, 0) AS units
FROM (SELECT sale_date AS day FROM sales UNION SELECT expense_date FROM expenses) d
LEFT JOIN (
  SELECT s.sale_date AS day,
         ROUND(SUM(ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2)), 2) AS revenue,
         ROUND(SUM(ROUND(s.qty * COALESCE(s.unit_cost_paise, p.cost_paise) / 100.0, 2)), 2) AS cogs,
         COUNT(DISTINCT COALESCE(NULLIF(s.invoice_no, ''), 'row-' || s.id)) AS orders,
         ROUND(SUM(s.qty), 3) AS units
  FROM sales s JOIN products p ON p.id = s.product_id
  GROUP BY s.sale_date
) s ON s.day = d.day
LEFT JOIN (
  SELECT expense_date AS day, ROUND(SUM(amount_paise) / 100.0, 2) AS expenses FROM expenses GROUP BY expense_date
) e ON e.day = d.day;

CREATE VIEW v_product_performance AS
SELECT strftime('%Y-%m', s.sale_date) AS month, p.sku, p.name AS product_name, p.category,
       ROUND(SUM(s.qty), 3) AS units,
       ROUND(SUM(ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2)), 2) AS revenue,
       ROUND(SUM(ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2))
           - SUM(ROUND(s.qty * COALESCE(s.unit_cost_paise, p.cost_paise) / 100.0, 2)), 2) AS gross_profit,
       CASE WHEN SUM(s.qty * s.unit_price_paise - s.discount_paise) > 0
            THEN ROUND(100.0 * (SUM(ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2))
                 - SUM(ROUND(s.qty * COALESCE(s.unit_cost_paise, p.cost_paise) / 100.0, 2)))
                 / SUM(ROUND((s.qty * s.unit_price_paise - s.discount_paise) / 100.0, 2)), 2)
            ELSE NULL END AS margin_pct
FROM sales s
JOIN products p ON p.id = s.product_id
GROUP BY strftime('%Y-%m', s.sale_date), p.id;

-- Forecasts are computed in TypeScript (analytics worker) and stored in _forecast; this view just names them.
CREATE VIEW v_forecast AS
SELECT p.sku, p.name AS product_name, p.category, st.on_hand AS stock_on_hand,
       f.avg_daily_demand, f.forecast_7d, f.forecast_30d, f.days_of_cover, f.predicted_stockout_date,
       f.reorder_point, f.suggested_reorder_qty, f.method, f.confidence
FROM _forecast f
JOIN products p ON p.id = f.product_id
JOIN _v_stock st ON st.product_id = p.id
WHERE p.is_active = 1;
