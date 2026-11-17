import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, RefreshCw, Sparkles } from 'lucide-react';
import { db } from '@/core/db/client';
import type { DashboardData } from '@/core/types';
import { formatDate, monthLabel, todayISO, type PeriodKey } from '@/core/util/dates';
import { formatINR, formatPct, formatQty } from '@/core/util/money';
import { barChart, chartTheme, comboChart, donutChart, lineChart, movingAverage } from '@/app/charts';
import { useDb, useIsDark } from '@/app/hooks';
import { useSettings } from '@/app/settings';
import { toast, useApp } from '@/app/store';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, IconButton, PageHeader, SectionTitle, Sheet, Skeleton } from '@/app/ui';
import { ChartCard, KpiCard } from '@/app/widgets';

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Today' }, { key: '7d', label: '7D' }, { key: '30d', label: '30D' }, { key: 'month', label: 'This month' }, { key: 'fy', label: 'FY' },
];

const EXPLAIN: Record<string, { title: string; text: string }> = {
  revenue: { title: 'Revenue', text: 'Quantity × unit price, minus discounts, excluding tax, for every sale in the period. The arrow compares it with the period of the same length just before.' },
  grossProfit: { title: 'Gross profit', text: 'Revenue minus the cost of the goods sold (quantity × cost price at the time of sale). Margin % is gross profit divided by revenue.' },
  netProfit: { title: 'Net profit', text: 'Gross profit minus the expenses you recorded (rent, salary, electricity, transport…) in the period.' },
  inventory: { title: 'Inventory value', text: 'Stock on hand × cost price, added up over every product that is in stock right now.' },
  lowStock: { title: 'Low stock', text: 'Products whose stock is at or below their reorder level. Products with zero or negative stock are counted as out of stock.' },
  deadStock: { title: 'Dead stock', text: 'The cost value of products that are in stock but have not sold for 90 days or more, and its share of total inventory value.' },
};

