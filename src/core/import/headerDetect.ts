// Finds the header row in a sheet that may start with title rows ("ABC Traders - Stock Report"),
// and flattens two-row merged headers ("Stock" over "Qty | Value") into single names.
import { cleanText, dedupeNames, isBlank, parseDate, parseNumber } from './coerce';
import { TARGET_FIELDS, norm } from './mapping';

export interface HeaderInfo { index: number; span: 1 | 2; headers: string[] }

const KNOWN = new Set<string>();
for (const fields of Object.values(TARGET_FIELDS)) for (const f of fields) for (const s of f.synonyms) KNOWN.add(s);

type Kind = 'empty' | 'text' | 'num' | 'date';
export function cellKind(v: unknown): Kind {
  if (isBlank(v)) return 'empty';
  if (typeof v === 'number') return 'num';
  if (v instanceof Date) return 'date';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  const n = parseNumber(s);
  if (n.ok && n.value != null) return 'num';
  if (/\d/.test(s) && /[-/.]/.test(s) && s.length <= 20) { const d = parseDate(s); if (d.ok && d.value) return 'date'; }
  return 'text';
}

interface RowStats { cells: number; text: number; uniqueText: number; known: number; kinds: Kind[] }
function stats(row: unknown[] | undefined): RowStats {
  const kinds = (row ?? []).map(cellKind);
  const texts = (row ?? []).filter((_, i) => kinds[i] === 'text').map((v) => norm(String(v)));
  return {
    cells: kinds.filter((k) => k !== 'empty').length,
    text: texts.length,
    uniqueText: new Set(texts).size,
    known: texts.filter((t) => KNOWN.has(t)).length,
    kinds,
  };
}

export function detectHeader(matrix: unknown[][], maxScan = 15): HeaderInfo {
  const scan = Math.min(maxScan, matrix.length);
  if (!scan) return { index: 0, span: 1, headers: [] };
  const st: RowStats[] = [];
  for (let r = 0; r < Math.min(matrix.length, scan + 6); r++) st.push(stats(matrix[r]));
  const width = Math.max(1, ...st.map((s) => s.cells));
  let best = 0, bestScore = Number.NEGATIVE_INFINITY;
  for (let r = 0; r < scan; r++) {
    const s = st[r];
    if (!s.cells) continue;
    const textRatio = s.text / s.cells;
    let score = textRatio * 2 + (s.text ? s.uniqueText / s.text : 0) + (s.cells / width) * 2 + Math.min(0.8, s.known * 0.2);
    if (s.cells === 1 && width >= 3) score -= 3; // a lone cell above a wide table is a title
    if (textRatio < 0.6) score -= 2; // mostly numbers: this is data
    let below = 0, belowCells = 0;
    for (let k = r + 1; k <= r + 3 && k < st.length; k++) { below += st[k].kinds.filter((x) => x === 'num' || x === 'date').length; belowCells += st[k].cells; }
    if (belowCells && below / belowCells >= 0.2) score += 0.75; // real data follows
    if (score > bestScore + 1e-9) { bestScore = score; best = r; }
  }

  const isGroupRow = (upper: RowStats, lower: RowStats): boolean =>
    upper.cells >= 2 && upper.text === upper.cells && lower.text >= lower.cells * 0.9 && upper.cells < lower.cells && upper.known < Math.max(2, upper.cells);
  let index = best;
  let span: 1 | 2 = 1;
  if (best + 1 < st.length && isGroupRow(st[best], st[best + 1]) && st[best + 2] && st[best + 2].text < st[best + 2].cells) { index = best; span = 2; }
  else if (best > 0 && isGroupRow(st[best - 1], st[best])) { index = best - 1; span = 2; }

  const lower = matrix[index + span - 1] ?? [];
  const upper = span === 2 ? matrix[index] ?? [] : [];
  const cols = Math.max(lower.length, upper.length);
  const names: string[] = [];
  let carry = '';
  for (let c = 0; c < cols; c++) {
    const lo = cleanText(lower[c]) ?? '';
    if (span === 2) {
      const up = cleanText(upper[c]);
      if (up) carry = up;
      names.push(lo ? (carry && carry.toLowerCase() !== lo.toLowerCase() ? `${carry} ${lo}` : lo) : (cleanText(upper[c]) ?? ''));
    } else names.push(lo);
  }
  while (names.length && names[names.length - 1] === '') names.pop(); // trailing empty columns
  const headers = dedupeNames(names.map((n, i) => n || `Column ${i + 1}`));
  return { index, span, headers };
}
