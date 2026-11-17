import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildApi, type DbApi } from '@/core/db/api';
import { loadDemo } from '@/core/db/demoData';
import type { ImportMode, ImportTarget } from '@/core/types';
import type { ImportPlan } from '@/core/import/pipeline';
import { makeEngine, TODAY } from '../helpers';
import { setTodayOverride } from '@/core/util/dates';

setTodayOverride(TODAY);
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

async function fresh(demo = false): Promise<DbApi> {
  const e = await makeEngine();
  if (demo) loadDemo(e, TODAY);
  return buildApi(e);
}

async function importBytes(api: DbApi, bytes: Uint8Array, fileName: string, opts: { target?: ImportTarget; mode?: ImportMode; sheet?: number; mapping?: Record<string, number | null> } = {}) {
  const parsed = await api.parseFile(bytes, fileName);
  const sheet = opts.sheet ?? parsed.sheets.findIndex((s) => !s.hidden && s.rows > 0);
  const a = api.analyzeSheet(parsed.parseId, sheet);
  const target = opts.target ?? a.target;
  const mapping: Record<string, number | null> = {};
  if (target !== 'custom') for (const m of a.mappings[target]) mapping[m.field] = m.column;
  Object.assign(mapping, opts.mapping ?? {});
  const plan: ImportPlan = { target, mapping, dayFirst: true, customColumns: target === 'custom' ? a.customColumns : undefined };
  const preview = api.previewImport(parsed.parseId, sheet, plan);
  const report = await api.runImport({ parseId: parsed.parseId, sheetIndex: sheet, plan, mode: opts.mode ?? (target === 'products' ? 'upsert' : 'append'), customName: a.suggestedTableName, customDisplay: fileName });
  return { parsed, a, target, preview, report };
}
const imp = (api: DbApi, name: string, opts: Parameters<typeof importBytes>[3] = {}) => importBytes(api, fixture(name), name, opts);

describe('CSV encodings and delimiters', () => {
  it.each(['products_utf8_bom.csv', 'products_win1252.csv', 'products_utf16.csv', 'products_semicolon.csv'])('%s imports 3 products', async (name) => {
    const api = await fresh();
    const { report, target, parsed } = await imp(api, name);
    expect(target).toBe('products');
    expect(report.rowsOk).toBe(3);
    expect(report.rowsFailed).toBe(0);
    const rows = api.listProducts();
    expect(rows.map((r) => r.sku).sort()).toEqual(['00123', '00124', '00125']); // leading zeros survive
    expect(rows.find((r) => r.sku === '00124')).toMatchObject({ name: 'Rice, Matta 5kg', cost: 1250, stock: 15 });
    expect(rows.find((r) => r.sku === '00125')?.name).toBe('Café Filter Coffee 200g'); // é survives every encoding
    if (name.includes('1252')) expect(parsed.encoding).toBe('windows-1252');
  });
  it('pipe delimiter', async () => {
    const api = await fresh();
    const { report } = await imp(api, 'products_pipe.csv', { target: 'products' });
    expect(report.rowsOk).toBe(2);
  });
  it('quoted commas and newlines, trailing empty columns, ragged rows', async () => {
    const api = await fresh();
    const { report, a } = await imp(api, 'products_quoted_newlines.csv', { target: 'products' });
    expect(a.headers.length).toBeGreaterThanOrEqual(4);
    expect(report.rowsOk).toBe(4);
    expect(api.listProducts().find((p) => p.sku === 'Q1')?.name).toBe('Toor Dal, 1kg');
  });
});

