import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { db } from '@/core/db/client';
import type { ParsedSummary, SheetSummary } from '@/core/db/api';
import type { ColumnSpec, ImportMode, ImportReport, ImportTarget, Row } from '@/core/types';
import { TARGET_FIELDS, TARGET_LABELS } from '@/core/import/mapping';
import type { ImportPlan } from '@/core/import/pipeline';
import { toIdentifier } from '@/core/import/coerce';
import { formatNumber } from '@/core/util/money';
import { saveFile } from '@/app/services';
import { useSettings } from '@/app/settings';
import { toast, useApp } from '@/app/store';
import { Badge, Button, Card, cx, ErrorState, Field, IconButton, Input, Select, Sheet, Spinner, Toggle } from '@/app/ui';
import { DataTable } from '@/app/DataTable';

type Step = 'pick' | 'sheet' | 'map' | 'preview' | 'running' | 'done';
const TARGETS: ImportTarget[] = ['products', 'sales', 'purchases', 'expenses', 'stock_count', 'custom'];
const TARGET_HELP: Record<ImportTarget, string> = {
  products: 'Your item list: names, codes, prices and (optionally) current stock.',
  sales: 'A sales register or invoice lines: date, product, quantity, price.',
  purchases: 'Purchase bills from suppliers: date, product, quantity, cost.',
  expenses: 'Running costs: date, category (rent, salary…), amount.',
  stock_count: 'A physical count: sets each product\'s stock to the counted quantity.',
  custom: 'Any other table. It is kept as-is and can be asked about by voice.',
};
const MODES: Record<ImportMode, string> = { append: 'Add as new rows', upsert: 'Update existing, add new', replace: 'Replace everything in this table' };

