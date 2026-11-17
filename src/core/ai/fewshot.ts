// Few-shot retrieval: BM25 over the question text of the golden set. No vector database needed
// for a few dozen examples, and it runs in well under a millisecond.

export interface GoldenItem { id: string; q: string; cat: string; sql?: string; tool?: { name: string; args?: Record<string, unknown> }; history?: Array<{ q: string; sql: string }>; expect?: string; match?: string; note?: string }

const STOP = new Set('a an the is are was were of for to in on at by with and or my i me we our what which how show tell give list do does did'.split(' '));
export const tokens = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));

export class Bm25<T> {
  private docs: string[][];
  private df = new Map<string, number>();
  private avgLen: number;
  constructor(private items: T[], text: (t: T) => string, private k1 = 1.4, private b = 0.75) {
    this.docs = items.map((i) => tokens(text(i)));
    for (const d of this.docs) for (const w of new Set(d)) this.df.set(w, (this.df.get(w) ?? 0) + 1);
    this.avgLen = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }
  search(query: string, n: number, skip?: (item: T) => boolean): Array<{ item: T; score: number }> {
    const qt = tokens(query);
    const N = this.docs.length;
    const out: Array<{ item: T; score: number }> = [];
    this.docs.forEach((d, i) => {
      if (skip?.(this.items[i])) return;
      let score = 0;
      for (const w of qt) {
        const tf = d.filter((x) => x === w).length;
        if (!tf) continue;
        const idf = Math.log(1 + (N - (this.df.get(w) ?? 0) + 0.5) / ((this.df.get(w) ?? 0) + 0.5));
        score += (idf * tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * d.length) / this.avgLen));
      }
      if (score > 0) out.push({ item: this.items[i], score });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, n);
  }
}

let index: Bm25<GoldenItem> | null = null;
let indexed: GoldenItem[] | null = null;

/** The examples most similar to the question. `excludeId` gives a fair leave-one-out score in the eval. */
export function retrieveExamples(golden: GoldenItem[], question: string, n = 6, excludeId?: string): GoldenItem[] {
  if (indexed !== golden) { index = new Bm25(golden.filter((g) => (g.sql || g.tool) && !g.history), (g) => g.q); indexed = golden; }
  const q = question.toLowerCase().trim();
  return index!.search(question, n, (g) => g.id === excludeId || (excludeId != null && g.q.toLowerCase().trim() === q)).map((r) => r.item);
}
