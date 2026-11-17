import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Download, Pencil, Search, Trash2 } from 'lucide-react';
import { db } from '@/core/db/client';
import { colKind, firstNonNull, formatCell, prettyName } from '@/core/ask/format';
import { BASE_TABLES } from '@/core/db/semantic';
import { formatNumber } from '@/core/util/money';
import { useDb, useDebounced } from '@/app/hooks';
import { toast, useApp } from '@/app/store';
import { Button, Card, cx, ErrorState, IconButton, Input, Sheet, Skeleton } from '@/app/ui';
import { EntrySheet, type EntryKind } from './EntrySheet';
import { exportTable } from './DataScreen';

const PAGE = 50;
const ENTRY: Record<string, EntryKind> = { sales: 'sale', purchases: 'purchase', expenses: 'expense' };

export function TableView() {
  const { name = '' } = useParams();
  const nav = useNavigate();
  const bump = useApp((s) => s.bumpData);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'id', dir: 'desc' });
  const [del, setDel] = useState<number | null>(null);
  const [edit, setEdit] = useState<number | null>(null);
  const data = useDb(() => db.browse(name, { offset: page * PAGE, limit: PAGE, search: q, sort: sort.col, dir: sort.dir }), [name, page, q, sort.col, sort.dir]);
  const label = BASE_TABLES.find((t) => t.name === name)?.label ?? name.replace(/^u_/, '').replace(/_/g, ' ');
  const cols = (data.data?.columns ?? []).filter((c) => c !== 'id');
  const kinds = cols.map((c) => colKind(c, firstNonNull(data.data?.rows ?? [], c)));
  const total = data.data?.total ?? 0;
  const canEdit = !!ENTRY[name];
  const editable = data.data?.editable;

  async function remove(id: number): Promise<void> {
    setDel(null);
    try { await db.deleteRow(name, id); bump(); toast('Row deleted', 'ok'); } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete', 'error'); }
  }
  const toggleSort = (c: string): void => setSort((s) => (s.col === c ? { col: c, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'asc' }));

  return (
    <div data-testid="table-view">
      <div className="flex items-center gap-1 -ml-3 mb-3">
        <IconButton label="Back" onClick={() => nav('/data')}><ArrowLeft className="size-5" /></IconButton>
        <div className="flex-1 min-w-0"><h1 className="text-xl font-bold truncate capitalize">{label}</h1><p className="text-sm text-muted">{formatNumber(total)} rows</p></div>
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportTable(name, label, 'csv').catch((e: Error) => toast(e.message, 'error'))}>CSV</Button>
        <Button size="sm" variant="secondary" onClick={() => void exportTable(name, label, 'xlsx').catch((e: Error) => toast(e.message, 'error'))}>XLSX</Button>
      </div>
      <div className="relative mb-3">
        <Search className="size-5 absolute left-3 top-3.5 text-muted" aria-hidden />
        <Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search this table" className="pl-10" aria-label="Search table" />
      </div>
      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
      {!data.data && !data.error && <Skeleton className="h-96" />}
      {data.data && (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse" data-testid="grid">
              <thead><tr className="bg-surface2 text-left">
                {cols.map((c, i) => (
                  <th key={c} scope="col" className={cx('px-3 py-2.5 font-semibold whitespace-nowrap', kinds[i] !== 'text' && kinds[i] !== 'date' && 'text-right')}>
                    <button type="button" onClick={() => toggleSort(c)} className="inline-flex items-center gap-1 min-h-8">{prettyName(c)}{sort.col === c && (sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}</button>
                  </th>
                ))}
                {editable && <th className="px-2" aria-label="Actions" />}
              </tr></thead>
              <tbody>
                {data.data.rows.map((r) => (
                  <tr key={String(r.id)} className="border-t border-line">
                    {cols.map((c, i) => <td key={c} className={cx('px-3 py-2 num', kinds[i] === 'text' ? 'min-w-28 max-w-72 truncate' : 'whitespace-nowrap text-right', kinds[i] === 'date' && '!text-left', typeof r[c] === 'number' && (r[c] as number) < 0 && 'text-neg')}>{formatCell(r[c], kinds[i])}</td>)}
                    {editable && (
                      <td className="px-1 whitespace-nowrap text-right">
                        {canEdit && <IconButton label="Edit row" className="!size-10" onClick={() => setEdit(Number(r.id))}><Pencil className="size-4" /></IconButton>}
                        <IconButton label="Delete row" className="!size-10" onClick={() => setDel(Number(r.id))}><Trash2 className="size-4" /></IconButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.data.rows.length && <p className="p-4 text-muted text-center">{q ? 'No rows match your search.' : 'This table is empty.'}</p>}
        </Card>
      )}
      {total > PAGE && (
        <div className="flex items-center justify-between mt-3">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
          <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
      <Sheet open={del != null} onClose={() => setDel(null)} title="Delete this row?" footer={<><Button variant="secondary" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" onClick={() => del != null && void remove(del)} data-testid="confirm-delete-row">Delete</Button></>}>
        <p>The row is removed{name === 'sales' || name === 'purchases' ? ' and the stock it moved is put back' : ''}. This cannot be undone.</p>
      </Sheet>
      <EntrySheet kind={edit != null ? ENTRY[name] : null} editId={edit} onClose={() => setEdit(null)} />
    </div>
  );
}