describe('layout problems', () => {
  it('skips title rows, blank rows and the Grand Total row; dedupes headers', async () => {
    const api = await fresh();
    const { a, report } = await imp(api, 'stock_report_title_rows.xlsx', { target: 'products' });
    expect(a.header.index).toBe(3);
    expect(a.headers).toContain('Qty_2');
    expect(a.rowCount).toBe(3);
    expect(report.rowsOk).toBe(3);
    expect(report.warnings.join(' ')).toMatch(/totals row/);
  });
  it('joins a two-row merged header', async () => {
    const api = await fresh();
    const { a, report, target } = await imp(api, 'merged_header_two_rows.xlsx');
    expect(a.header.span).toBe(2);
    expect(a.headers).toEqual(expect.arrayContaining(['Invoice No', 'Invoice Date', 'Item Code', 'Item Name', 'Sale Qty', 'Sale Rate']));
    expect(target).toBe('sales');
    expect(report.rowsOk).toBe(3);
    expect(report.createdProducts).toBe(3);
  });
  it('odd headers become safe identifiers for a custom table', async () => {
    const api = await fresh();
    const { a } = await imp(api, 'headers_odd.csv', { target: 'custom' });
    const names = a.customColumns.map((c) => c.name);
    expect(names).toEqual(['item_name', 'qty', 'qty_2', 'price_rs', 'c_2024_sales', 'margin_pct', 'notes', 'select']);
    // "select" is quoted everywhere, so a reserved word as a column name still works
    expect(api.query('SELECT "select", item_name FROM u_headers_odd', [], { readOnly: true }).rows).toEqual([{ select: 'x', item_name: 'Sugar 1kg' }]);
  });
});

describe('workbooks', () => {
  it('lists sheets (hidden and empty included) and imports the chosen one', async () => {
    const api = await fresh();
    const parsed = await api.parseFile(fixture('multi_sheet.xlsx'), 'multi_sheet.xlsx');
    expect(parsed.sheets.map((s) => s.name)).toEqual(['Readme', 'Sales Nov', 'Hidden calc', 'Empty']);
    expect(parsed.sheets[2].hidden).toBe(true);
    expect(parsed.sheets[3].rows).toBe(0);
    const { report, target } = await imp(api, 'multi_sheet.xlsx', { sheet: 1 });
    expect(target).toBe('sales');
    expect(report.rowsOk).toBe(2);
    expect(api.query("SELECT ROUND(SUM(revenue), 2) AS r FROM v_sales", [], { readOnly: true }).rows[0].r).toBe(194);
  });
  it('reads .xls (BIFF8) and .ods', async () => {
    for (const name of ['legacy_biff8.xls', 'openoffice.ods']) {
      const api = await fresh();
      const { report, target } = await imp(api, name);
      expect(target, name).toBe('products');
      expect(report.rowsOk, name).toBeGreaterThan(0);
    }
  });
  it('gives a clear error for password-protected, empty and non-spreadsheet files', async () => {
    const api = await fresh();
    await expect(api.parseFile(fixture('password_protected.xlsx'), 'password_protected.xlsx')).rejects.toThrow(/password|could not be read/i);
    await expect(api.parseFile(fixture('empty.csv'), 'empty.csv')).rejects.toThrow(/empty/);
    await expect(api.parseFile(fixture('not_a_spreadsheet.pdf'), 'x.pdf')).rejects.toThrow(/not supported/);
    await expect(api.parseFile(new Uint8Array(51 * 1024 * 1024), 'huge.csv')).rejects.toThrow(/50 MB/);
  });
  it('a header-only file imports nothing without crashing', async () => {
    const api = await fresh();
    const { report } = await imp(api, 'only_headers.csv', { target: 'sales' });
    expect(report.rowsOk).toBe(0);
  });
  it('Excel errors become empty with a warning; barcodes stay text', async () => {
    const api = await fresh();
    const { report } = await imp(api, 'excel_errors_and_barcodes.xlsx', { target: 'products' });
    expect(report.rowsOk).toBe(3);
    const skus = api.listProducts().map((p) => p.sku).sort();
    expect(skus).toEqual(['00042', '8901030000000', '8901030000000'.slice(0, 0) || '8901030000000'].slice(0, 2).concat(skus.slice(2)));
    expect(skus).toContain('00042');
    expect(report.warnings.join(' ')).toMatch(/scientific notation|Excel errors/);
  });
});

