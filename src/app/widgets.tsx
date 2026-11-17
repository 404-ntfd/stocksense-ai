import { useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { ArrowDownRight, ArrowUpRight, Info, Minus, Table2 } from 'lucide-react';
import type { Row } from '@/core/types';
import { formatPct } from '@/core/util/money';
import { EChart } from './EChart';
import { DataTable } from './DataTable';
import { Card, cx, EmptyState } from './ui';

/** Change vs the previous period: arrow + percentage, coloured by whether up is good. */
export function Delta({ pct, goodWhenUp = true, label }: { pct: number | null | undefined; goodWhenUp?: boolean; label?: string }) {
  if (pct == null || !Number.isFinite(pct)) return <span className="text-sm text-muted">{label ? `no ${label}` : '–'}</span>;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-sm font-semibold', good == null ? 'text-muted' : good ? 'text-pos' : 'text-neg')}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{flat ? 'no change' : up ? 'up' : 'down'}</span>
      {formatPct(Math.abs(pct), Math.abs(pct) >= 100 ? 0 : 1)}
      {label && <span className="font-normal text-muted ml-1">{label}</span>}
    </span>
  );
}

export function KpiCard({ label, value, sub, delta, goodWhenUp, onClick, onExplain, testId, tone }: {
  label: string; value: string; sub?: ReactNode; delta?: number | null; goodWhenUp?: boolean; onClick?: () => void; onExplain?: () => void; testId?: string; tone?: 'neg' | 'warn';
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const press = { // long-press explains how the number is calculated
    onPointerDown: () => { if (onExplain) timer = setTimeout(() => { timer = undefined; onExplain(); }, 550); },
    onPointerUp: () => { if (timer) clearTimeout(timer); },
    onPointerLeave: () => { if (timer) clearTimeout(timer); },
  };
  return (
    <div className="relative" {...press}>
      <Card onClick={onClick} testId={testId} label={`${label}: ${value}`} className="h-full !p-3.5">
        <p className="text-sm text-muted pr-7">{label}</p>
        <p className={cx('text-[28px] leading-9 font-bold num mt-0.5 truncate', tone === 'neg' && 'text-neg', tone === 'warn' && 'text-warn')} data-testid={testId ? `${testId}-value` : undefined}>{value}</p>
        <div className="mt-1 min-h-5 flex items-center gap-2 flex-wrap">
          {delta !== undefined && <Delta pct={delta} goodWhenUp={goodWhenUp} />}
          {sub && <span className="text-sm text-muted">{sub}</span>}
        </div>
      </Card>
      {onExplain && (
        <button type="button" aria-label={`How ${label} is calculated`} onClick={(e) => { e.stopPropagation(); onExplain(); }}
          className="absolute top-1 right-1 size-10 flex items-center justify-center text-muted/70 hover:text-ink rounded-full">
          <Info className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** A chart with its title, an empty state, and a "View data" table toggle (every chart has one). */
export function ChartCard({ title, subtitle, option, height = 240, columns, rows, empty, testId, right, onPoint, footer }: {
  title: string; subtitle?: string; option: EChartsCoreOption | null; height?: number; columns?: string[]; rows?: Row[]; empty?: string; testId?: string; right?: ReactNode; onPoint?: (name: string) => void; footer?: ReactNode;
}) {
  const [table, setTable] = useState(false);
  const hasData = !!option && (!rows || rows.length > 0);
  return (
    <Card testId={testId} className="!p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="font-bold">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {right}
          {hasData && columns && rows && (
            <button type="button" onClick={() => setTable((v) => !v)} aria-pressed={table} data-testid={testId ? `${testId}-viewdata` : undefined}
              className={cx('inline-flex items-center gap-1.5 min-h-10 px-2.5 rounded-lg text-sm font-medium', table ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface2')}>
              <Table2 className="size-4" aria-hidden /> {table ? 'Chart' : 'View data'}
            </button>
          )}
        </div>
      </div>
      {!hasData ? <EmptyState title={empty ?? 'Nothing to show for this period'} />
        : table && columns && rows ? <DataTable columns={columns} rows={rows} pageSize={12} />
        : <EChart option={option!} height={height} label={`${title}${subtitle ? `, ${subtitle}` : ''}`} onPoint={onPoint} />}
      {footer}
    </Card>
  );
}