export function Dashboard() {
  const nav = useNavigate();
  const dark = useIsDark();
  const period = useSettings((s) => s.period) as PeriodKey;
  const setSettings = useSettings((s) => s.set);
  const businessName = useSettings((s) => s.businessName);
  const bump = useApp((s) => s.bumpData);
  const [explain, setExplain] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const today = todayISO();
  const { data, error, loading, reload } = useDb<DashboardData>(() => db.dashboard(period, today), [period, today]);
  const t = useMemo(() => chartTheme(dark), [dark]);
  const ask = (q: string): void => { nav(`/ask?q=${encodeURIComponent(q)}`); };

  const charts = useMemo(() => {
    if (!data) return null;
    const trendVals = data.trend.map((p) => p.revenue);
    const withMa = data.trend.length > 14;
    const cats = data.categories.length > 6
      ? [...data.categories.slice(0, 5), { category: 'Others', revenue: Math.round(data.categories.slice(5).reduce((s, c) => s + c.revenue, 0) * 100) / 100 }]
      : data.categories;
    return {
      trend: trendVals.some((v) => v > 0) ? lineChart(t, data.trend.map((p) => p.day), withMa ? [{ name: 'Daily revenue', data: trendVals, width: 1.5 }, { name: '7-day average', data: movingAverage(trendVals), color: t.ink, width: 2 }] : [{ name: 'Daily revenue', data: trendVals }], 'money') : null,
      monthly: data.monthly.length ? comboChart(t, data.monthly.map((m) => m.month), { name: 'Revenue', data: data.monthly.map((m) => m.revenue) }, { name: 'Gross profit', data: data.monthly.map((m) => m.gross_profit) }, 'money') : null,
      cats, donut: cats.length ? donutChart(t, cats.map((c) => c.category), cats.map((c) => c.revenue), 'money') : null,
      top: data.topProducts.length ? barChart(t, data.topProducts.map((p) => p.name), data.topProducts.map((p) => p.revenue), 'money', { horizontal: true }) : null,
    };
  }, [data, t]);

  async function loadDemo(): Promise<void> {
    setLoadingDemo(true);
    try { await db.loadDemo(today); if (!businessName) setSettings({ businessName: 'Sree Krishna Stores' }); bump(); toast('Demo data loaded', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not load demo data', 'error'); }
    finally { setLoadingDemo(false); }
  }

  if (error && !data) return <><PageHeader title="Home" /><ErrorState message={`The dashboard could not be loaded: ${error}`} onRetry={reload} /></>;
  if (!data) {
    return (
      <div aria-busy="true" data-testid="dashboard-loading">
        <PageHeader title={businessName || 'Home'} />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-64 mt-4" />
      </div>
    );
  }
  const k = data.kpis;
  if (!data.hasData) {
    return (
      <div data-testid="dashboard-empty">
        <PageHeader title={businessName || 'Home'} subtitle={`As of ${formatDate(today)}`} />
        <Card>
          <EmptyState icon={<Database />} title="No data yet" text="Load the demo shop to look around, or import your own stock list and sales register."
            action={<div className="flex flex-col sm:flex-row gap-2"><Button onClick={loadDemo} busy={loadingDemo} data-testid="load-demo">Try with demo data</Button><Button variant="secondary" onClick={() => nav('/data/import')}>Import my file</Button></div>} />
        </Card>
      </div>
    );
  }
  const rangeText = data.range.from === data.range.to ? formatDate(data.range.from) : `${formatDate(data.range.from)} – ${formatDate(data.range.to)}`;
  return (
    <div data-testid="dashboard" aria-busy={loading}>
      <PageHeader title={businessName || 'Home'} subtitle={`As of ${formatDate(data.asOf)}`} right={<IconButton label="Refresh" onClick={reload}><RefreshCw className={loading ? 'size-5 animate-spin' : 'size-5'} /></IconButton>} />
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1" role="group" aria-label="Period">
        {PERIODS.map((p) => <Chip key={p.key} active={p.key === period} onClick={() => setSettings({ period: p.key })} testId={`period-${p.key}`}>{p.label}</Chip>)}
      </div>
      <p className="text-sm text-muted mt-2 mb-3">{data.range.label} · {rangeText} · change is against the previous period</p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard testId="kpi-revenue" label="Revenue" value={formatINR(k.revenue.value)} delta={k.revenue.deltaPct} sub={`${formatQty(k.orders.value)} orders`} onClick={() => ask(`Sales trend ${period === 'fy' ? 'this fy' : period === 'month' ? 'this month' : period === 'today' ? 'last 7 days' : `last ${period === '7d' ? 7 : 30} days`}`)} onExplain={() => setExplain('revenue')} />
        <KpiCard testId="kpi-profit" label="Gross profit" value={formatINR(k.grossProfit.value)} delta={k.grossProfit.deltaPct} sub={k.marginPct.value == null ? 'margin –' : `margin ${formatPct(k.marginPct.value)}`} onClick={() => ask('Margin by category')} onExplain={() => setExplain('grossProfit')} />
        <KpiCard testId="kpi-net" label="Net profit" value={formatINR(k.netProfit.value)} delta={k.netProfit.deltaPct} sub={`expenses ${formatINR(k.expenses.value)}`} tone={(k.netProfit.value ?? 0) < 0 ? 'neg' : undefined} onClick={() => ask('Expenses by category')} onExplain={() => setExplain('netProfit')} />
        <KpiCard testId="kpi-inventory" label="Inventory value" value={formatINR(k.inventoryValue)} sub={`${formatQty(k.productCount)} products`} onClick={() => nav('/inventory')} onExplain={() => setExplain('inventory')} />
        <KpiCard testId="kpi-lowstock" label="Low stock" value={formatQty(k.lowStock + k.outOfStock)} sub={k.outOfStock ? `${k.outOfStock} out of stock` : 'none out of stock'} tone={k.outOfStock ? 'neg' : k.lowStock ? 'warn' : undefined} onClick={() => nav('/inventory?status=low')} onExplain={() => setExplain('lowStock')} />
        <KpiCard testId="kpi-dead" label="Dead stock" value={formatINR(k.deadStockValue)} sub={k.deadStockPct == null ? 'no stock' : `${formatPct(k.deadStockPct)} of inventory`} onClick={() => nav('/insights')} onExplain={() => setExplain('deadStock')} />
      </div>

      <div className="grid md:grid-cols-2 gap-3 mt-4">
        <ChartCard testId="chart-trend" title="Are sales going up?" subtitle={`Daily revenue${data.trend.length > 14 ? ' with 7-day average' : ''}`} option={charts!.trend} columns={['day', 'revenue', 'gross_profit']} rows={data.trend} empty="No sales in this period" />
        <ChartCard testId="chart-monthly" title="Am I making money?" subtitle="Revenue and gross profit by month" option={charts!.monthly} columns={['month', 'revenue', 'gross_profit']} rows={data.monthly} empty="No sales yet" />
        <ChartCard testId="chart-top" title="What sells best?" subtitle={`Top 5 products by revenue, ${data.range.label.toLowerCase()}`} option={charts!.top} height={220} columns={['name', 'revenue', 'units', 'gross_profit']} rows={data.topProducts} empty="No sales in this period" onPoint={(name) => ask(`Sales of ${name} last 30 days`)} />
        <ChartCard testId="chart-category" title="Where does revenue come from?" subtitle={`Share by category, ${data.range.label.toLowerCase()}`} option={charts!.donut} height={270} columns={['category', 'revenue']} rows={data.categories} empty="No sales in this period" />
      </div>

      <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => nav('/inventory?status=low')}>See all</Button>}>Running low</SectionTitle>
      <Card className="!p-0" testId="low-stock-list">
        {data.lowStockList.length === 0 ? <p className="p-4 text-muted">Nothing is at or below its reorder level.</p> : (
          <ul className="divide-y divide-line">
            {data.lowStockList.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => nav(`/inventory/${p.id}`)} className="w-full flex items-center justify-between gap-3 px-4 min-h-14 text-left hover:bg-surface2">
                  <span className="min-w-0"><span className="block font-medium truncate">{p.name}</span><span className="text-sm text-muted">reorder at {formatQty(p.reorder_level)} {p.unit}</span></span>
                  <span className="flex items-center gap-2 shrink-0"><span className={p.stock <= 0 ? 'font-bold num text-neg' : 'font-bold num'}>{formatQty(p.stock)}</span><Badge tone={p.status === 'out' ? 'neg' : 'warn'}>{p.status === 'out' ? 'Out' : 'Low'}</Badge></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>Ask about this</SectionTitle>
      <div className="flex gap-2 flex-wrap">
        {['What should I reorder?', `Top 5 products ${period === 'fy' ? 'this fy' : 'this month'}`, 'Compare this month vs last month', 'Show dead stock', 'Which day is busiest?'].map((q) => (
          <Chip key={q} onClick={() => ask(q)}><Sparkles className="size-3.5 inline -mt-0.5 mr-1 text-accent" aria-hidden />{q}</Chip>
        ))}
      </div>
      <div className="mt-4"><Button variant="secondary" onClick={() => nav('/insights')} data-testid="open-insights">Open Insights: reorder list, dead stock, ABC</Button></div>
      <p className="text-xs text-muted mt-4">Figures use this device's date ({formatDate(today)}). Months: {data.monthly.length ? `${monthLabel(data.monthly[0].month)} to ${monthLabel(data.monthly[data.monthly.length - 1].month)}` : 'none yet'}.</p>

      <Sheet open={!!explain} onClose={() => setExplain(null)} title={explain ? EXPLAIN[explain].title : ''}>
        <p className="text-base leading-relaxed">{explain ? EXPLAIN[explain].text : ''}</p>
        <p className="text-sm text-muted mt-3">Every number on this screen is computed on your device from your own data. The AI never calculates figures.</p>
      </Sheet>
    </div>
  );
}
