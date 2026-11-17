// ABC (Pareto) classification: A = items making up the first 80% of value, B = the next 15%, C = the rest.

export interface AbcItem { key: string; label: string; value: number; share: number; cumulative: number; cls: 'A' | 'B' | 'C' }

export function classifyAbc(items: Array<{ key: string; label: string; value: number }>, aCut = 0.8, bCut = 0.95): AbcItem[] {
  const rows = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return [];
  let run = 0;
  return rows.map((r) => {
    const before = run / total; // an item belongs to the band in which its cumulative share starts
    run += r.value;
    const cls: AbcItem['cls'] = before < aCut ? 'A' : before < bCut ? 'B' : 'C';
    return { ...r, share: Math.round((r.value / total) * 10000) / 100, cumulative: Math.round((run / total) * 10000) / 100, cls };
  });
}

export function abcSummary(items: AbcItem[]): Record<'A' | 'B' | 'C', { count: number; value: number }> {
  const out = { A: { count: 0, value: 0 }, B: { count: 0, value: 0 }, C: { count: 0, value: 0 } };
  for (const i of items) { out[i.cls].count++; out[i.cls].value += i.value; }
  return out;
}
