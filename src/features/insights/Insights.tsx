import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Share2 } from 'lucide-react';
import { db } from '@/core/db/client';
import type { InsightsData } from '@/core/analytics/kpis';
import { abcSummary } from '@/core/analytics/abc';
import { formatDate, monthLabel, todayISO } from '@/core/util/dates';
import { formatINR, formatPct, formatQty } from '@/core/util/money';
import { barChart, chartTheme, donutChart, heatmapChart, paretoChart, stackedChart } from '@/app/charts';
import { useDb, useIsDark } from '@/app/hooks';
import { ensureForecasts, shareText } from '@/app/services';
import { useSettings } from '@/app/settings';
import { Badge, Button, Card, ErrorState, IconButton, SectionTitle, Skeleton } from '@/app/ui';
import { ChartCard, KpiCard } from '@/app/widgets';

export function Insights() {
  const nav = useNavigate();
  const dark = useIsDark();
  const business = useSettings((s) => s.businessName);
  const today = todayISO();
  useEffect(() => { void ensureForecasts().catch(() => {}); }, []);
  const d = useDb<InsightsData>(() => db.insights(today), [today], { watchForecast: true });
  const t = useMemo(() => chartTheme(dark), [dark]);
  const charts = useMemo(() => {
    const x = d.data;
    if (!x) return null;
    const months = [...new Set(x.expensesMonthly.map((e) => e.month))];
    const cats = [...new Set(x.expensesMonthly.map((e) => e.category))].sort((a, b) => x.expensesMonthly.filter((e) => e.category === b).reduce((s, e) => s + e.amount, 0) - x.expensesMonthly.filter((e) => e.category === a).reduce((s, e) => s + e.amount, 0));
    const shownCats = cats.slice(0, 7);
    return {
      pareto: x.abc.length ? paretoChart(t, x.abc) : null,
      ageing: x.ageing.length ? barChart(t, x.ageing.map((a) => a.bucket), x.ageing.map((a) => a.value), 'money', { colors: x.ageing.map((a) => (a.bucket === '90+ days' ? t.status.out : a.bucket === 'Never sold' ? t.muted : a.bucket === '61-90 days' ? t.status.low : t.accent)) }) : null,
      heat: x.heatmap.length ? heatmapChart(t, x.heatmap) : null,
      expDonut: x.expensesByCategory.length ? donutChart(t, x.expensesByCategory.slice(0, 6).map((e) => e.category), x.expensesByCategory.slice(0, 6).map((e) => e.amount), 'money') : null,
      expMonthly: months.length ? stackedChart(t, months, shownCats.map((c, i) => ({ name: c, color: t.series[i % t.series.length], data: months.map((m) => x.expensesMonthly.filter((e) => e.month === m && e.category === c).reduce((s, e) => s + e.amount, 0)) })), 'money') : null,
      health: x.stockHealth.length ? stackedChart(t, x.stockHealth.map((h) => h.category), [
        { name: 'Out', data: x.stockHealth.map((h) => h.out), color: t.status.out }, { name: 'Low', data: x.stockHealth.map((h) => h.low), color: t.status.low },
        { name: 'OK', data: x.stockHealth.map((h) => h.ok), color: t.status.ok }, { name: 'Overstock', data: x.stockHealth.map((h) => h.overstock), color: t.status.overstock },
      ], 'qty', { horizontal: true }) : null,
    };
  }, [d.data, t]);

  if (d.error && !d.data) return <ErrorState message={d.error} onRetry={d.reload} />;
  const x = d.data;
  const abc = x ? abcSummary(x.abc) : null;
  function shareReorder(): void {
    if (!x) return;
    const lines = x.reorder.map((r) => `• ${r.name}: ${formatQty(r.suggested_reorder_qty)} ${r.unit}${r.supplier ? ` (${r.supplier})` : ''}`);
    void shareText(`${business || 'Reorder list'} – order list, ${formatDate(today)}\n${lines.join('\n')}`, 'Reorder list');
  }
  return (
    <div data-testid="page-insights">
      <div className="flex items-center gap-1 -ml-3 mb-3">
        <IconButton label="Back" onClick={() => nav(-1)}><ArrowLeft className="size-5" /></IconButton>
        <div><h1 className="text-2xl font-bold">Insights</h1><p className="text-sm text-muted">Estimates based on your past sales</p></div>
      </div>
      {!x ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Inventory turnover" value={x.ratios.turnover == null ? '–' : `${x.ratios.turnover}×`} sub="per year, at cost" />
            <KpiCard label="Days of inventory" value={x.ratios.dio == null ? '–' : `${x.ratios.dio} days`} sub="365 ÷ turnover" />
            <KpiCard label="Sell-through" value={formatPct(x.ratios.sellThroughPct)} sub="last 90 days" />
            <KpiCard label="Dead stock" value={formatINR(x.deadStock.reduce((s, r) => s + r.value, 0))} sub={`${x.deadStock.length} products, 90+ days`} />
          </div>

          <SectionTitle action={x.reorder.length ? <Button size="sm" variant="ghost" icon={<Share2 className="size-4" />} onClick={shareReorder} data-testid="share-reorder">Share list</Button> : undefined}>What to reorder</SectionTitle>
          <Card className="!p-0" testId="reorder-list">
            {x.reorder.length === 0 ? <p className="p-4 text-muted">{x.forecastCount ? 'Nothing needs reordering right now.' : 'Working out estimates… (needs at least a few weeks of sales)'}</p> : (
              <ul className="divide-y divide-line">
                {x.reorder.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => nav(`/inventory/${r.id}`)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface2">
                      <span className="min-w-0"><span className="block font-medium truncate">{r.name}</span>
                        <span className="block text-sm text-muted">{r.stock <= 0 ? <span className="text-neg font-medium">Out of stock now</span> : <>{formatQty(r.stock)} left · {r.days_of_cover == null ? 'no recent sales' : `${formatQty(r.days_of_cover)} days of cover`}{r.predicted_stockout_date ? ` · out ~${formatDate(r.predicted_stockout_date)}` : ''}</>}{r.supplier ? ` · ${r.supplier}` : ''}</span></span>
                      <span className="text-right shrink-0"><span className="block font-bold num">Order {formatQty(r.suggested_reorder_qty)}</span><Badge tone={r.confidence === 'high' ? 'pos' : r.confidence === 'medium' ? 'warn' : 'neutral'}>{r.confidence} confidence</Badge></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid md:grid-cols-2 gap-3 mt-4">
            <ChartCard title="Which few items matter most?" subtitle={abc ? `ABC, last 90 days: ${abc.A.count} A, ${abc.B.count} B, ${abc.C.count} C products` : undefined} option={charts!.pareto} height={240}
              columns={['label', 'cls', 'value', 'share', 'cumulative']} rows={x.abc as never} empty="No sales in the last 90 days" />
            <ChartCard title="What is stuck?" subtitle="Stock value at cost by time since last sale" option={charts!.ageing} columns={['bucket', 'value', 'products']} rows={x.ageing as never} empty="No stock" />
            <ChartCard title="Which days are busy?" subtitle="Revenue by weekday, last 12 weeks" option={charts!.heat} height={260} columns={['week', 'weekday', 'revenue']} rows={x.heatmap as never} empty="No sales yet" />
            <ChartCard title="Is my stock healthy?" subtitle="Products by status in each category" option={charts!.health} height={Math.max(220, x.stockHealth.length * 28 + 60)} columns={['category', 'out', 'low', 'ok', 'overstock']} rows={x.stockHealth as never} />
            <ChartCard title="Where does money go?" subtitle="Expenses by category, last 90 days" option={charts!.expDonut} height={280} columns={['category', 'amount']} rows={x.expensesByCategory as never} empty="No expenses recorded" />
            <ChartCard title="Expenses by month" subtitle={x.expensesMonthly.length ? `${monthLabel(x.expensesMonthly[0].month)} onwards` : undefined} option={charts!.expMonthly} columns={['month', 'category', 'amount']} rows={x.expensesMonthly as never} empty="No expenses recorded" />
          </div>

          <SectionTitle>Dead stock</SectionTitle>
          <Card className="!p-0" testId="dead-stock">
            {x.deadStock.length === 0 ? <p className="p-4 text-muted">Nothing has gone 90 days without a sale.</p> : (
              <ul className="divide-y divide-line">
                {x.deadStock.map((r) => (
                  <li key={r.id}><button type="button" onClick={() => nav(`/inventory/${r.id}`)} className="w-full flex justify-between gap-3 px-4 py-3 text-left hover:bg-surface2">
                    <span className="min-w-0"><span className="block font-medium truncate">{r.name}</span><span className="text-sm text-muted">{formatQty(r.stock)} {r.unit} · last sold {formatDate(r.last_sale_date)} ({r.days} days)</span></span>
                    <span className="font-bold num shrink-0">{formatINR(r.value)}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
