// ECharts option builders. One accent colour plus neutrals for single-series charts; the categorical
// palette (validated for colour-blind separation, in fixed order) only where identity needs colour.
// Marks are thin, grids recessive, animation off. No chart uses two value axes.
import type { EChartsCoreOption } from 'echarts/core';
import type { AbcItem } from '@/core/analytics/abc';
import type { ForecastChartData } from '@/core/ask/tools';
import type { ColKind } from '@/core/ask/format';
import { addDays, formatDate, formatDayShort, monthLabel, MONTHS } from '@/core/util/dates';
import { formatCompactINR, formatINR, formatNumber, formatPct, formatQty } from '@/core/util/money';

export interface ChartTheme { dark: boolean; ink: string; muted: string; line: string; surface: string; accent: string; accentSoft: string; series: string[]; status: Record<'out' | 'low' | 'ok' | 'overstock', string>; seq: [string, string] }

export function chartTheme(dark: boolean): ChartTheme {
  return dark
    ? { dark, ink: '#e8ebf0', muted: '#a0aab8', line: '#2a3542', surface: '#141a22', accent: '#2dd4bf', accentSoft: '#12332f',
        series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'], status: { out: '#f87171', low: '#fbbf24', ok: '#4ade80', overstock: '#93c5fd' }, seq: ['#12332f', '#2dd4bf'] }
    : { dark, ink: '#101828', muted: '#556070', line: '#dfe3e8', surface: '#ffffff', accent: '#0f766e', accentSoft: '#e2f3f1',
        series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], status: { out: '#b91c1c', low: '#d97706', ok: '#15803d', overstock: '#1d4ed8' }, seq: ['#e2f3f1', '#0f766e'] };
}

export const fmtValue = (v: unknown, kind: ColKind): string => {
  if (typeof v !== 'number') return v == null ? '–' : String(v);
  return kind === 'money' ? formatINR(v) : kind === 'pct' ? formatPct(v, 2) : kind === 'qty' ? formatQty(v) : formatNumber(v, Number.isInteger(v) ? 0 : 2);
};
const fmtAxis = (v: number, kind: ColKind): string => (kind === 'money' ? formatCompactINR(v) : kind === 'pct' ? `${v}%` : Math.abs(v) >= 1e5 ? formatCompactINR(v).replace('₹', '') : formatNumber(v, Number.isInteger(v) ? 0 : 1));
const fmtX = (v: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDayShort(v) : /^\d{4}-\d{2}$/.test(v) ? `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(2, 4)}` : v);
const fmtXFull = (v: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : /^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : v);

function common(t: ChartTheme, legend: boolean): EChartsCoreOption {
  return {
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: t.muted },
    grid: { left: 4, right: 14, top: legend ? 36 : 14, bottom: 2, containLabel: true },
    legend: legend ? { top: 0, left: 0, itemWidth: 14, itemHeight: 8, icon: 'roundRect', textStyle: { color: t.muted, fontSize: 12 } } : { show: false },
  };
}
function tooltip(t: ChartTheme, kind: ColKind, trigger: 'axis' | 'item' = 'axis'): Record<string, unknown> {
  return {
    trigger, confine: true, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 12], textStyle: { color: t.ink, fontSize: 14 },
    axisPointer: { type: trigger === 'axis' ? 'line' : 'none', lineStyle: { color: t.muted, width: 1 } },
    valueFormatter: (v: unknown) => fmtValue(v, kind),
  };
}
const valueAxis = (t: ChartTheme, kind: ColKind): Record<string, unknown> => ({
  type: 'value', splitNumber: 4, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => fmtAxis(v, kind) }, splitLine: { lineStyle: { color: t.line, width: 1 } }, axisLine: { show: false }, axisTick: { show: false },
});
const categoryAxis = (t: ChartTheme, data: string[], opts: { time?: boolean } = {}): Record<string, unknown> => ({
  type: 'category', data, boundaryGap: !opts.time, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, formatter: fmtX }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
  axisPointer: { label: { formatter: (p: { value: string }) => fmtXFull(p.value) } },
});