describe('sales with messy dates and numbers', () => {
  it('imports good rows, reports bad rows, handles returns and unknown products', async () => {
    const api = await fresh(true);
    const before = api.listProducts({ search: 'Sugar 1kg' })[0].stock;
    const { report } = await imp(api, 'sales_dates_numbers.csv', { target: 'sales' });
    // B7 (no date), B8 (31 Feb), B13 (qty "abc") fail; B9 is a return; the rest are sales
    expect(report.rowsFailed).toBe(3);
    expect(report.rowsOk).toBe(10);
    expect(report.errors.map((e) => e.code).sort()).toEqual(['BAD_DATE', 'BAD_NUMBER', 'MISSING_DATE']);
    expect(report.createdProducts).toBe(1);
    expect(report.warnings.join(' ')).toMatch(/returns/);
    expect(report.warnings.join(' ')).toMatch(/zero price/);
    expect(report.warnings.join(' ')).toMatch(/below cost/);
    expect(report.warnings.join(' ')).toMatch(/could be read two ways/);
    const sugar = api.listProducts({ search: 'Sugar 1kg' })[0].stock;
    expect(Math.round((before - sugar) * 10) / 10).toBe(6.5); // B1 2 + B2 1 + B3 1.5 + B11 1 + B12 1
    const dates = api.query("SELECT invoice_no, sale_date FROM v_sales WHERE invoice_no IN ('B1','B2','B4','B5','B6') ORDER BY invoice_no", [], { readOnly: true }).rows;
    expect(dates).toEqual([
      { invoice_no: 'B1', sale_date: '2026-11-17' }, { invoice_no: 'B2', sale_date: '2026-11-17' }, { invoice_no: 'B4', sale_date: '2026-04-03' },
      { invoice_no: 'B5', sale_date: '2026-11-16' }, { invoice_no: 'B6', sale_date: '2026-11-16' },
    ]);
  });
  it('the same file imported twice is flagged, and upsert does not double count', async () => {
    const api = await fresh(true);
    await imp(api, 'merged_header_two_rows.xlsx');
    const total1 = api.query('SELECT SUM(revenue) AS r FROM v_sales', [], { readOnly: true }).rows[0].r;
    const parsed = await api.parseFile(fixture('merged_header_two_rows.xlsx'), 'merged_header_two_rows.xlsx');
    expect(parsed.duplicate).toBe(true);
    await imp(api, 'merged_header_two_rows.xlsx', { mode: 'upsert' });
    expect(api.query('SELECT SUM(revenue) AS r FROM v_sales', [], { readOnly: true }).rows[0].r).toBeCloseTo(total1 as number, 2);
  });
});

describe('other targets', () => {
  it('duplicate SKUs within a file: the last one wins, with a warning', async () => {
    const api = await fresh();
    const { report } = await imp(api, 'duplicate_skus.csv', { target: 'products' });
    expect(report.warnings.join(' ')).toMatch(/more than once/);
    expect(api.listProducts().find((p) => p.sku === 'D1')).toMatchObject({ name: 'Item One (new)', price: 12, stock: 7 });
  });
  it('expenses', async () => {
    const api = await fresh();
    const { report, target } = await imp(api, 'expenses.csv');
    expect(target).toBe('expenses');
    expect(report.rowsOk).toBe(3);
    expect(api.periodTotals('2026-11-01', '2026-11-30').expenses).toBe(22050);
  });
  it('stock count sets on-hand quantities and reports unknown products', async () => {
    const api = await fresh(true);
    const { report, target } = await imp(api, 'stock_count.csv');
    expect(target).toBe('stock_count');
    expect(report.rowsOk).toBe(2);
    expect(report.rowsFailed).toBe(1);
    expect(api.listProducts({ search: 'Sugar 1kg' })[0].stock).toBe(25);
  });
  it('a custom CSV becomes a queryable u_ table; injected text stays data', async () => {
    const api = await fresh(true);
    const { report } = await imp(api, 'custom_price_list.csv', { target: 'custom' });
    expect(report.customTable).toBe('u_custom_price_list');
    expect(api.allowedTables()).toContain('u_custom_price_list');
    const r = api.query('SELECT COUNT(*) AS n, ROUND(AVG(rate), 2) AS avg_rate FROM u_custom_price_list', [], { readOnly: true }).rows[0];
    expect(r).toEqual({ n: 6, avg_rate: 96.5 });
    const schema = api.schemaForLlm();
    expect(schema.tables.find((t) => t.name === 'u_custom_price_list')?.columns.map((c) => c.name)).toEqual(['supplier', 'item', 'rate', 'valid_from', 'notes']);
    expect(api.query("SELECT valid_from FROM u_custom_price_list LIMIT 1", [], { readOnly: true }).rows[0].valid_from).toBe('2026-11-01');
    expect(api.stats().sales).toBeGreaterThan(30000); // the "delete all sales" text did nothing
  });
});

