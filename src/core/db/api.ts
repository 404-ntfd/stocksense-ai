// The complete surface the UI can call on the database. In the app these functions run inside the
// DB worker (see worker.ts / client.ts); in tests and scripts they are called directly.
import type { DbEngine } from './engine';
import { DbError } from './engine';
import type { AdjustKind, ColumnSpec, ForecastResult, ImportMode, ImportReport, ImportTarget, ProductInput, QueryOpts, Row } from '../types';
import { ImportRun, isDuplicateFile, listImports, newBatchId, undoImport } from './importer';
import * as inv from './inventory';
import { loadDemo } from './demoData';
import { dashboard, forecastInput, forecastRows, forecastState, insights, periodTotals, saveForecasts } from '../analytics/kpis';
import { analyzeSheet, coerceChunks, customTableName, parseFile, validatePlan, WARNING_TEXT, WARN_ROWS, type ImportPlan, type ParsedFile, type SheetAnalysis } from '../import/pipeline';
import type { PeriodKey } from '../util/dates';

export interface ParsedSummary {
  parseId: string; fileName: string; kind: 'csv' | 'excel'; sizeBytes: number; encoding?: string; delimiter?: string; warnings: string[];
  sheets: Array<{ index: number; name: string; hidden: boolean; rows: number }>;
  duplicate: boolean;
}
export interface SheetSummary extends SheetAnalysis { sheetIndex: number; sheetName: string; preview: unknown[][]; suggestedTableName: string; tooManyRows: boolean }
export interface RunImportArgs { parseId: string; sheetIndex: number; headerRow?: number; plan: ImportPlan; mode: ImportMode; customName?: string; customDisplay?: string }

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export function buildApi(e: DbEngine) {
  const parsed = new Map<string, ParsedFile>();
  const analyses = new Map<string, SheetAnalysis>();
  const openRuns = new Map<string, ImportRun>();
  let cancelRequested = false;
  let seq = 0;

  const analysisFor = (parseId: string, sheetIndex: number, headerRow?: number): SheetAnalysis => {
    const file = parsed.get(parseId);
    if (!file) throw new DbError('The file is no longer loaded. Please pick it again.', 'NO_PARSE');
    const key = `${parseId}:${sheetIndex}:${headerRow ?? 'auto'}`;
    let a = analyses.get(key);
    if (!a) { a = analyzeSheet(file.sheets[sheetIndex], file.fileName, headerRow); analyses.set(key, a); }
    return a;
  };

  return {
    // ----- core -----
    ping: () => 'ok',
    exec: (sql: string, params?: unknown[]) => e.exec(sql, params),
    execBatch: (statements: Array<{ sql: string; params?: unknown[] }>) => e.execBatch(statements),
    query: <T = Row>(sql: string, params?: unknown[], opts?: QueryOpts) => e.query<T>(sql, params, opts),
    snapshot: () => e.snapshot(),
    restore: (bytes: Uint8Array) => e.restore(bytes),
    clearAll: () => e.clearAll(),
    loadDemo: (today: string) => loadDemo(e, today),
    schemaForLlm: (withSamples = true) => e.schemaForLlm(withSamples),
    allowedTables: () => e.allowedTables(),
    getSetting: (key: string) => e.getSetting(key),
    setSetting: (key: string, value: string | null) => e.setSetting(key, value),
    stats: () => ({
      products: e.scalar<number>('SELECT COUNT(*) FROM products WHERE is_active = 1') ?? 0,
      sales: e.scalar<number>('SELECT COUNT(*) FROM sales') ?? 0,
      purchases: e.scalar<number>('SELECT COUNT(*) FROM purchases') ?? 0,
      expenses: e.scalar<number>('SELECT COUNT(*) FROM expenses') ?? 0,
      firstSale: e.scalar<string>('SELECT MIN(sale_date) FROM sales'),
      lastSale: e.scalar<string>('SELECT MAX(sale_date) FROM sales'),
      businessName: e.getSetting('business_name'),
      isDemo: e.getSetting('is_demo') === '1',
      dataVersion: e.dataVersion(),
    }),

    // ----- tables -----
    tableList: () => e.tableList(),
    browse: (table: string, opts?: Parameters<DbEngine['browse']>[1]) => e.browse(table, opts),
    exportRows: (table: string) => e.exportRows(table),
    deleteRow: (table: string, id: number) => e.deleteRow(table, id),
    getEditRow: (table: string, id: number) => inv.getEditRow(e, table, id),
    updateColumnDescription: (table: string, column: string, description: string) => {
      if (!e.isCustomTable(table)) throw new DbError('Only custom tables can be described.', 'NOT_EDITABLE');
      e.run('UPDATE _meta_columns SET description = ? WHERE table_name = ? AND column_name = ?', [description.slice(0, 200), table, column]);
      e.changed();
    },
    customColumns: (table: string) => e.all<{ column_name: string; display_name: string; description: string; sem_type: string }>('SELECT column_name, display_name, description, sem_type FROM _meta_columns WHERE table_name = ? ORDER BY rowid', [table]),
    dropCustomTable: (table: string) => {
      if (!e.isCustomTable(table)) throw new DbError('Only custom tables can be removed.', 'NOT_EDITABLE');
      e.tx(() => {
        e.run(`DROP TABLE "${table}"`);
        e.run('DELETE FROM _meta_tables WHERE table_name = ?', [table]);
        e.run('DELETE FROM _meta_columns WHERE table_name = ?', [table]);
      });
      e.changed();
    },

    // ----- inventory and manual entries -----
    listProducts: (opts?: Parameters<typeof inv.listProducts>[1]) => inv.listProducts(e, opts),
    getProduct: (id: number, today?: string) => inv.getProduct(e, id, today),
    productDetail: (id: number, today?: string) => inv.productDetail(e, id, today),
    listCategories: () => inv.listCategories(e),
    productNames: () => inv.productNames(e),
    saveProduct: (input: ProductInput, id?: number | null, today?: string) => inv.saveProduct(e, input, id, today),
    removeProduct: (id: number) => inv.removeProduct(e, id),
    restoreProduct: (id: number) => inv.restoreProduct(e, id),
    adjustStock: (productId: number, kind: AdjustKind, qty: number, note?: string | null, date?: string) => inv.adjustStock(e, productId, kind, qty, note, date),
    saveSale: (s: inv.SaleInput, id?: number | null) => inv.saveSale(e, s, id),
    savePurchase: (s: inv.PurchaseInput, id?: number | null) => inv.savePurchase(e, s, id),
    saveExpense: (x: inv.ExpenseInput, id?: number | null) => inv.saveExpense(e, x, id),
    updatePrice: (productId: number, price: number) => inv.updatePrice(e, productId, price),

    // ----- analytics -----
    dashboard: (key: PeriodKey, today?: string) => dashboard(e, key, today),
    insights: (today?: string) => insights(e, today),
    periodTotals: (from: string, to: string) => periodTotals(e, from, to),
    forecastInput: (today?: string) => forecastInput(e, today),
    saveForecasts: (results: ForecastResult[], today?: string) => saveForecasts(e, results, today),
    forecastState: (today?: string) => forecastState(e, today),
    forecastRows: (where?: string, params?: unknown[]) => forecastRows(e, where, params),

    // ----- Q&A log -----
    logQa: (entry: Parameters<DbEngine['logQa']>[0]) => e.logQa(entry),
    setQaFeedback: (id: number, feedback: number) => e.setQaFeedback(id, feedback),
    qaLog: (limit?: number) => e.qaLog(limit),

    // ----- import wizard -----
    parseFile: async (bytes: Uint8Array, fileName: string): Promise<ParsedSummary> => {
      const file = await parseFile(bytes, fileName);
      const parseId = `p${++seq}`;
      parsed.clear(); analyses.clear(); // one file at a time keeps worker memory flat
      parsed.set(parseId, file);
      return {
        parseId, fileName: file.fileName, kind: file.kind, sizeBytes: file.sizeBytes, encoding: file.encoding, delimiter: file.delimiter, warnings: file.warnings,
        sheets: file.sheets.map((s, index) => ({ index, name: s.name, hidden: s.hidden, rows: s.matrix.length })),
        duplicate: isDuplicateFile(e, file.fileHash),
      };
    },
    analyzeSheet: (parseId: string, sheetIndex: number, headerRow?: number): SheetSummary => {
      const a = analysisFor(parseId, sheetIndex, headerRow);
      const file = parsed.get(parseId)!;
      const sheet = file.sheets[sheetIndex];
      const label = file.kind === 'excel' && file.sheets.length > 1 ? sheet.name : file.fileName;
      return { ...a, sheetIndex, sheetName: sheet.name, preview: sheet.matrix.slice(0, 15).map((r) => r.slice(0, 30)), suggestedTableName: customTableName(label), tooManyRows: a.rowCount > WARN_ROWS };
    },
    /** First 20 rows as they would be imported, plus the errors found in the first 2,000 rows. */
    previewImport: (parseId: string, sheetIndex: number, plan: ImportPlan, headerRow?: number) => {
      const problem = validatePlan(plan);
      if (problem) return { ok: false as const, problem, rows: [] as Row[], errors: [], errorCount: 0, checked: 0, warnings: [] as string[] };
      const a = analysisFor(parseId, sheetIndex, headerRow);
      const first = coerceChunks(parsed.get(parseId)!.sheets[sheetIndex], a.header, plan).next().value as import('../import/pipeline').CoercedChunk | undefined;
      const warnings = first ? Object.entries(first.warnCounts).filter(([k]) => WARNING_TEXT[k]).map(([k, n]) => WARNING_TEXT[k](n)) : [];
      if (first?.skippedTotals) warnings.push(WARNING_TEXT.totals(first.skippedTotals));
      return { ok: true as const, problem: null, rows: (first?.rows ?? []).slice(0, 20), errors: (first?.errors ?? []).slice(0, 50), errorCount: first?.errors.length ?? 0, checked: first?.processed ?? 0, warnings };
    },
    runImport: async (args: RunImportArgs, onProgress?: (done: number, total: number) => void): Promise<ImportReport> => {
      const problem = validatePlan(args.plan);
      if (problem) throw new DbError(problem, 'VALIDATION');
      const file = parsed.get(args.parseId);
      if (!file) throw new DbError('The file is no longer loaded. Please pick it again.', 'NO_PARSE');
      const a = analysisFor(args.parseId, args.sheetIndex, args.headerRow);
      const target: ImportTarget = args.plan.target;
      let custom: { tableName: string; displayName: string; columns: ColumnSpec[] } | undefined;
      if (target === 'custom') {
        const cols = (args.plan.customColumns ?? []).filter((c): c is ColumnSpec => !!c);
        custom = { tableName: args.customName ?? customTableName(file.fileName), displayName: args.customDisplay ?? file.fileName.replace(/\.[a-z0-9]+$/i, ''), columns: cols };
      }
      cancelRequested = false;
      const run = new ImportRun(e, target, args.mode, newBatchId(), { fileName: file.fileName, fileHash: file.fileHash, custom, preWarnings: [...file.warnings] });
      run.begin();
      let done = 0, totals = 0;
      try {
        for (const chunk of coerceChunks(file.sheets[args.sheetIndex], a.header, args.plan)) {
          run.addChunk(chunk.rows);
          run.addErrors(chunk.errors);
          run.mergeWarnCounts(chunk.warnCounts);
          totals += chunk.skippedTotals;
          done += chunk.processed;
          onProgress?.(done, a.rowCount);
          await tick(); // lets a cancel message in, and keeps the worker responsive
          if (cancelRequested) return run.abort();
        }
      } catch (err) {
        run.abort();
        throw err;
      }
      if (totals) run.mergeWarnCounts({ totals });
      return run.finish();
    },
    cancelImport: () => { cancelRequested = true; },
    releaseParse: () => { parsed.clear(); analyses.clear(); },
    undoImport: (batchId: string) => undoImport(e, batchId),
    listImports: (limit?: number) => listImports(e, limit),

    // streaming variant behind DbClient.importRows (rows already clean)
    importBegin: (target: ImportTarget, mode: ImportMode, batchId: string, fileName: string) => {
      const run = new ImportRun(e, target, mode, batchId, { fileName });
      run.begin();
      openRuns.set(batchId, run);
    },
    importChunk: (batchId: string, rows: Row[]) => { openRuns.get(batchId)?.addChunk(rows); },
    importEnd: (batchId: string): ImportReport => {
      const run = openRuns.get(batchId);
      if (!run) throw new DbError('That import was not started.', 'NO_BATCH');
      openRuns.delete(batchId);
      return run.finish();
    },
  };
}

export type DbApi = ReturnType<typeof buildApi>;