export interface LineSeries { name: string; data: Array<number | null>; dashed?: boolean; color?: string; width?: number }
export function lineChart(t: ChartTheme, x: string[], series: LineSeries[], kind: ColKind): EChartsCoreOption {
  const colors = series.length <= 2 ? [t.accent, t.muted] : t.series;
  return {
    ...common(t, series.length > 1),
    tooltip: { ...tooltip(t, kind), formatter: undefined },
    xAxis: categoryAxis(t, x, { time: true }),
    yAxis: valueAxis(t, kind),
    series: series.map((s, i) => ({
      type: 'line', name: s.name, data: s.data, showSymbol: x.length <= 2, symbolSize: 8, smooth: false, connectNulls: false,
      lineStyle: { width: s.width ?? 2, color: s.color ?? colors[i % colors.length], type: s.dashed ? 'dashed' : 'solid' }, itemStyle: { color: s.color ?? colors[i % colors.length] },
      emphasis: { focus: 'none' },
    })),
  };
}

/** Trailing moving average (null until the window is full). */
export function movingAverage(values: number[], window = 7): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(i >= window - 1 ? Math.round((sum / window) * 100) / 100 : null);
  }
  return out;
}

export function barChart(t: ChartTheme, labels: string[], values: number[], kind: ColKind, opts: { horizontal?: boolean; colors?: string[]; name?: string } = {}): EChartsCoreOption {
  const horizontal = !!opts.horizontal;
  const cat = { ...categoryAxis(t, horizontal ? [...labels].reverse() : labels), axisLabel: { color: horizontal ? t.ink : t.muted, fontSize: horizontal ? 12 : 11, hideOverlap: !horizontal, width: horizontal ? 132 : undefined, overflow: 'truncate', formatter: fmtX } };
  const data = (horizontal ? [...values].reverse() : values).map((v, i) => ({ value: v, itemStyle: { color: opts.colors ? (horizontal ? [...opts.colors].reverse() : opts.colors)[i] : t.accent, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } }));
  return {
    ...common(t, false),
    tooltip: tooltip(t, kind),
    xAxis: horizontal ? valueAxis(t, kind) : cat,
    yAxis: horizontal ? cat : valueAxis(t, kind),
    series: [{ type: 'bar', name: opts.name ?? '', data, barMaxWidth: 26, barCategoryGap: '28%', label: horizontal ? { show: true, position: 'right', color: t.muted, fontSize: 11, formatter: (p: { value: number }) => fmtAxis(p.value, kind) } : { show: false } }],
  };
}

/** Bars and a line on the SAME rupee axis (never two value axes). */
export function comboChart(t: ChartTheme, x: string[], bars: { name: string; data: number[] }, line: { name: string; data: number[] }, kind: ColKind): EChartsCoreOption {
  return {
    ...common(t, true),
    tooltip: tooltip(t, kind),
    xAxis: categoryAxis(t, x),
    yAxis: valueAxis(t, kind),
    series: [
      { type: 'bar', name: bars.name, data: bars.data, barMaxWidth: 22, itemStyle: { color: t.accent, borderRadius: [4, 4, 0, 0] } },
      { type: 'line', name: line.name, data: line.data, symbolSize: 8, lineStyle: { width: 2, color: t.ink }, itemStyle: { color: t.ink } },
    ],
  };
}

