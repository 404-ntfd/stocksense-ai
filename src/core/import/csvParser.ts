// CSV reading: encoding detection (UTF-8 with or without BOM, UTF-16, windows-1252) and
// delimiter detection (comma, semicolon, tab, pipe) with PapaParse doing the quoting rules.
import Papa from 'papaparse';

export interface CsvResult { matrix: unknown[][]; encoding: string; delimiter: string; warnings: string[] }

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8 (BOM)' };
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
  // UTF-16 without a BOM: every other byte of ASCII text is zero
  const probe = Math.min(b.length, 2000);
  let zerosOdd = 0, zerosEven = 0;
  for (let i = 0; i < probe; i++) if (b[i] === 0) { if (i % 2) zerosOdd++; else zerosEven++; }
  if (probe > 20 && zerosOdd > probe * 0.3 && zerosEven < probe * 0.05) return { text: new TextDecoder('utf-16le').decode(b), encoding: 'utf-16le' };
  if (probe > 20 && zerosEven > probe * 0.3 && zerosOdd < probe * 0.05) return { text: new TextDecoder('utf-16be').decode(b), encoding: 'utf-16be' };
  const utf8 = new TextDecoder('utf-8').decode(b);
  if (!utf8.includes('�')) return { text: utf8, encoding: 'utf-8' };
  // invalid UTF-8: almost always an Excel "CSV (ANSI)" export
  return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252' };
}

export function parseCsv(bytes: Uint8Array): CsvResult {
  const { text, encoding } = decodeText(bytes);
  const warnings: string[] = [];
  const res = Papa.parse<string[]>(text, { delimiter: '', delimitersToGuess: [',', ';', '\t', '|'], skipEmptyLines: false, header: false });
  const matrix = res.data as unknown[][];
  // drop the empty last line most files end with
  while (matrix.length && (matrix[matrix.length - 1] as unknown[]).every((c) => c == null || c === '')) matrix.pop();
  const quoteErrors = res.errors.filter((e) => e.type === 'Quotes').length;
  if (quoteErrors) warnings.push(`${quoteErrors} row(s) had unbalanced quotes and may be split incorrectly.`);
  if (encoding === 'windows-1252') warnings.push('The file was not UTF-8, so it was read as Windows-1252.');
  return { matrix, encoding, delimiter: res.meta.delimiter, warnings };
}
