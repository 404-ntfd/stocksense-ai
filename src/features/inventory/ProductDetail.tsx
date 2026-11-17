import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { db } from '@/core/db/client';
import { forecastProduct } from '@/core/analytics/forecast';
import { formatDate, todayISO } from '@/core/util/dates';
import { formatINR, formatPct, formatQty, ratio } from '@/core/util/money';
import { chartTheme, forecastChart, lineChart } from '@/app/charts';
import { useDb, useIsDark } from '@/app/hooks';
import { toast, useApp } from '@/app/store';
import { Badge, Button, Card, ErrorState, IconButton, SectionTitle, Sheet, Skeleton } from '@/app/ui';
import { ChartCard } from '@/app/widgets';
import { AdjustSheet, ProductFormSheet } from './sheets';
import { statusBadge } from './Inventory';

const KIND_LABEL: Record<string, string> = { opening: 'Opening stock', purchase: 'Purchase', sale: 'Sale', return_in: 'Return in', return_out: 'Return to supplier', adjustment: 'Adjustment', damage: 'Damage', count: 'Stock count' };

export function ProductDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const nav = useNavigate();
  const dark = useIsDark();
  const bump = useApp((s) => s.bumpData);
  const today = todayISO();
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const d = useDb(() => db.productDetail(pid, today), [pid, today], { watchForecast: true });
  const cats = useDb(() => db.listCategories(), []);
  const fc = useDb(async () => {
    const input = await db.forecastInput(today, pid);
    const p = input.products[0];
    return p ? forecastProduct(p, today) : null;
  }, [pid, today]);
  const t = useMemo(() => chartTheme(dark), [dark]);

  const option = useMemo(() => {
    if (!d.data) return null;
    const hist = d.data.history.slice(-60);
    if (fc.data?.daily && hist.some((h) => h.units > 0)) {
      return forecastChart(t, { name: d.data.product.name, unit: d.data.product.unit, history: hist, daily: fc.data.daily, sigma: fc.data.sigma ?? 0, stock: d.data.product.stock, stockout: fc.data.predicted_stockout_date, today });
    }
    return hist.some((h) => h.units > 0) ? lineChart(t, hist.map((h) => h.day), [{ name: 'Units sold per day', data: hist.map((h) => h.units) }], 'qty') : null;
  }, [d.data, fc.data, t, today]);

  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return d.loading ? <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>
    : <Card><p className="mb-3">This product was not found.</p><Button onClick={() => nav('/inventory')}>Back to inventory</Button></Card>;
  const { product: p, movements, totals } = d.data;
  const margin = p.cost > 0 ? ratio(p.price - p.cost, p.price) : null;
  const f = fc.data;

  async function remove(): Promise<void> {
    try {
      const r = await db.removeProduct(pid);
      bump();
      toast(r === 'archived' ? `${p.name} was archived (it has sales history, so it is hidden, not deleted)` : `${p.name} was deleted`, 'ok', r === 'archived' ? { label: 'Undo', run: () => { void db.restoreProduct(pid).then(bump); } } : undefined);
      nav('/inventory');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not remove the product', 'error'); }
  }

  return (
    <div data-testid="product-detail">
      <div className="flex items-center gap-1 -ml-3 mb-1">
        <IconButton label="Back" onClick={() => (history.length > 1 ? nav(-1) : nav('/inventory'))}><ArrowLeft className="size-5" /></IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate" data-testid="product-title">{p.name}</h1>
          <p className="text-sm text-muted truncate">{p.sku} · {p.category}{p.supplier ? ` · ${p.supplier}` : ''}</p>
        </div>
        <IconButton label="Edit product" onClick={() => setEdit(true)}><Pencil className="size-5" /></IconButton>
      </div>
      {!p.is_active && <div className="rounded-xl bg-warn-soft text-warn p-3 mb-3 flex items-center justify-between gap-2"><span>This product is archived.</span><Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => { void db.restoreProduct(pid).then(bump); }}>Restore</Button></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="!p-3.5"><p className="text-sm text-muted">In stock</p><p className={`text-[28px] leading-9 font-bold num ${p.stock < 0 ? 'text-neg' : ''}`} data-testid="product-stock">{formatQty(p.stock)} <span className="text-base font-normal text-muted">{p.unit}</span></p><div className="mt-1">{statusBadge(p.status)}</div></Card>
        <Card className="!p-3.5"><p className="text-sm text-muted">Days of cover</p><p className="text-[28px] leading-9 font-bold num">{p.days_of_cover == null ? '–' : formatQty(p.days_of_cover)}</p><p className="text-sm text-muted">reorder at {formatQty(p.reorder_level)}</p></Card>
        <Card className="!p-3.5"><p className="text-sm text-muted">Price / cost</p><p className="text-[28px] leading-9 font-bold num">{formatINR(p.price, { decimals: p.price % 1 ? 2 : 0 })}</p><p className="text-sm text-muted">cost {p.cost > 0 ? formatINR(p.cost, { decimals: 2 }) : 'not set'} · margin {margin == null ? '–' : formatPct(margin * 100)}</p></Card>
        <Card className="!p-3.5"><p className="text-sm text-muted">Last 90 days</p><p className="text-[28px] leading-9 font-bold num">{formatINR(totals.revenue90)}</p><p className="text-sm text-muted">{formatQty(totals.units90)} sold · profit {formatINR(totals.profit90)}</p></Card>
      </div>
      {p.stock < 0 && (
        <div className="mt-3 rounded-xl bg-neg-soft p-3 flex items-center justify-between gap-2" role="alert">
          <span>Stock is negative: more was sold than was recorded as received.</span>
          <Button size="sm" onClick={() => setAdjust(true)}>Fix stock</Button>
        </div>
      )}
      <div className="flex gap-2 mt-3 flex-wrap">
        <Button onClick={() => setAdjust(true)} data-testid="adjust-stock">Adjust stock</Button>
        <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => nav(`/ask?q=${encodeURIComponent(`When will ${p.name} run out?`)}`)}>Ask about it</Button>
      </div>

      <div className="mt-4">
        <ChartCard testId="product-chart" title="When will it run out?" subtitle={f ? `Last 60 days and the next 30 (estimate based on your past sales)` : 'Units sold per day, last 60 days'} option={option} height={260}
          columns={['day', 'units']} rows={d.data.history.slice(-60)} empty="No sales in the last 60 days"
          right={f ? <Badge tone={f.confidence === 'high' ? 'pos' : f.confidence === 'medium' ? 'warn' : 'neutral'}>{f.confidence} confidence</Badge> : undefined}
          footer={f ? (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
              <div><dt className="text-muted">Next 7 days</dt><dd className="font-semibold num">{formatQty(Math.round(f.forecast_7d))} {p.unit}</dd></div>
              <div><dt className="text-muted">Next 30 days</dt><dd className="font-semibold num">{formatQty(Math.round(f.forecast_30d))} ({formatQty(Math.round(f.band_low_30d))}–{formatQty(Math.round(f.band_high_30d))})</dd></div>
              <div><dt className="text-muted">Runs out around</dt><dd className="font-semibold">{f.predicted_stockout_date ? formatDate(f.predicted_stockout_date) : 'not within 6 months'}</dd></div>
              <div><dt className="text-muted">Suggested order</dt><dd className="font-semibold num">{f.suggested_reorder_qty ? `${formatQty(f.suggested_reorder_qty)} ${p.unit}` : 'none needed'}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted mt-2">Forecasts need some sales history for this product.</p>} />
      </div>

      <SectionTitle>Stock movements</SectionTitle>
      <Card className="!p-0">
        {movements.length === 0 ? <p className="p-4 text-muted">No movements yet.</p> : (
          <ul className="divide-y divide-line" data-testid="movements">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span><span className="block font-medium">{KIND_LABEL[m.kind] ?? m.kind}</span><span className="text-sm text-muted">{formatDate(m.move_date)}{m.note ? ` · ${m.note}` : ''}</span></span>
                <span className={`num font-semibold ${m.qty_delta < 0 ? 'text-neg' : 'text-pos'}`}>{m.qty_delta > 0 ? '+' : ''}{formatQty(m.qty_delta)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!!p.is_active && <div className="mt-6"><Button variant="secondary" icon={<Archive className="size-4" />} onClick={() => setConfirmRemove(true)} data-testid="remove-product">Remove product</Button></div>}

      <ProductFormSheet open={edit} onClose={() => setEdit(false)} product={p} categories={cats.data ?? []} />
      <AdjustSheet open={adjust} onClose={() => setAdjust(false)} product={p} />
      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove this product?"
        footer={<><Button variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="danger" onClick={remove} data-testid="confirm-remove">Remove</Button></>}>
        <p>Products with sales or purchase history are archived: they disappear from lists but their history stays in your reports. Products with no history are deleted.</p>
      </Sheet>
    </div>
  );
}
