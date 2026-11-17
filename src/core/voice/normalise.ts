// Tidies a speech transcript before it is matched or sent to the AI:
// spoken numbers become digits ("two hundred" -> 200, "one lakh" -> 100000), "rupees" becomes ₹,
// and unit words are shortened (kgs -> kg).

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, crore: 10000000, crores: 10000000, million: 1000000 };
const isNumWord = (w: string): boolean => w in SMALL || w in SCALE;

/** Converts a run of number words to a value: ["two","lakh","fifty","thousand"] -> 250000. */
export function wordsToNumber(words: string[]): number | null {
  let total = 0, current = 0, seen = false;
  for (const w of words) {
    if (w === 'and') continue;
    if (w in SMALL) { current += SMALL[w]; seen = true; }
    else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
    else if (w in SCALE) { total += (current || 1) * SCALE[w]; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}

export function normaliseTranscript(input: string): string {
  let s = input.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  // digits followed by a scale word: "2 lakh", "1.5 crore", "20 thousand"
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand|million)\b/gi, (_m, n: string, u: string) => String(Math.round(Number(n) * SCALE[u.toLowerCase()])));
  // runs of number words
  const tokens = s.split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase().replace(/[.,?!]$/, '');
    const tail = tokens[i].slice(w.length);
    if (!isNumWord(w) || (w === 'one' && !isNumWord((tokens[i + 1] ?? '').toLowerCase().replace(/[.,?!]$/, '')) && /^(of|more|by|to|that|which|who|is|at)$/i.test(tokens[i + 1] ?? ''))) { out.push(tokens[i]); continue; }
    const run: string[] = [w];
    let j = i + 1;
    let lastTail = tail;
    while (!lastTail && j < tokens.length) {
      const n = tokens[j].toLowerCase().replace(/[.,?!]$/, '');
      const nTail = tokens[j].slice(n.length);
      if (isNumWord(n) || (n === 'and' && isNumWord((tokens[j + 1] ?? '').toLowerCase().replace(/[.,?!]$/, '')) && run.length > 0)) { run.push(n); lastTail = nTail; j++; } else break;
    }
    const value = wordsToNumber(run);
    if (value == null) { out.push(tokens[i]); continue; }
    out.push(String(value) + lastTail);
    i = j - 1;
  }
  s = out.join(' ');
  s = s.replace(/\b(\d[\d,.]*)\s*(?:rupees?|rs\.?|bucks)\b/gi, '₹$1').replace(/\b(?:rupees?|rs\.?)\s*(\d[\d,.]*)/gi, '₹$1');
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:kgs|kilos?|kilograms?)\b/gi, '$1 kg').replace(/\b(\d+(?:\.\d+)?)\s*(?:litres?|liters?|ltrs?)\b/gi, '$1 l')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:grams?|gms?)\b/gi, '$1 g').replace(/\b(\d+)\s*(?:pieces?|nos\.?)\b/gi, '$1 pcs').replace(/\b(\d+)\s*(?:packets|pkts)\b/gi, '$1 packets');
  s = s.replace(/\bper ?cent\b/gi, '%');
  return s;
}
