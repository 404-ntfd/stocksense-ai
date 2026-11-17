import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, Code2, Share2, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import type { AskAnswer } from '@/core/ask/pipeline';
import type { ChartSpec, Row } from '@/core/types';
import { colKind, firstNonNull, formatCell, prettyName } from '@/core/ask/format';
import { db } from '@/core/db/client';
import { barChart, chartTheme, donutChart, forecastChart, lineChart, movingAverage, scatterChart } from '@/app/charts';
import { EChart } from '@/app/EChart';
import { DataTable } from '@/app/DataTable';
import { useIsDark } from '@/app/hooks';
import { shareText, speak } from '@/app/services';
import { useSettings } from '@/app/settings';
import { toast } from '@/app/store';
import { Badge, Chip, cx, IconButton, Segmented } from '@/app/ui';

function ChartFor({ chart, columns, rows, title, answer }: { chart: ChartSpec; columns: string[]; rows: Row[]; title: string; answer: AskAnswer }) {
  const dark = useIsDark();
  const t = useMemo(() => chartTheme(dark), [dark]);
  const option = useMemo(() => {
    const data = chart.rows ?? rows;
    const y = chart.y?.[0];
    if (chart.type === 'forecast' && answer.forecastChart) return forecastChart(t, answer.forecastChart);
    if (!y || !data.length) return null;
    const yKind = colKind(y, firstNonNull(data, y));
    if (chart.type === 'line' && chart.x) {
      const x = data.map((r) => String(r[chart.x!]));
      if (chart.series) {
        const groups = [...new Set(data.map((r) => String(r[chart.series!])))].slice(0, 6);
        const xs = [...new Set(x)];
        return lineChart(t, xs, groups.map((g) => ({ name: g, data: xs.map((xv) => { const r = data.find((d) => String(d[chart.x!]) === xv && String(d[chart.series!]) === g); return r ? Number(r[y]) : null; }) })), yKind);
      }
      const ys = (chart.y ?? []).slice(0, 2);
      const series = ys.map((c) => ({ name: prettyName(c), data: data.map((r) => (r[c] == null ? null : Number(r[c]))) }));
      if (chart.movingAverage && ys.length === 1) series.push({ name: '7-day average', data: movingAverage(data.map((r) => Number(r[y] ?? 0))), color: t.ink } as never);
      return lineChart(t, x, series, yKind);
    }
    if ((chart.type === 'bar' || chart.type === 'hbar') && chart.x) return barChart(t, data.map((r) => String(r[chart.x!] ?? '–')), data.map((r) => Number(r[y] ?? 0)), yKind, { horizontal: chart.type === 'hbar', name: prettyName(y) });
    if (chart.type === 'donut' && chart.x) return donutChart(t, data.map((r) => String(r[chart.x!] ?? '–')), data.map((r) => Number(r[y] ?? 0)), yKind);
    if (chart.type === 'scatter' && chart.x) return scatterChart(t, data.map((r) => [Number(r[chart.x!]), Number(r[y])] as [number, number]), colKind(chart.x, firstNonNull(data, chart.x)), yKind, [prettyName(chart.x), prettyName(y)]);
    return null;
  }, [chart, rows, t, answer.forecastChart]);

  if (chart.type === 'kpi' && rows.length === 1) {
    const cols = (chart.y?.length ? chart.y : columns).filter((c) => typeof rows[0][c] === 'number').slice(0, 4);
    const label = chart.x && typeof rows[0][chart.x] === 'string' ? String(rows[0][chart.x]) : null;
    return (
      <div data-testid="answer-kpi">
        {label && <p className="font-semibold mb-1">{label}</p>}
        <div className={cx('grid gap-2', cols.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {cols.map((c) => (
            <div key={c} className="rounded-xl bg-surface2 p-3">
              <p className="text-sm text-muted">{prettyName(c)}</p>
              <p className="text-[28px] leading-9 font-bold num" data-testid="answer-kpi-value">{formatCell(rows[0][c], colKind(c, rows[0][c]))}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!option) return null;
  const height = chart.type === 'hbar' ? Math.max(180, Math.min(420, (chart.rows ?? rows).length * 34 + 30)) : chart.type === 'donut' ? 280 : 240;
  return <EChart option={option} height={height} label={title} testId="answer-chart" />;
}

export function AnswerView({ answer }: { answer: AskAnswer }) {
  const lang = useSettings((s) => s.lang);
  const [tab, setTab] = useState<'chart' | 'table'>(answer.chart.type === 'table' ? 'table' : 'chart');
  const [showSql, setShowSql] = useState(false);
  const [feedback, setFeedback] = useState<number | null>(null);
  const hasChart = answer.chart.type !== 'table' && answer.rows.length > 0;
  const plain = `${answer.title}\n${answer.text}`;

  async function vote(v: number): Promise<void> {
    setFeedback(v);
    if (answer.qaId) await db.setQaFeedback(answer.qaId, v).catch(() => {});
    if (v < 0) toast('Thanks. The question and its SQL are saved in Settings → Diagnostics so it can be improved.', 'info');
  }
  return (
    <div data-testid="answer" data-route={answer.route}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold" data-testid="answer-title">{answer.title}</h3>
        <Badge tone={answer.route === 'ai' ? 'info' : answer.route === 'tool' ? 'accent' : 'neutral'}>{answer.route === 'ai' ? 'AI' : answer.route === 'tool' ? 'Estimate' : 'Offline'}</Badge>
      </div>
      {answer.didYouMean && <p className="text-sm text-muted mt-1">Did you mean <b>{answer.didYouMean}</b>?</p>}
      {answer.note && <p className="text-sm text-warn mt-1">{answer.note}</p>}
      <p className="mt-2 text-base leading-relaxed" data-testid="answer-text">{answer.text}</p>
      {answer.rows.length > 0 && (
        <div className="mt-3">
          {hasChart && answer.rows.length > 1 && (
            <div className="mb-2"><Segmented options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} value={tab} onChange={setTab} testId="answer-tabs" /></div>
          )}
          {tab === 'chart' && hasChart ? <ChartFor chart={answer.chart} columns={answer.columns} rows={answer.rows} title={answer.title} answer={answer} /> : <DataTable columns={answer.columns} rows={answer.rows} pageSize={10} testId="answer-table" />}
        </div>
      )}
      {answer.assumptions.length > 0 && <ul className="mt-3 text-sm text-muted list-disc pl-5 space-y-0.5">{answer.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}
      {showSql && answer.sql && <pre className="mt-3 p-3 rounded-xl bg-surface2 text-xs overflow-x-auto whitespace-pre-wrap break-words" data-testid="answer-sql">{answer.sql}</pre>}
      <div className="flex items-center gap-0.5 mt-2 -ml-2 flex-wrap">
        {answer.sql && <IconButton label={showSql ? 'Hide SQL' : 'Show SQL'} onClick={() => setShowSql((v) => !v)} className={showSql ? '!text-accent' : ''} data-testid="toggle-sql"><Code2 className="size-5" /></IconButton>}
        <IconButton label="Read aloud" onClick={() => void speak(answer.text, lang)}><Volume2 className="size-5" /></IconButton>
        <IconButton label="Copy" onClick={() => { void navigator.clipboard?.writeText(plain).then(() => toast('Copied', 'ok')); }}><ClipboardCopy className="size-5" /></IconButton>
        <IconButton label="Share" onClick={() => void shareText(plain, answer.title)}><Share2 className="size-5" /></IconButton>
        <span className="flex-1" />
        <IconButton label="Good answer" onClick={() => void vote(1)} className={feedback === 1 ? '!text-pos' : ''}>{feedback === 1 ? <Check className="size-5" /> : <ThumbsUp className="size-5" />}</IconButton>
        <IconButton label="Wrong answer" onClick={() => void vote(-1)} className={feedback === -1 ? '!text-neg' : ''} data-testid="thumbs-down"><ThumbsDown className="size-5" /></IconButton>
      </div>
      <p className="text-xs text-muted">{answer.ms < 100 ? 'instant' : `${(answer.ms / 1000).toFixed(1)} s`}{answer.textSource === 'ai' ? ' · sentence written by AI, numbers checked against the result' : ''}</p>
    </div>
  );
}

export function FollowupChips({ items, onPick }: { items: string[]; onPick: (q: string) => void }) {
  if (!items.length) return null;
  return <div className="flex gap-2 flex-wrap mt-2">{items.map((f) => <Chip key={f} onClick={() => onPick(f)} className="!min-h-9 !text-sm">{f}</Chip>)}</div>;
}
