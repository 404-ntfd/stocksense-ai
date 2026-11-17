import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { db } from '@/core/db/client';
import type { ProductRow } from '@/core/types';
import { formatINR, formatQty } from '@/core/util/money';
import { useDb, useDebounced } from '@/app/hooks';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from '@/app/ui';
import { AdjustSheet, ProductFormSheet } from './sheets';

const STATUS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }, { value: 'ok', label: 'OK' }, { value: 'overstock', label: 'Overstock' },
];
export const statusBadge = (s: string) => {
  const tone = s === 'out' ? 'neg' : s === 'low' ? 'warn' : s === 'overstock' ? 'info' : 'pos';
  return <Badge tone={tone}>{s === 'out' ? 'Out' : s === 'low' ? 'Low' : s === 'overstock' ? 'Overstock' : 'OK'}</Badge>;
};

export function Inventory() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const category = params.get('category') ?? '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search, 200);
  const [showFilters, setShowFilters] = useState(!!category);
  const [adding, setAdding] = useState(false);
  const [adjust, setAdjust] = useState<ProductRow | null>(null);
  const cats = useDb(() => db.listCategories(), []);
  // "low" on the dashboard means low or out, so the filter shows both
  const list = useDb(async () => {
    const rows = await db.listProducts({ search: q, category: category || undefined, status: status && status !== 'low' ? status : undefined });
    return status === 'low' ? rows.filter((r) => r.status === 'low' || r.status === 'out') : rows;
  }, [q, category, status]);
  const setParam = (k: string, v: string): void => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const totals = useMemo(() => {
    const rows = list.data ?? [];
    return { value: rows.reduce((s, r) => s + Math.max(0, r.stock) * r.cost, 0), count: rows.length };
  }, [list.data]);

  return (
    <div data-testid="page-inventory">
      <PageHeader title="Inventory" subtitle={list.data ? `${formatQty(totals.count)} products · ${formatINR(totals.value)} at cost` : undefined}
        right={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)} data-testid="add-product" className="hidden md:inline-flex">Add product</Button>} />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="size-5 absolute left-3 top-3.5 text-muted" aria-hidden />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); }} placeholder="Search name, SKU or category" className="pl-10" aria-label="Search products" data-testid="inventory-search" type="search" />
        </div>
        <button type="button" aria-label="Filters" aria-pressed={showFilters} onClick={() => setShowFilters((v) => !v)} className="size-12 shrink-0 rounded-xl border border-line bg-surface flex items-center justify-center text-muted">
          <SlidersHorizontal className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 py-3" role="group" aria-label="Stock status">
        {STATUS.map((s) => <Chip key={s.value} active={status === s.value} onClick={() => setParam('status', s.value)} testId={`status-${s.value || 'all'}`}>{s.label}</Chip>)}
      </div>
      {showFilters && (
        <div className="mb-3">
          <Select value={category} onChange={(e) => setParam('category', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {(cats.data ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      )}
      {list.error && !list.data && <ErrorState message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>}
      {list.data && list.data.length === 0 && (
        <Card><EmptyState icon={<Boxes />} title={q || status || category ? 'No products match' : 'No products yet'} text={q || status || category ? 'Try a different search or filter.' : 'Add your first product, or import a stock list from the Data screen.'}
          action={q || status || category ? <Button variant="secondary" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button> : <Button onClick={() => setAdding(true)}>Add product</Button>} /></Card>
      )}
      {list.data && list.data.length > 0 && (
        <Card className="!p-0 overflow-hidden" testId="product-list">
          <ul className="divide-y divide-line">
            {list.data.slice(0, 400).map((p) => (
              <li key={p.id} className="flex items-stretch">
                <button type="button" onClick={() => nav(`/inventory/${p.id}`)} className="flex-1 min-w-0 flex items-center justify-between gap-3 pl-4 pr-2 py-3 text-left hover:bg-surface2" data-testid="product-row">
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{p.name}</span>
                    <span className="block text-sm text-muted truncate">{p.sku} · {p.category}{p.days_of_cover != null ? ` · ${formatQty(p.days_of_cover)} days of cover` : ''}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    <span className={p.stock < 0 ? 'font-bold num text-neg' : 'font-bold num'}>{formatQty(p.stock)} <span className="text-sm font-normal text-muted">{p.unit}</span></span>
                    {statusBadge(p.status)}
                  </span>
                </button>
                <button type="button" onClick={() => setAdjust(p)} className="px-3 text-sm font-semibold text-accent border-l border-line hover:bg-accent-soft" aria-label={`Adjust stock of ${p.name}`}>Adjust</button>
              </li>
            ))}
          </ul>
          {list.data.length > 400 && <p className="p-3 text-sm text-muted text-center">Showing 400 of {list.data.length}. Search to narrow the list.</p>}
        </Card>
      )}
      <button type="button" aria-label="Add product" onClick={() => setAdding(true)} data-testid="fab-add-product"
        className="md:hidden fixed right-4 z-20 size-14 rounded-2xl bg-accent text-accent-ink shadow-lg flex items-center justify-center" style={{ bottom: 'calc(5.5rem + var(--sab))' }}>
        <Plus className="size-7" aria-hidden />
      </button>
      <ProductFormSheet open={adding} onClose={() => setAdding(false)} categories={cats.data ?? []} onSaved={(id) => nav(`/inventory/${id}`)} />
      <AdjustSheet open={!!adjust} onClose={() => setAdjust(null)} product={adjust} />
    </div>
  );
}
