// Fuzzy text matching used for column mapping and for correcting misheard product names.

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false), mb = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(lb - 1, i + win);
    for (let j = lo; j <= hi; j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

export const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface NameCandidate { id: number; name: string; sku: string }
export interface NameMatch<T> { item: T; score: number }

/**
 * Finds the products a spoken or typed phrase most likely means.
 * Scores combine whole-string Jaro-Winkler with token overlap, so "sugar" finds "Sugar 1kg"
 * and "parle g" finds "Parle-G Biscuit 100g" even though the lengths differ a lot.
 */
export function matchProducts<T extends NameCandidate>(phrase: string, products: T[], limit = 3): Array<NameMatch<T>> {
  const q = normName(phrase);
  if (!q) return [];
  const qTokens = q.split(' ').filter((t) => t.length > 0);
  const scored: Array<NameMatch<T>> = [];
  for (const p of products) {
    const n = normName(p.name);
    const sku = p.sku.toLowerCase();
    let score = 0;
    if (q === n || q === sku) score = 1;
    else {
      const nTokens = n.split(' ');
      let hit = 0;
      for (const qt of qTokens) {
        let best = 0;
        for (const nt of nTokens) {
          const s = qt === nt ? 1 : nt.startsWith(qt) && qt.length >= 3 ? 0.92 : jaroWinkler(qt, nt);
          if (s > best) best = s;
        }
        if (best >= 0.86) hit += best;
      }
      const coverage = hit / qTokens.length; // how much of the phrase was found in the name
      const tightness = hit / Math.max(nTokens.length, qTokens.length); // prefer names without many extra words
      score = Math.max(jaroWinkler(q, n) * 0.9, coverage * 0.82 + tightness * 0.16);
      if (n.startsWith(q + ' ')) score = Math.max(score, 0.93);
    }
    if (score >= 0.6) scored.push({ item: p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
  return scored.slice(0, limit);
}
