import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileUp, HardDriveDownload, HardDriveUpload, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { db } from '@/core/db/client';
import { formatDate, todayISO } from '@/core/util/dates';
import { formatNumber } from '@/core/util/money';
import { TARGET_LABELS } from '@/core/import/mapping';
import { saveFile } from '@/app/services';
import { useDb } from '@/app/hooks';
import { useSettings } from '@/app/settings';
import { toast, useApp } from '@/app/store';
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, SectionTitle, Sheet, Skeleton } from '@/app/ui';
import { EntrySheet, type EntryKind } from './EntrySheet';

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown): string => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [columns.map(esc).join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n');
}

export async function exportTable(name: string, label: string, format: 'csv' | 'xlsx'): Promise<void> {
  const { columns, rows } = await db.exportRows(name);
  const base = `${label.replace(/[^\w-]+/g, '-')}-${todayISO()}`;
  if (format === 'csv') { await saveFile(`${base}.csv`, toCsv(columns, rows), 'text/csv'); return; }
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, label.slice(0, 31) || 'Sheet1');
  await saveFile(`${base}.xlsx`, new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function DataScreen() {
  const nav = useNavigate();
  const bump = useApp((s) => s.bumpData);
  const setSettings = useSettings((s) => s.set);
  const tables = useDb(() => db.tableList(), []);
  const imports = useDb(() => db.listImports(20), []);
  const restoreInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'clear' | 'demo' | { restore: Uint8Array; name: string } | { undo: string; name: string }>(null);
  const [clearText, setClearText] = useState('');
  const [entry, setEntry] = useState<EntryKind | null>(null);

  async function backup(): Promise<void> {
    setBusy('backup');
    try { await db.flush(); const bytes = await db.snapshot(); await saveFile(`stocksense-backup-${todayISO()}.stocksense`, bytes, 'application/x-sqlite3'); toast('Backup saved', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Backup failed', 'error'); }
    finally { setBusy(null); }
  }
  async function doRestore(bytes: Uint8Array): Promise<void> {
    setBusy('restore'); setConfirm(null);
    try { await db.restore(bytes); bump(); toast('Backup restored', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Restore failed', 'error'); }
    finally { setBusy(null); }
  }
  async function doDemo(): Promise<void> {
    setBusy('demo'); setConfirm(null);
    try { await db.loadDemo(todayISO()); setSettings({ businessName: 'Sree Krishna Stores' }); bump(); toast('Demo data loaded', 'ok'); nav('/'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not load demo data', 'error'); }
    finally { setBusy(null); }
  }
  async function doClear(): Promise<void> {
    setBusy('clear'); setConfirm(null); setClearText('');
    try { await db.clearAll(); bump(); toast('All data cleared', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not clear data', 'error'); }
    finally { setBusy(null); }
  }
  async function doUndo(id: string): Promise<void> {
    setConfirm(null);
    try { const r = await db.undoImport(id); bump(); toast(`Import undone: ${formatNumber(r.removed)} rows removed${r.keptProducts ? `, ${r.keptProducts} products kept because later data uses them` : ''}`, 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Undo failed', 'error'); }
  }

  return (
    <div data-testid="page-data">
      <PageHeader title="Data" subtitle="Import, browse, export and back up your data" />
      <div className="grid grid-cols-2 gap-3">
        <Card onClick={() => nav('/data/import')} testId="open-import" className="!p-4"><FileUp className="size-6 text-accent mb-2" aria-hidden /><p className="font-bold">Import a file</p><p className="text-sm text-muted">Excel or CSV</p></Card>
        <Card onClick={() => setEntry('sale')} testId="add-entry" className="!p-4"><Plus className="size-6 text-accent mb-2" aria-hidden /><p className="font-bold">Add an entry</p><p className="text-sm text-muted">Sale, purchase or expense</p></Card>
      </div>

      <SectionTitle>Tables</SectionTitle>
      {tables.error && <ErrorState message={tables.error} onRetry={tables.reload} />}
      {!tables.data && !tables.error && <Skeleton className="h-64" />}
      {tables.data && (
        <Card className="!p-0" testId="table-list">
          <ul className="divide-y divide-line">
            {tables.data.map((t) => (
              <li key={t.name}>
                <button type="button" onClick={() => nav(`/data/table/${t.name}`)} className="w-full flex items-center justify-between gap-3 px-4 min-h-14 text-left hover:bg-surface2" data-testid={`table-${t.name}`}>
                  <span className="min-w-0"><span className="font-medium">{t.label}</span>{t.isCustom && <span className="ml-2"><Badge tone="accent">Custom</Badge></span>}</span>
                  <span className="text-muted num">{formatNumber(t.rows)} rows</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SectionTitle>Import history</SectionTitle>
      <Card className="!p-0" testId="import-history">
        {!imports.data?.length ? <p className="p-4 text-muted">No imports yet.</p> : (
          <ul className="divide-y divide-line">
            {imports.data.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium truncate">{b.file_name}</span>
                  <span className="block text-sm text-muted">{TARGET_LABELS[b.target as keyof typeof TARGET_LABELS] ?? b.target} · {formatNumber(b.rows_ok)} rows{b.rows_failed ? `, ${formatNumber(b.rows_failed)} skipped` : ''} · {formatDate(b.created_at?.slice(0, 10))}</span>
                </span>
                {b.status === 'done' ? <Button size="sm" variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setConfirm({ undo: b.id, name: b.file_name })}>Undo</Button> : <Badge>{b.status}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>Backup and restore</SectionTitle>
      <Card>
        <p className="text-sm text-muted mb-3">A backup is one .stocksense file with all your products, sales, purchases and expenses. It never contains your AI key. Keep it somewhere safe (email it to yourself or save it to Drive).</p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<HardDriveDownload className="size-5" />} onClick={backup} busy={busy === 'backup'} data-testid="backup">Save backup</Button>
          <Button variant="secondary" icon={<HardDriveUpload className="size-5" />} onClick={() => restoreInput.current?.click()} busy={busy === 'restore'}>Restore backup</Button>
          <input ref={restoreInput} type="file" accept=".stocksense,.sqlite,.db,application/octet-stream,application/x-sqlite3" className="sr-only" data-testid="restore-file"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setConfirm({ restore: new Uint8Array(await f.arrayBuffer()), name: f.name }); e.target.value = ''; }} />
        </div>
      </Card>

      <SectionTitle>Export</SectionTitle>
      <Card>
        <p className="text-sm text-muted mb-3">Download any table as CSV (opens in Excel) or as an Excel file.</p>
        <div className="flex flex-wrap gap-2">
          {[['v_sales', 'Sales'], ['v_products', 'Products'], ['v_purchases', 'Purchases'], ['v_expenses', 'Expenses'], ['v_daily_summary', 'Daily summary']].map(([n, l]) => (
            <Button key={n} size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportTable(n, l, 'csv').catch((er: Error) => toast(er.message, 'error'))}>{l}</Button>
          ))}
        </div>
      </Card>

      <SectionTitle>Demo and reset</SectionTitle>
      <Card>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => setConfirm('demo')} busy={busy === 'demo'} data-testid="data-load-demo">Load demo data</Button>
          <Button variant="secondary" icon={<Trash2 className="size-4" />} className="!text-neg" onClick={() => setConfirm('clear')} busy={busy === 'clear'} data-testid="clear-all">Clear all data</Button>
        </div>
      </Card>

      <EntrySheet kind={entry} onClose={() => setEntry(null)} onKind={setEntry} />
      <Sheet open={confirm === 'demo'} onClose={() => setConfirm(null)} title="Load demo data?" footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button onClick={doDemo} data-testid="confirm-demo">Load demo</Button></>}>
        <p>This replaces all your current data with the demo shop "Sree Krishna Stores" (150 products, 18 months of sales). Save a backup first if you want to keep what you have.</p>
      </Sheet>
      <Sheet open={confirm === 'clear'} onClose={() => { setConfirm(null); setClearText(''); }} title="Clear all data?" footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" disabled={clearText.trim().toUpperCase() !== 'DELETE'} onClick={doClear} data-testid="confirm-clear">Clear everything</Button></>}>
        <p className="mb-3">Every product, sale, purchase, expense and import on this device will be deleted. This cannot be undone.</p>
        <Field label='Type DELETE to confirm'><Input value={clearText} onChange={(e) => setClearText(e.target.value)} data-testid="clear-confirm-text" /></Field>
      </Sheet>
      <Sheet open={!!confirm && typeof confirm === 'object' && 'restore' in confirm} onClose={() => setConfirm(null)} title="Restore this backup?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={() => confirm && typeof confirm === 'object' && 'restore' in confirm && void doRestore(confirm.restore)} data-testid="confirm-restore">Restore</Button></>}>
        <p>{confirm && typeof confirm === 'object' && 'restore' in confirm ? `"${confirm.name}" will replace all the data on this device.` : ''}</p>
      </Sheet>
      <Sheet open={!!confirm && typeof confirm === 'object' && 'undo' in confirm} onClose={() => setConfirm(null)} title="Undo this import?"
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={() => confirm && typeof confirm === 'object' && 'undo' in confirm && void doUndo(confirm.undo)} data-testid="confirm-undo">Undo import</Button></>}>
        <p>{confirm && typeof confirm === 'object' && 'undo' in confirm ? `All rows added by "${confirm.name}" and the stock movements they caused will be removed. Rows it updated get their old values back. Products it created are kept if later sales or purchases use them.` : ''}</p>
      </Sheet>
    </div>
  );
}
