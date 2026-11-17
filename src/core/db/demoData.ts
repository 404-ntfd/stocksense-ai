// Deterministic demo business: "Sree Krishna Stores, Thrissur", a general store with 150 products in
// 12 categories, 25 suppliers and 18 months of daily sales ending today. The generator is seeded, so the
// same `today` always produces the same data (tests and the golden eval rely on that).
import type { DbEngine } from './engine';
import { addDays, diffDays, endOfMonth, weekdayOf } from '../util/dates';
import { toPaise } from '../util/money';

export const DEMO_BUSINESS = 'Sree Krishna Stores';
export const DEMO_DAYS = 548;

type Variant = [size: string, price: number, demand: number];
type Item = [name: string, variants: Variant[]];
interface Cat { name: string; code: string; unit: string; margin: number; lead: number; items: Item[] }

const CATALOG: Cat[] = [
  { name: 'Rice & Grains', code: 'RG', unit: 'pkt', margin: 0.13, lead: 5, items: [
    ['Matta Rice', [['1kg', 62, 2.2], ['5kg', 295, 1.6], ['10kg', 570, 0.7], ['25kg', 1380, 0.2]]],
    ['Jaya Rice', [['5kg', 260, 0.9], ['10kg', 505, 0.4]]],
    ['India Gate Basmati Rice', [['1kg', 145, 0.7], ['5kg', 690, 0.2]]],
    ['Ponni Raw Rice', [['5kg', 310, 0.5], ['10kg', 600, 0.2]]],
    ['Rava (Sooji)', [['500g', 32, 0.9], ['1kg', 60, 0.5]]],
    ['Poha (Aval)', [['500g', 38, 0.4]]],
  ] },
  { name: 'Atta & Flour', code: 'AF', unit: 'pkt', margin: 0.12, lead: 5, items: [
    ['Aashirvaad Atta', [['1kg', 62, 1.8], ['5kg', 285, 1.5], ['10kg', 540, 0.4]]],
    ['Pillsbury Atta', [['5kg', 275, 0.4]]],
    ['Maida', [['500g', 28, 0.8], ['1kg', 52, 0.5]]],
    ['Double Horse Rice Flour', [['1kg', 68, 0.6]]],
    ['Besan', [['500g', 62, 0.5], ['1kg', 118, 0.2]]],
    ['Puttu Podi', [['1kg', 78, 0.9]]],
    ['Ragi Flour', [['500g', 48, 0.15]]],
  ] },
  { name: 'Pulses', code: 'PL', unit: 'pkt', margin: 0.14, lead: 6, items: [
    ['Toor Dal', [['500g', 88, 0.9], ['1kg', 170, 1.4]]],
    ['Moong Dal', [['500g', 72, 0.6], ['1kg', 138, 0.5]]],
    ['Urad Dal', [['500g', 80, 0.7], ['1kg', 155, 0.6]]],
    ['Chana Dal', [['500g', 52, 0.4], ['1kg', 98, 0.3]]],
    ['Green Gram', [['500g', 68, 0.6], ['1kg', 130, 0.4]]],
    ['Kabuli Chana', [['500g', 78, 0.15]]],
    ['Rajma', [['500g', 85, 0.15]]],
  ] },
  { name: 'Oils & Ghee', code: 'OG', unit: 'btl', margin: 0.1, lead: 4, items: [
    ['KLF Nirmal Coconut Oil', [['500ml', 135, 1.5], ['1L', 265, 1.9]]],
    ['Fortune Sunflower Oil', [['1L', 148, 1.6], ['5L', 720, 0.2]]],
    ['Palm Oil', [['1L', 112, 0.9]]],
    ['Idhayam Gingelly Oil', [['500ml', 210, 0.3]]],
    ['Mustard Oil', [['1L', 185, 0.12]]],
    ['Milma Ghee', [['200ml', 165, 0.5], ['500ml', 395, 0.2]]],
    ['Dalda Vanaspati', [['1L', 160, 0.15]]],
  ] },
  { name: 'Spices', code: 'SP', unit: 'pkt', margin: 0.24, lead: 7, items: [
    ['Eastern Chilli Powder', [['100g', 38, 1.1], ['250g', 90, 0.5]]],
    ['Eastern Turmeric Powder', [['100g', 32, 0.8], ['250g', 75, 0.3]]],
    ['Eastern Coriander Powder', [['100g', 30, 0.8], ['250g', 70, 0.3]]],
    ['Eastern Sambar Powder', [['100g', 45, 0.6]]],
    ['Garam Masala', [['100g', 68, 0.3]]],
    ['Black Pepper', [['100g', 95, 0.3]]],
    ['Mustard Seeds', [['100g', 22, 0.5]]],
    ['Cumin (Jeera)', [['100g', 58, 0.4]]],
    ['Cardamom', [['50g', 185, 0.12]]],
    ['Chicken Masala', [['100g', 55, 0.5]]],
    ['Fish Masala', [['100g', 52, 0.4]]],
  ] },
  { name: 'Sugar & Salt', code: 'SS', unit: 'pkt', margin: 0.09, lead: 4, items: [
    ['Sugar', [['1kg', 46, 6.5], ['5kg', 225, 0.7]]],
    ['Jaggery', [['500g', 42, 0.6], ['(loose)', 80, 0.5]]],
    ['Tata Salt', [['1kg', 28, 2.4]]],
    ['Crystal Salt', [['(loose)', 18, 0.6]]],
    ['Brown Sugar', [['500g', 55, 0.15]]],
    ['Sugar Cubes', [['500g', 60, 0.12]]],
  ] },
  { name: 'Tea & Coffee', code: 'TC', unit: 'pkt', margin: 0.16, lead: 7, items: [
    ['Tata Tea Gold', [['250g', 150, 1.3], ['500g', 290, 0.5]]],
    ['Kanan Devan Tea', [['250g', 120, 1.1], ['500g', 235, 0.4]]],
    ['Red Label Tea', [['250g', 140, 0.5]]],
    ['AVT Premium Tea', [['250g', 115, 0.4]]],
    ['Bru Instant Coffee', [['50g', 105, 0.6], ['100g', 200, 0.3]]],
    ['Nescafe Classic', [['50g', 175, 0.12]]],
    ['Filter Coffee Powder', [['200g', 130, 0.3]]],
    ['Boost', [['500g', 265, 0.3]]],
    ['Horlicks', [['500g', 275, 0.4]]],
  ] },
  { name: 'Snacks & Biscuits', code: 'SB', unit: 'pkt', margin: 0.19, lead: 5, items: [
    ['Parle-G Biscuit', [['100g', 10, 8.5], ['250g', 25, 2.2], ['800g', 80, 0.5]]],
    ['Tiger Biscuit', [['100g', 10, 2.6]]],
    ['Good Day Cashew', [['200g', 40, 1.2]]],
    ['Marie Gold', [['250g', 35, 1.0]]],
    ['Bourbon', [['150g', 30, 0.8]]],
    ['Hide & Seek', [['120g', 35, 0.12]]],
    ['Lays Classic', [['52g', 20, 2.8]]],
    ['Kurkure Masala Munch', [['90g', 20, 2.1]]],
    ['Banana Chips', [['200g', 85, 1.2], ['(loose)', 400, 0.3]]],
    ['Mixture', [['200g', 55, 0.9]]],
    ['Maggi Noodles', [['70g', 14, 5.5], ['280g', 56, 1.1]]],
  ] },
  { name: 'Beverages', code: 'BV', unit: 'btl', margin: 0.17, lead: 3, items: [
    ['Coca-Cola', [['750ml', 40, 2.2], ['2L', 95, 0.8]]],
    ['Pepsi', [['750ml', 40, 1.2]]],
    ['Sprite', [['750ml', 40, 1.1]]],
    ['Frooti', [['200ml', 10, 3.2], ['1L', 65, 0.5]]],
    ['Maaza', [['600ml', 40, 0.9]]],
    ['Bisleri Water', [['1L', 20, 6.0], ['2L', 30, 1.8]]],
    ['Tropicana Orange', [['1L', 120, 0.12]]],
    ['Real Mixed Fruit', [['1L', 115, 0.2]]],
    ['Soda', [['750ml', 20, 1.4]]],
  ] },
  { name: 'Dairy & Bakery', code: 'DB', unit: 'pkt', margin: 0.11, lead: 2, items: [
    ['Milma Milk', [['500ml', 28, 14]]],
    ['Milma Curd', [['500g', 35, 4.2]]],
    ['Amul Butter', [['100g', 58, 1.3], ['500g', 280, 0.2]]],
    ['Amul Cheese Slices', [['200g', 140, 0.12]]],
    ['Paneer', [['200g', 90, 0.6]]],
    ['Milkmaid', [['400g', 145, 0.2]]],
    ['Amul Milk Powder', [['500g', 245, 0.2]]],
    ['Eggs', [['(tray of 30)', 195, 1.6], ['(pack of 6)', 42, 4.5]]],
    ['Modern Bread', [['400g', 45, 5.0]]],
  ] },
  { name: 'Personal Care', code: 'PC', unit: 'pcs', margin: 0.21, lead: 8, items: [
    ['Lifebuoy Soap', [['100g', 32, 1.6], ['4x100g', 120, 0.4]]],
    ['Lux Soap', [['100g', 38, 1.1]]],
    ['Medimix Soap', [['125g', 45, 0.9]]],
    ['Chandrika Soap', [['75g', 36, 0.8]]],
    ['Colgate Toothpaste', [['100g', 62, 1.2], ['200g', 115, 0.5]]],
    ['Closeup', [['150g', 98, 0.3]]],
    ['Clinic Plus Shampoo', [['175ml', 110, 0.5]]],
    ['Sunsilk Shampoo', [['180ml', 145, 0.3]]],
    ['Parachute Hair Oil', [['100ml', 48, 0.9], ['250ml', 115, 0.4]]],
    ['Dettol Handwash', [['200ml', 99, 0.4]]],
    ['Vaseline Lotion', [['100ml', 95, 0.12]]],
    ['Gillette Guard Razor', [['1pc', 30, 0.5]]],
    ['Stayfree', [['8 pads', 45, 0.6]]],
  ] },
  { name: 'Household', code: 'HH', unit: 'pcs', margin: 0.18, lead: 8, items: [
    ['Surf Excel', [['500g', 75, 1.0], ['1kg', 145, 1.2]]],
    ['Ariel', [['1kg', 160, 0.4]]],
    ['Rin Bar', [['250g', 25, 1.5]]],
    ['Vim Bar', [['200g', 20, 2.0]]],
    ['Vim Liquid', [['500ml', 115, 0.4]]],
    ['Harpic', [['500ml', 99, 0.5]]],
    ['Lizol', [['500ml', 115, 0.4]]],
    ['Colin', [['500ml', 105, 0.12]]],
    ['Good Knight Refill', [['45ml', 85, 0.6]]],
    ['Mortein Coil', [['10pc', 38, 0.7]]],
    ['Cycle Agarbatti', [['1 pack', 20, 1.4]]],
    ['Match Box', [['pack of 10', 20, 1.0]]],
    ['Candle', [['pack of 6', 30, 0.3]]],
    ['Scotch-Brite Scrub', [['1pc', 28, 0.6]]],
    ['Phenyl', [['1L', 70, 0.4]]],
  ] },
];