export function donutChart(t: ChartTheme, labels: string[], values: number[], kind: ColKind): EChartsCoreOption {
  const total = values.reduce((s, v) => s + v, 0) || 1;
  return {
    textStyle: { fontFamily: 'system-ui, sans-serif', color: t.muted },
    tooltip: { ...tooltip(t, kind, 'item') },
    legend: { bottom: 0, left: 'center', itemWidth: 12, itemHeight: 12, icon: 'circle', textStyle: { color: t.ink, fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['48%', '72%'], center: ['50%', '42%'], avoidLabelOverlap: true, padAngle: 2, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
      label: { show: true, color: t.ink, fontSize: 12, formatter: (p: { value: number }) => `${Math.round((p.value / total) * 100)}%` }, labelLine: { length: 8, length2: 6, lineStyle: { color: t.line } },
      data: labels.map((name, i) => ({ name, value: values[i], itemStyle: { color: t.series[i % t.series.length] } })),
    }],
  };
}

export function stackedChart(t: ChartTheme, x: string[], series: Array<{ name: string; data: number[]; color: string }>, kind: ColKind, opts: { horizontal?: boolean } = {}): EChartsCoreOption {
  const cat = { ...categoryAxis(t, x), axisLabel: { color: opts.horizontal ? t.ink : t.muted, fontSize: 11, width: opts.horizontal ? 120 : undefined, overflow: 'truncate', hideOverlap: !opts.horizontal, formatter: fmtX } };
  return {
    ...common(t, true),
    tooltip: tooltip(t, kind),
    xAxis: opts.horizontal ? valueAxis(t, kind) : cat,
    yAxis: opts.horizontal ? { ...cat, inverse: true } : valueAxis(t, kind),
    series: series.map((s) => ({ type: 'bar', stack: 'total', name: s.name, data: s.data, barMaxWidth: 22, itemStyle: { color: s.color, borderColor: t.surface, borderWidth: 1 } })),
  };
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function heatmapChart(t: ChartTheme, cells: Array<{ week: string; weekday: number; revenue: number }>): EChartsCoreOption {
  const weeks = [...new Set(cells.map((c) => c.week))].sort();
  const max = Math.max(1, ...cells.map((c) => c.revenue));
  return {
    textStyle: { fontFamily: 'system-ui, sans-serif', color: t.muted },
    grid: { left: 4, right: 10, top: 8, bottom: 44, containLabel: true },
    tooltip: { ...tooltip(t, 'money', 'item'), formatter: (p: { value: [number, number, number] }) => `${DAYS[p.value[1]]}, week of ${formatDate(weeks[p.value[0]])}<br/><b>${formatINR(p.value[2])}</b>` },
    xAxis: { type: 'category', data: weeks, axisLabel: { color: t.muted, fontSize: 11, formatter: fmtX, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false } },
    yAxis: { type: 'category', data: DAYS, inverse: true, axisLabel: { color: t.muted, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 110, itemWidth: 10, inRange: { color: t.seq }, textStyle: { color: t.muted, fontSize: 11 }, formatter: (v: number) => formatCompactINR(v) },
    series: [{ type: 'heatmap', data: cells.map((c) => [weeks.indexOf(c.week), c.weekday, c.revenue]), itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } } }],
  };
}

/** Pareto as a single-axis cumulative-share curve with the A / B / C bands shaded. */
export function paretoChart(t: ChartTheme, items: AbcItem[]): EChartsCoreOption {
  const aEnd = items.filter((i) => i.cls === 'A').length, bEnd = aEnd + items.filter((i) => i.cls === 'B').length;
  const band = (from: number, to: number, name: string, color: string): unknown[] => [{ xAxis: from, name, itemStyle: { color, opacity: 0.1 }, label: { color: t.muted, fontSize: 12, position: 'insideTop' } }, { xAxis: to }];
  return {
    ...common(t, false),
    tooltip: { ...tooltip(t, 'pct'), formatter: (ps: Array<{ dataIndex: number }>) => { const it = items[ps[0].dataIndex]; return it ? `#${ps[0].dataIndex + 1} ${it.label}<br/>Class <b>${it.cls}</b> · ${formatINR(it.value)} (${it.share}%)<br/>Cumulative <b>${it.cumulative}%</b>` : ''; } },
    xAxis: { type: 'category', data: items.map((_, i) => String(i + 1)), boundaryGap: false, name: 'Products, best seller first', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 }, axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    yAxis: { ...valueAxis(t, 'pct'), max: 100 },
    grid: { left: 4, right: 14, top: 14, bottom: 26, containLabel: true },
    series: [{
      type: 'line', data: items.map((i) => i.cumulative), showSymbol: false, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.06 },
      markArea: { silent: true, data: [band(0, Math.max(0, aEnd - 1), 'A', t.series[2]), band(Math.max(0, aEnd - 1), Math.max(0, bEnd - 1), 'B', t.series[3]), band(Math.max(0, bEnd - 1), items.length - 1, 'C', t.series[7])] },
    }],
  };
}