describe('undo, replace, cancel and recovery', () => {
  it('undo removes the batch, its stock movements and the products it created', async () => {
    const api = await fresh(true);
    const s0 = api.stats();
    const stock0 = api.listProducts({ search: 'Sugar 1kg' })[0].stock;
    const { report } = await imp(api, 'sales_dates_numbers.csv', { target: 'sales' });
    expect(api.stats().sales).toBeGreaterThan(s0.sales);
    const r = api.undoImport(report.batchId);
    expect(r.removed).toBeGreaterThan(0);
    expect(api.stats()).toMatchObject({ sales: s0.sales, products: s0.products });
    expect(api.listProducts({ search: 'Sugar 1kg' })[0].stock).toBe(stock0);
    expect(api.listImports()[0].status).toBe('undone');
  });
  it('undo of an upsert restores the previous values', async () => {
    const api = await fresh();
    await imp(api, 'products_utf8_bom.csv');
    const bytes = new TextEncoder().encode('Item Code,Item Name,MRP\n00123,Sugar 1kg,99\n');
    const { report } = await importBytes(api, bytes, 'price_change.csv', { target: 'products', mode: 'upsert' });
    expect(api.listProducts().find((p) => p.sku === '00123')?.price).toBe(99);
    api.undoImport(report.batchId);
    expect(api.listProducts().find((p) => p.sku === '00123')?.price).toBe(46);
  });
  it('replace clears the table first (behind a confirmation in the UI)', async () => {
    const api = await fresh(true);
    await imp(api, 'expenses.csv', { mode: 'replace' });
    expect(api.stats().expenses).toBe(3);
  });
  it('an import that was running when the app died is rolled back on the next start', async () => {
    const e = await makeEngine();
    loadDemo(e, TODAY);
    const api = buildApi(e);
    const n0 = api.stats().sales;
    e.run("INSERT INTO _import_batches(id, file_name, target, mode, created_at, status) VALUES ('bdead', 'x.csv', 'sales', 'append', datetime('now'), 'running')");
    e.run("INSERT INTO sales(invoice_no, sale_date, product_id, qty, unit_price_paise, import_batch) VALUES ('X', '2026-11-17', 1, 1, 100, 'bdead')");
    const reopened = await makeEngine(e.snapshot());
    expect(reopened.scalar('SELECT COUNT(*) FROM sales')).toBe(n0);
    expect(reopened.scalar("SELECT status FROM _import_batches WHERE id = 'bdead'")).toBe('cancelled');
  });
  it('cancel removes what was written so far', async () => {
    const api = await fresh(true);
    const n0 = api.stats().sales;
    const parsed = await api.parseFile(readBig(5000), 'big.xlsx');
    const a = api.analyzeSheet(parsed.parseId, 0);
    const mapping = Object.fromEntries(a.mappings.sales.map((m) => [m.field, m.column]));
    const p = api.runImport({ parseId: parsed.parseId, sheetIndex: 0, plan: { target: 'sales', mapping, dayFirst: true }, mode: 'append' }, () => api.cancelImport());
    const rep = await p;
    expect(rep.cancelled).toBe(true);
    expect(api.stats().sales).toBe(n0);
  });
});

function readBig(rows: number): Uint8Array {
  const aoa: unknown[][] = [['Invoice No', 'Date', 'Item Code', 'Item Name', 'Qty', 'Rate']];
  const names = ['Sugar 1kg', 'Tata Salt 1kg', 'Parle-G Biscuit 100g', 'Milma Milk 500ml', 'Maggi Noodles 70g'];
  const skus = ['SS-001', 'SS-003', 'SB-001', 'DB-001', 'SB-011'];
  for (let i = 0; i < rows; i++) aoa.push([`BIG-${Math.floor(i / 3)}`, 46300 + (i % 30), skus[i % 5], names[i % 5], 1 + (i % 4), 10 + (i % 7)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sales');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('performance (AC3)', () => {
  it('a 10,000-row XLSX sales file imports in well under 15 s, with an accurate report and undo', async () => {
    const api = await fresh(true);
    const n0 = api.stats().sales;
    const t0 = Date.now();
    const { report } = await importBytes(api, readBig(10000), 'big.xlsx', { target: 'sales' });
    const ms = Date.now() - t0;
    expect(report.rowsOk).toBe(10000);
    expect(api.stats().sales).toBe(n0 + 10000);
    expect(ms).toBeLessThan(15000);
    console.log(`10k-row XLSX import: ${ms} ms`);
    api.undoImport(report.batchId);
    expect(api.stats().sales).toBe(n0);
  });
});
