import { useMemo, useState } from 'react';
import type { Row } from '@/core/types';
import { colKind, firstNonNull, formatCell, prettyName } from '@/core/ask/format';
import { Button, cx } from './ui';

/** Read-only result table with value formatting (₹, %, dates) and "show more" paging. */
export function DataTable({ columns, rows, pageSize = 25, testId, onRow }: { columns: string[]; rows: Row[]; pageSize?: number; testId?: string; onRow?: (r: Row) => void }) {
  const [shown, setShown] = useState(pageSize);
  const kinds = useMemo(() => columns.map((c) => colKind(c, firstNonNull(rows, c))), [columns, rows]);
  if (!rows.length) return <p className="text-muted py-4 text-center">No rows.</p>;
  return (
    <div data-testid={testId}>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-surface2 text-left">
              {columns.map((c, i) => (
                <th key={c} scope="col" className={cx('px-3 py-2.5 font-semibold whitespace-nowrap', kinds[i] !== 'text' && kinds[i] !== 'date' && kinds[i] !== 'month' && 'text-right')}>{prettyName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r, ri) => (
              <tr key={ri} className={cx('border-t border-line', onRow && 'cursor-pointer hover:bg-surface2')} onClick={onRow ? () => onRow(r) : undefined}>
                {columns.map((c, i) => (
                  <td key={c} className={cx('px-3 py-2.5 num', kinds[i] === 'text' ? 'min-w-28' : 'whitespace-nowrap', kinds[i] !== 'text' && kinds[i] !== 'date' && kinds[i] !== 'month' && 'text-right',
                    typeof r[c] === 'number' && (r[c] as number) < 0 && 'text-neg')}>{formatCell(r[c], kinds[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-sm text-muted">Showing {shown} of {rows.length}</span>
          <Button size="sm" variant="secondary" onClick={() => setShown((s) => s + pageSize * 2)}>Show more</Button>
        </div>
      )}
    </div>
  );
}
