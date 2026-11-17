// Builds the seeded demo business and prints the figures used to hand-check KPIs and the golden set.
//   npm run demo:samples [-- 2026-11-17]
// The app itself generates the same data on demand (Data → Load demo data); samples/ files come from
// scripts/generate-fixtures.ts.
import initSqlJs from 'sql.js';
import { DbEngine } from '../src/core/db/engine';
import { buildApi } from '../src/core/db/api';
import { todayISO } from '../src/core/util/dates';

const today = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? todayISO();
const api = buildApi(new DbEngine(await initSqlJs()));
const r = api.loadDemo(today);
console.log(`Demo shop for ${today}: ${r.products} products, ${r.sales} sale lines, ${r.purchases} purchase lines, ${r.expenses} expenses (${r.ms} ms)`);
const d = api.dashboard('month', today);
console.log('This month:', JSON.stringify({ revenue: d.kpis.revenue.value, grossProfit: d.kpis.grossProfit.value, netProfit: d.kpis.netProfit.value, orders: d.kpis.orders.value, lowStock: d.kpis.lowStock, outOfStock: d.kpis.outOfStock, inventoryValue: d.kpis.inventoryValue, deadStockValue: d.kpis.deadStockValue }));
console.log('By month:', JSON.stringify(api.query('SELECT month, ROUND(SUM(revenue)) AS revenue, ROUND(SUM(gross_profit)) AS gross_profit FROM v_sales GROUP BY month ORDER BY month DESC LIMIT 6').rows));
console.log('Stock status:', JSON.stringify(api.query('SELECT stock_status, COUNT(*) AS n FROM v_products GROUP BY 1').rows));