function csvEscape(v: unknown): string { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export function ImportWizard() {
  const nav = useNavigate();
  const bump = useApp((s) => s.bumpData);
  const dayFirstDefault = useSettings((s) => s.dayFirst);
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSummary | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState<number | undefined>(undefined);
  const [an, setAn] = useState<SheetSummary | null>(null);
  const [target, setTarget] = useState<ImportTarget>('products');
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [conf, setConf] = useState<Record<string, number>>({});
  const [customCols, setCustomCols] = useState<Array<ColumnSpec | null>>([]);
  const [tableName, setTableName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [dayFirst, setDayFirst] = useState(dayFirstDefault);
  const [mode, setMode] = useState<ImportMode>('append');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof db.previewImport>> | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [report, setReport] = useState<ImportReport | null>(null);
  const [undone, setUndone] = useState(false);

  useEffect(() => () => { void db.releaseParse(); }, []);

  const plan: ImportPlan = useMemo(() => ({ target, mapping, dayFirst, customColumns: target === 'custom' ? customCols : undefined }), [target, mapping, dayFirst, customCols]);

  async function onFile(file: File): Promise<void> {
    setError(null);
    if (file.size > 50 * 1024 * 1024) { setError('This file is larger than 50 MB. Split it into smaller files and import them one by one.'); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const p = await db.parseFile(bytes, file.name);
      setParsed(p);
      const first = p.sheets.findIndex((s) => !s.hidden && s.rows > 0);
      const idx = first >= 0 ? first : 0;
      setSheetIndex(idx);
      await analyze(p, idx, undefined);
      setStep(p.sheets.length > 1 ? 'sheet' : 'map');
    } catch (e) { setError(e instanceof Error ? e.message : 'The file could not be read.'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function analyze(p: ParsedSummary, idx: number, hdr: number | undefined): Promise<void> {
    const a = await db.analyzeSheet(p.parseId, idx, hdr);
    setAn(a);
    setHeaderRow(a.header.index);
    applyTarget(a, a.target);
    setTableName(a.suggestedTableName);
    setDisplayName((p.sheets.length > 1 ? a.sheetName : p.fileName.replace(/\.[a-z0-9]+$/i, '')).slice(0, 60));
    setCustomCols(a.customColumns);
  }

  function applyTarget(a: SheetSummary, t: ImportTarget): void {
    setTarget(t);
    setMode(t === 'products' ? 'upsert' : 'append');
    if (t === 'custom') { setMapping({}); setConf({}); return; }
    const m: Record<string, number | null> = {}, c: Record<string, number> = {};
    for (const s of a.mappings[t] ?? []) { m[s.field] = s.column; c[s.field] = s.confidence; }
    setMapping(m); setConf(c);
  }

  async function toPreview(): Promise<void> {
    if (!parsed) return;
    setBusy(true); setError(null);
    try {
      const pv = await db.previewImport(parsed.parseId, sheetIndex, plan, headerRow);
      if (!pv.ok) { setError(pv.problem); return; }
      setPreview(pv); setStep('preview');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function run(): Promise<void> {
    if (!parsed || !an) return;
    setConfirmReplace(false);
    setStep('running'); setError(null); setProgress({ done: 0, total: an.rowCount });
    try {
      const rep = await db.runImport({ parseId: parsed.parseId, sheetIndex, headerRow, plan, mode, customName: tableName, customDisplay: displayName }, (done: number, total: number) => setProgress({ done, total }));
      setReport(rep); setStep('done'); bump();
      if (rep.cancelled) toast('Import cancelled. Nothing was changed.', 'info');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStep('preview'); }
  }

  async function downloadFailed(): Promise<void> {
    if (!report) return;
    const lines = ['row,error,column,' + (an?.headers.map(csvEscape).join(',') ?? '')];
    for (const er of report.errors) lines.push([er.row, csvEscape(er.message), csvEscape(er.column ?? ''), ...(er.raw ?? []).map(csvEscape)].join(','));
    await saveFile(`failed-rows-${report.fileName.replace(/\.[a-z0-9]+$/i, '')}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  }

  async function undo(): Promise<void> {
    if (!report) return;
    setBusy(true);
    try { await db.undoImport(report.batchId); setUndone(true); bump(); toast('Import undone', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Undo failed', 'error'); }
    finally { setBusy(false); }
  }

  const fields = target === 'custom' ? [] : TARGET_FIELDS[target];
  const headerOptions = an?.headers ?? [];
  const back = (): void => { setError(null); setStep(step === 'preview' ? 'map' : step === 'map' && parsed && parsed.sheets.length > 1 ? 'sheet' : 'pick'); };

  return (
    <div data-testid="import-wizard">
      <div className="flex items-center gap-1 -ml-3 mb-3">
        <IconButton label="Back" onClick={() => (step === 'pick' || step === 'done' ? nav('/data') : back())} disabled={step === 'running'}><ArrowLeft className="size-5" /></IconButton>
        <div>
          <h1 className="text-xl font-bold">Import a file</h1>
          {parsed && <p className="text-sm text-muted">{parsed.fileName} · {formatNumber(parsed.sizeBytes / 1024, 0)} KB{parsed.encoding ? ` · ${parsed.encoding}` : ''}{parsed.delimiter ? ` · "${parsed.delimiter === '\t' ? 'tab' : parsed.delimiter}" separated` : ''}</p>}
        </div>
      </div>
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      {parsed?.duplicate && step !== 'done' && (
        <div className="mb-3 rounded-xl bg-warn-soft text-warn p-3 flex gap-2" role="alert"><AlertTriangle className="size-5 shrink-0" aria-hidden /><span>This looks like a duplicate import: the same file was imported before. Use "Update existing" to avoid double counting.</span></div>
      )}
      {parsed?.warnings.map((w) => <p key={w} className="text-sm text-warn mb-2">{w}</p>)}

      {step === 'pick' && (
        <Card>
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <FileSpreadsheet className="size-12 text-accent" aria-hidden />
            <p className="text-lg font-semibold">Choose an Excel or CSV file</p>
            <p className="text-muted max-w-md">Stock lists, sales registers, purchase bills or expense sheets. .xlsx, .xls, .xlsm, .ods and .csv up to 50 MB. Title rows, merged headers and totals rows are handled.</p>
            <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" data-testid="import-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
            <Button icon={<Upload className="size-5" />} busy={busy} onClick={() => fileInput.current?.click()}>Choose file</Button>
          </div>
        </Card>
      )}

      {step === 'sheet' && parsed && (
        <Card>
          <p className="font-semibold mb-2">This workbook has {parsed.sheets.length} sheets. Which one?</p>
          <ul className="space-y-2">
            {parsed.sheets.map((s) => (
              <li key={s.index}>
                <button type="button" disabled={!s.rows} onClick={async () => { setSheetIndex(s.index); setBusy(true); try { await analyze(parsed, s.index, undefined); setStep('map'); } finally { setBusy(false); } }}
                  className={cx('w-full min-h-12 px-4 rounded-xl border text-left flex justify-between items-center', s.index === sheetIndex ? 'border-accent bg-accent-soft' : 'border-line', !s.rows && 'opacity-50')}>
                  <span className="font-medium">{s.name}{s.hidden && <span className="text-muted font-normal"> (hidden)</span>}</span>
                  <span className="text-sm text-muted">{s.rows ? `${formatNumber(s.rows)} rows` : 'empty'}</span>
                </button>
              </li>
            ))}
          </ul>
          {busy && <div className="mt-3"><Spinner label="Reading sheet…" /></div>}
        </Card>
      )}

      {step === 'map' && an && parsed && (
        <div className="space-y-3">
          <Card>
            <p className="font-semibold">What is in this sheet?</p>
            <p className="text-sm text-muted mb-3">{formatNumber(an.rowCount)} data rows found{an.header.index > 0 ? `; header on row ${an.header.index + 1}${an.header.span === 2 ? ' (two-row header joined)' : ''}` : ''}.{an.tooManyRows ? ' This is a very large file: the import may take a while.' : ''}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2" role="radiogroup" aria-label="Import into">
              {TARGETS.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={target === t} onClick={() => applyTarget(an, t)} data-testid={`target-${t}`}
                  className={cx('rounded-xl border p-3 text-left min-h-12', target === t ? 'border-accent bg-accent-soft' : 'border-line')}>
                  <span className="font-semibold block">{TARGET_LABELS[t]}{an.target === t && <Badge tone="accent">Suggested</Badge>}</span>
                  <span className="text-xs text-muted">{TARGET_HELP[t]}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <Field label="Header row" hint="Change this if the column names look wrong">
                <Select value={headerRow ?? 0} onChange={async (e) => { const h = Number(e.target.value); setBusy(true); try { await analyze(parsed, sheetIndex, h); } finally { setBusy(false); } }}>
                  {an.preview.slice(0, 15).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter((c) => c != null && c !== '').slice(0, 4).map(String).join(' | ').slice(0, 60)}</option>)}
                </Select>
              </Field>
              <div><Toggle label="Dates are day first (India)" hint="03/04/2026 = 3 April 2026" checked={dayFirst} onChange={setDayFirst} /></div>
            </div>
          </Card>

          {target !== 'custom' ? (
            <Card testId="mapping">
              <p className="font-semibold mb-1">Match the columns</p>
              <p className="text-sm text-muted mb-3">Columns you do not match are kept as extra details, nothing is lost.</p>
              <div className="space-y-2">
                {fields.map((f) => (
                  <div key={f.key} className="grid grid-cols-[1fr_1.3fr] gap-2 items-center">
                    <label htmlFor={`map-${f.key}`} className="text-sm font-medium">{f.label}{f.required && <span className="text-neg"> *</span>}
                      {mapping[f.key] != null && conf[f.key] != null && <span className={cx('ml-1 text-xs', conf[f.key] >= 0.9 ? 'text-pos' : conf[f.key] >= 0.75 ? 'text-warn' : 'text-muted')}>{Math.round(conf[f.key] * 100)}%</span>}
                    </label>
                    <Select id={`map-${f.key}`} data-testid={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={(e) => { setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) })); setConf((c) => ({ ...c, [f.key]: 1 })); }}>
                      <option value="">— not in file —</option>
                      {headerOptions.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card testId="custom-columns">
              <Field label="Table name" hint={`Saved as ${tableName}`}><Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); setTableName(`u_${toIdentifier(e.target.value || 'table', 'table').replace(/^c_/, 't_').slice(0, 40)}`); }} /></Field>
              <p className="font-semibold mb-2">Columns</p>
              <div className="space-y-2">
                {an.customColumns.map((c, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
                    <input type="checkbox" className="size-5" checked={!!customCols[i]} aria-label={`Import ${c.display}`} onChange={(e) => setCustomCols((cols) => cols.map((x, j) => (j === i ? (e.target.checked ? an.customColumns[i] : null) : x)))} />
                    <span className="min-w-0"><span className="block truncate font-medium">{c.display}</span><span className="block text-xs text-muted truncate">{c.name}</span></span>
                    <Select className="!min-h-10 w-32" value={customCols[i]?.type ?? c.type} disabled={!customCols[i]} aria-label={`Type of ${c.display}`}
                      onChange={(e) => setCustomCols((cols) => cols.map((x, j) => (j === i && x ? { ...x, type: e.target.value as ColumnSpec['type'] } : x)))}>
                      {['TEXT', 'INTEGER', 'REAL', 'DATE'].map((t) => <option key={t}>{t}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <p className="font-semibold mb-1">Preview of the file</p>
            <DataTable columns={an.headers} rows={an.sample.slice(0, 8).map((r) => Object.fromEntries(an.headers.map((h, i) => [h, r[i] as unknown]))) as Row[]} pageSize={8} />
          </Card>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={back}>Back</Button><Button onClick={toPreview} busy={busy} data-testid="import-next">Check rows</Button></div>
        </div>
      )}

      {step === 'preview' && preview && an && (
        <div className="space-y-3">
          <Card>
            <p className="font-semibold">Ready to import into {TARGET_LABELS[target]}{target === 'custom' ? ` (${displayName})` : ''}</p>
            <p className="text-sm text-muted">Checked the first {formatNumber(preview.checked)} of {formatNumber(an.rowCount)} rows: {formatNumber(preview.checked - preview.errorCount)} look good{preview.errorCount ? `, ${formatNumber(preview.errorCount)} have problems and will be skipped` : ''}.</p>
            {preview.warnings.map((w) => <p key={w} className="text-sm text-warn mt-1">{w}</p>)}
            {preview.errors.length > 0 && (
              <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-neg min-h-10 flex items-center">Show row problems</summary>
                <ul className="text-sm mt-1 space-y-1 max-h-48 overflow-auto">{preview.errors.slice(0, 30).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
              </details>
            )}
          </Card>
          <Card>
            <p className="font-semibold mb-2">As it will be saved (first 20 rows)</p>
            {preview.rows.length ? <DataTable columns={Object.keys(preview.rows[0]).filter((c) => c !== '__row' && c !== 'extra')} rows={preview.rows} pageSize={20} /> : <p className="text-muted">No valid rows in the sample.</p>}
          </Card>
          <Card>
            <p className="font-semibold mb-2">How should rows be added?</p>
            <div className="space-y-2" role="radiogroup" aria-label="Import mode">
              {(Object.keys(MODES) as ImportMode[]).filter((m) => !(m === 'upsert' && (target === 'expenses' || target === 'stock_count' || target === 'custom'))).filter((m) => !(m === 'replace' && target === 'stock_count')).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-testid={`mode-${m}`}
                  className={cx('w-full min-h-12 px-4 rounded-xl border text-left', mode === m ? 'border-accent bg-accent-soft' : 'border-line', m === 'replace' && 'text-neg')}>{MODES[m]}{m === 'upsert' && target === 'products' ? ' (match by SKU, or by name)' : m === 'upsert' ? ' (match by invoice/bill number and product)' : ''}</button>
              ))}
            </div>
          </Card>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={back}>Back</Button><Button onClick={() => (mode === 'replace' ? setConfirmReplace(true) : void run())} data-testid="import-run">Import {formatNumber(an.rowCount)} rows</Button></div>
        </div>
      )}

      {step === 'running' && (
        <Card testId="import-progress">
          <p className="font-semibold mb-2">Importing…</p>
          <div className="h-3 rounded-full bg-surface2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total || 1} aria-valuenow={progress.done}>
            <div className="h-full bg-accent transition-all" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 5}%` }} />
          </div>
          <p className="text-sm text-muted mt-2">{formatNumber(progress.done)} of {formatNumber(progress.total)} rows</p>
          <Button variant="secondary" className="mt-3" onClick={() => void db.cancelImport()}>Cancel</Button>
        </Card>
      )}

      {step === 'done' && report && (
        <Card testId="import-report">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className={cx('size-6', report.cancelled ? 'text-muted' : 'text-pos')} aria-hidden />
            <p className="text-lg font-bold">{report.cancelled ? 'Import cancelled' : undone ? 'Import undone' : 'Import finished'}</p>
          </div>
          <dl className="grid grid-cols-3 gap-3 my-3">
            <div><dt className="text-sm text-muted">Imported</dt><dd className="text-2xl font-bold num" data-testid="report-ok">{formatNumber(report.rowsOk)}</dd></div>
            <div><dt className="text-sm text-muted">Skipped</dt><dd className={cx('text-2xl font-bold num', report.rowsFailed > 0 && 'text-neg')} data-testid="report-failed">{formatNumber(report.rowsFailed)}</dd></div>
            <div><dt className="text-sm text-muted">New products</dt><dd className="text-2xl font-bold num">{formatNumber(report.createdProducts)}</dd></div>
          </dl>
          {report.warnings.map((w) => <p key={w} className="text-sm text-warn mb-1">{w}</p>)}
          {report.errors.length > 0 && <ul className="text-sm my-2 space-y-1 max-h-40 overflow-auto">{report.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
          <div className="flex flex-wrap gap-2 mt-3">
            {report.errors.length > 0 && <Button variant="secondary" onClick={downloadFailed}>Download skipped rows</Button>}
            {!report.cancelled && !undone && <Button variant="secondary" onClick={undo} busy={busy} data-testid="import-undo">Undo import</Button>}
            {report.customTable && !undone && <Button variant="secondary" onClick={() => nav(`/ask?q=${encodeURIComponent(`How many rows are in ${displayName}?`)}`)}>Ask about this table</Button>}
            <Button onClick={() => nav('/data')}>Done</Button>
          </div>
        </Card>
      )}

      <Sheet open={confirmReplace} onClose={() => setConfirmReplace(false)} title="Replace the whole table?"
        footer={<><Button variant="secondary" onClick={() => setConfirmReplace(false)}>Cancel</Button><Button variant="danger" onClick={() => void run()} data-testid="confirm-replace">Replace</Button></>}>
        <p>Every existing row in {TARGET_LABELS[target]} will be removed and replaced with this file. You can still undo the import afterwards, but rows removed by Replace do not come back with it. Export a backup first if unsure.</p>
      </Sheet>
    </div>
  );
}