const SUPPLIERS = [
  'Thrissur Rice Mart', 'Palakkad Grain Traders', 'Kerala Agro Distributors', 'Malabar Flour Mills', 'Sakthan Pulses Agency',
  'Chalakudy Oil Depot', 'KLF Distributors', 'Eastern Condiments Agency', 'Spice Route Traders', 'Guruvayur Sugar Depot',
  'Tata Consumer Distributors', 'Harrisons Tea Agency', 'Parle Agencies Thrissur', 'Britannia Distributors', 'ITC Foods Agency',
  'PepsiCo Stockist', 'Hindustan Coca-Cola Agency', 'Aqua Kerala Supplies', 'Milma Dairy Depot', 'Amul Agency Thrissur',
  'HUL Stockist Thrissur', 'Colgate Palmolive Agency', 'Marico Distributors', 'Reckitt Agency', 'Poorna Household Supplies',
];
// which suppliers (indexes into SUPPLIERS) serve each category
const CAT_SUPPLIERS: Record<string, number[]> = {
  RG: [0, 1], AF: [3, 2], PL: [4, 2], OG: [5, 6], SP: [7, 8], SS: [9, 2], TC: [10, 11], SB: [12, 13, 14], BV: [15, 16, 17], DB: [18, 19], PC: [20, 21, 22], HH: [23, 24, 20],
};
const CUSTOMERS = [
  'Anil Kumar', 'Lakshmi Menon', 'Hotel Annapoorna', 'Rajan Tea Stall', 'Sreedevi Nair', 'Thomas Varghese', 'Fathima Beevi', 'Suresh Babu',
  'Geetha Catering', 'Vinod Krishnan', 'Mary Joseph', 'Abdul Rasheed', 'Devi Bakery', 'Priya Unnikrishnan', 'Ramesh Pillai', 'St. Marys Convent',
  'Kavitha Mohan', 'Jose Antony', 'Sunitha Rajan', 'Hari Tuition Centre', 'Bindu Sasi', 'Manoj Varma', 'Ayyappa Temple Trust', 'Shaji Mathew',
];
const DEAD = ['Sugar Cubes 500g', 'Kabuli Chana 500g', 'Ragi Flour 500g', 'Cardamom 50g', 'Nescafe Classic 50g', 'Hide & Seek 120g', 'Tropicana Orange 1L', 'Amul Cheese Slices 200g', 'Vaseline Lotion 100ml', 'Colin 500ml'];
const LOW = ['Sugar 1kg', 'Parle-G Biscuit 100g', 'Milma Milk 500ml', 'Aashirvaad Atta 5kg', 'KLF Nirmal Coconut Oil 1L', 'Tata Tea Gold 250g', 'Maggi Noodles 70g', 'Surf Excel 1kg'];
const OUT = ['Eggs (tray of 30)', 'Bisleri Water 1L', 'Toor Dal 1kg'];
const OVER = ['Match Box pack of 10', 'Candle pack of 6', 'Mustard Oil 1L'];
// Festival dates (Thiruvonam, Diwali) for the years the demo can cover.
const FESTIVALS = ['2024-09-15', '2024-11-01', '2025-09-05', '2025-10-20', '2026-08-26', '2026-11-08', '2027-09-12', '2027-10-29', '2028-09-01', '2028-10-17', '2029-08-22', '2029-11-05'];
const WEEKDAY_FACTOR = [1.5, 0.85, 0.9, 0.95, 0.95, 1.05, 1.25]; // Sunday peak