/** History (solid), forecast (dashed), 80% band and the estimated stock-out day. */
export function forecastChart(t: ChartTheme, d: ForecastChartData): EChartsCoreOption {
  const histX = d.history.map((h) => h.day);
  const fx = d.daily.map((_, i) => addDays(d.today, i + 1));
  const x = [...histX, ...fx];
  const pad = new Array<null>(histX.length - 1).fill(null);
  const lastHist = d.history[d.history.length - 1]?.units ?? 0;
  const band = 1.28 * d.sigma;
  const lower = d.daily.map((v) => Math.max(0, Math.round((v - band) * 100) / 100));
  const width = d.daily.map((v, i) => Math.round((v + band - lower[i]) * 100) / 100);
  const marks: unknown[] = [{ xAxis: d.today, label: { show: false }, lineStyle: { color: t.muted, type: 'solid', width: 1 } }];
  if (d.stockout && x.includes(d.stockout) && d.stockout !== d.today) marks.push({ xAxis: d.stockout, label: { formatter: 'Stock runs out', color: t.status.out, fontSize: 11 }, lineStyle: { color: t.status.out, type: 'dashed', width: 2 } });
  return {
    ...common(t, true),
    tooltip: tooltip(t, 'qty'),
    xAxis: categoryAxis(t, x, { time: true }),
    yAxis: valueAxis(t, 'qty'),
    series: [
      { type: 'line', name: 'Units sold per day', data: [...d.history.map((h) => h.units), ...fx.map(() => null)], showSymbol: false, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent }, markLine: { silent: true, symbol: 'none', data: marks } },
      { type: 'line', name: 'Estimate', data: [...pad, lastHist, ...d.daily], showSymbol: false, lineStyle: { width: 2, color: t.accent, type: 'dashed' }, itemStyle: { color: t.accent } },
      { type: 'line', name: 'band-low', data: [...pad, null, ...lower], stack: 'band', showSymbol: false, lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
      { type: 'line', name: 'Likely range (80%)', data: [...pad, null, ...width], stack: 'band', showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: t.accent, opacity: 0.14 }, itemStyle: { color: t.accent, opacity: 0.3 }, tooltip: { show: false }, silent: true },
    ],
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 8, icon: 'roundRect', textStyle: { color: t.muted, fontSize: 12 }, data: ['Units sold per day', 'Estimate', 'Likely range (80%)'] },
  };
}

export function scatterChart(t: ChartTheme, points: Array<[number, number]>, xKind: ColKind, yKind: ColKind, names: [string, string]): EChartsCoreOption {
  return {
    ...common(t, false),
    tooltip: { ...tooltip(t, yKind, 'item'), formatter: (p: { value: [number, number] }) => `${names[0]}: <b>${fmtValue(p.value[0], xKind)}</b><br/>${names[1]}: <b>${fmtValue(p.value[1], yKind)}</b>` },
    xAxis: { ...valueAxis(t, xKind), name: names[0], nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 } },
    yAxis: valueAxis(t, yKind),
    grid: { left: 4, right: 14, top: 14, bottom: 26, containLabel: true },
    series: [{ type: 'scatter', data: points, symbolSize: 9, itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 2 } }],
  };
}