export interface DemoProduct { sku: string; name: string; category: string; unit: string; cost: number; price: number; reorder_level: number; lead_time_days: number; supplier: number; opening: number; tag: 'dead' | 'low' | 'out' | 'over' | 'ok'; demand: number }
export interface DemoSale { date: string; invoice_no: string; p: number; qty: number; price: number; discount: number; customer: number }
export interface DemoPurchase { date: string; bill_no: string; p: number; qty: number; cost: number; supplier: number }
export interface DemoExpense { date: string; category: string; amount: number; note: string; mode: string }
export interface DemoData { business: string; today: string; start: string; suppliers: string[]; customers: string[]; products: DemoProduct[]; sales: DemoSale[]; purchases: DemoPurchase[]; expenses: DemoExpense[] }

/** mulberry32: tiny seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

export function generateDemo(today: string, seed = 20261117): DemoData {
  const rand = rng(seed);
  const N = DEMO_DAYS;
  const start = addDays(today, -(N - 1));
  const days: string[] = Array.from({ length: N }, (_, i) => addDays(start, i));
  const season: number[] = days.map((d, i) => {
    let f = 1 + (0.12 * (i - (N - 1))) / 365; // steady growth towards today
    const m = Number(d.slice(5, 7));
    if (m === 6 || m === 7) f *= 0.94; // monsoon dip
    for (const fest of FESTIVALS) {
      const gap = diffDays(d, fest);
      if (gap >= 1 && gap <= 6) f *= 1.7; else if (gap === 0) f *= 1.3;
    }
    return f * WEEKDAY_FACTOR[weekdayOf(d)];
  });

  // products
  const products: DemoProduct[] = [];
  for (const cat of CATALOG) {
    const sup = CAT_SUPPLIERS[cat.code];
    let n = 0;
    for (const [name, variants] of cat.items) {
      for (const [size, price, demand] of variants) {
        n++;
        const full = `${name} ${size}`;
        const loose = size === '(loose)';
        const margin = cat.margin + 0.05 + (rand() - 0.5) * 0.04;
        const lead = Math.max(2, cat.lead + Math.floor(rand() * 3) - 1);
        const tag: DemoProduct['tag'] = DEAD.includes(full) ? 'dead' : LOW.includes(full) ? 'low' : OUT.includes(full) ? 'out' : OVER.includes(full) ? 'over' : 'ok';
        products.push({
          sku: `${cat.code}-${String(n).padStart(3, '0')}`, name: full, category: cat.name, unit: loose ? 'kg' : cat.unit,
          cost: Math.round(price * (1 - margin) * 100) / 100, price, reorder_level: Math.max(2, Math.ceil(demand * lead * 1.4)), lead_time_days: lead,
          supplier: sup[n % sup.length], opening: 0, tag, demand,
        });
      }
    }
  }

  // daily units per product
  const units: number[][] = products.map((p, pi) => {
    const loose = p.unit === 'kg';
    const deadFrom = p.tag === 'dead' ? N - (96 + ((pi * 37) % 120)) : N; // dead SKUs stopped selling 96-215 days ago
    const outFrom = p.tag === 'out' ? N - (2 + (pi % 4)) : N; // out-of-stock SKUs ran out a few days ago
    const row = new Array<number>(N).fill(0);
    for (let d = 0; d < N; d++) {
      if (d >= deadFrom || d >= outFrom) break;
      const lam = p.demand * season[d];
      row[d] = loose ? poisson(rand, lam * 4) / 4 : poisson(rand, lam);
    }
    return row;
  });

  // purchases keep every product in stock; the buffer B decides where stock ends up today
  const purchases: DemoPurchase[] = [];
  products.forEach((p, pi) => {
    const R = p.demand >= 2.5 ? 7 : p.demand >= 0.6 ? 14 : 28;
    const offset = 1 + ((pi * 7) % R);
    const B = p.tag === 'low' ? Math.max(1, Math.floor(p.reorder_level * (0.35 + rand() * 0.45)))
      : p.tag === 'out' ? 0
      : p.tag === 'over' ? p.reorder_level * 8
      : p.tag === 'dead' ? 18 + Math.floor(rand() * 45)
      : Math.ceil(p.reorder_level * (1.4 + rand() * 1.6));
    const u = units[pi];
    let before = 0;
    for (let d = 0; d < Math.min(offset, N); d++) before += u[d];
    p.opening = Math.ceil(before) + B;
    let carry = Math.ceil(before) - before; // rounding surplus already in stock
    for (let t = offset; t < N; t += R) {
      let need = 0;
      for (let d = t; d < Math.min(t + R, N); d++) need += u[d];
      const qty = Math.max(0, Math.ceil(need - carry));
      carry = carry + qty - need;
      if (qty > 0) purchases.push({ date: days[t], bill_no: `PB-${days[t].slice(2).replace(/-/g, '')}-${String(p.supplier + 1).padStart(2, '0')}`, p: pi, qty, cost: p.cost, supplier: p.supplier });
    }
  });
  purchases.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.p - b.p));

  // sale lines grouped into invoices
  const sales: DemoSale[] = [];
  for (let d = 0; d < N; d++) {
    const lines: number[] = [];
    for (let pi = 0; pi < products.length; pi++) if (units[pi][d] > 0) lines.push(pi);
    for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; }
    let seq = 0, i = 0;
    const ymd = days[d].slice(2).replace(/-/g, '');
    while (i < lines.length) {
      seq++;
      const size = 1 + Math.floor(rand() * rand() * 6);
      const customer = rand() < 0.18 ? Math.floor(rand() * CUSTOMERS.length) : -1;
      const invoice = `SKS-${ymd}-${String(seq).padStart(3, '0')}`;
      for (let k = 0; k < size && i < lines.length; k++, i++) {
        const pi = lines[i];
        const p = products[pi];
        const qty = units[pi][d];
        const discount = rand() < 0.04 ? Math.round(qty * p.price * 0.05 * 100) / 100 : 0;
        sales.push({ date: days[d], invoice_no: invoice, p: pi, qty, price: p.price, discount, customer });
      }
    }
  }

  // running costs
  const expenses: DemoExpense[] = [];
  for (let d = 0; d < N; d++) {
    const day = days[d];
    const dom = Number(day.slice(8, 10));
    if (dom === 1) expenses.push({ date: day, category: 'Rent', amount: 18000, note: 'Shop rent', mode: 'Bank transfer' });
    if (dom === 5) expenses.push({ date: day, category: 'Electricity', amount: 3200 + Math.floor(rand() * 20) * 100, note: 'KSEB bill', mode: 'UPI' });
    if (dom === 10) expenses.push({ date: day, category: 'Phone & Internet', amount: 799, note: 'Broadband and mobile', mode: 'UPI' });
    if (dom === 15) expenses.push({ date: day, category: 'Packaging', amount: 800 + Math.floor(rand() * 8) * 100, note: 'Carry bags and paper', mode: 'Cash' });
    if (day === endOfMonth(day)) {
      expenses.push({ date: day, category: 'Salary', amount: 14000, note: 'Salary - Biju', mode: 'Bank transfer' });
      expenses.push({ date: day, category: 'Salary', amount: 11000, note: 'Salary - Sindhu', mode: 'Bank transfer' });
    }
    if (weekdayOf(day) === 1) expenses.push({ date: day, category: 'Transport', amount: 500 + Math.floor(rand() * 10) * 100, note: 'Goods auto / tempo', mode: 'Cash' });
    if (rand() < 0.012) expenses.push({ date: day, category: 'Maintenance', amount: 500 + Math.floor(rand() * 25) * 100, note: 'Repairs', mode: 'Cash' });
  }
  return { business: DEMO_BUSINESS, today, start, suppliers: SUPPLIERS, customers: CUSTOMERS, products, sales, purchases, expenses };
}

/** Replaces all data with the demo business. Runs in one transaction with cached statements (about 60k inserts). */
export function loadDemo(e: DbEngine, today: string): { products: number; sales: number; purchases: number; expenses: number; ms: number } {
  const t0 = Date.now();
  const demo = generateDemo(today);
  e.clearAll();
  e.tx(() => {
    demo.suppliers.forEach((s, i) => e.runFast('INSERT INTO suppliers(id, name, phone) VALUES (?, ?, ?)', [i + 1, s, `0487-24${String(10000 + i * 371).slice(0, 5)}`]));
    demo.customers.forEach((c, i) => e.runFast('INSERT INTO customers(id, name) VALUES (?, ?)', [i + 1, c]));
    demo.products.forEach((p, i) => {
      e.runFast('INSERT INTO products(id, sku, name, category, unit, cost_paise, price_paise, reorder_level, lead_time_days, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [i + 1, p.sku, p.name, p.category, p.unit, toPaise(p.cost), toPaise(p.price), p.reorder_level, p.lead_time_days, p.supplier + 1]);
      if (p.opening > 0) e.runFast("INSERT INTO stock_movements(product_id, move_date, kind, qty_delta, note) VALUES (?, ?, 'opening', ?, 'Opening stock')", [i + 1, demo.start, p.opening]);
    });
    for (const pu of demo.purchases) e.runFast('INSERT INTO purchases(bill_no, purchase_date, product_id, supplier_id, qty, unit_cost_paise) VALUES (?, ?, ?, ?, ?, ?)', [pu.bill_no, pu.date, pu.p + 1, pu.supplier + 1, pu.qty, toPaise(pu.cost)]);
    for (const s of demo.sales) {
      e.runFast('INSERT INTO sales(invoice_no, sale_date, product_id, customer_id, qty, unit_price_paise, discount_paise, unit_cost_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [s.invoice_no, s.date, s.p + 1, s.customer >= 0 ? s.customer + 1 : null, s.qty, toPaise(s.price), toPaise(s.discount), toPaise(demo.products[s.p].cost)]);
    }
    for (const x of demo.expenses) e.runFast('INSERT INTO expenses(expense_date, category, amount_paise, note, payment_mode) VALUES (?, ?, ?, ?, ?)', [x.date, x.category, toPaise(x.amount), x.note, x.mode]);
    e.run("INSERT INTO _settings(key, value) VALUES ('business_name', ?), ('is_demo', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value", [demo.business]);
  });
  e.changed();
  return { products: demo.products.length, sales: demo.sales.length, purchases: demo.purchases.length, expenses: demo.expenses.length, ms: Date.now() - t0 };
}
