// Excel reading with SheetJS (XLSX, XLS/BIFF8, XLSM, ODS). Formulas use their cached values,
// date-formatted numbers become ISO dates, and numbers formatted with leading zeros stay text.
import { excelSerialToISO } from './coerce';

export interface SheetData { name: string; hidden: boolean; matrix: unknown[][] }

export class ImportFileError extends Error {
  constructor(public code: 'PASSWORD' | 'UNREADABLE' | 'UNSUPPORTED' | 'TOO_LARGE' | 'EMPTY', message: string) { super(message); this.name = 'ImportFileError'; }
}

interface Cell { t?: string; v?: unknown; w?: string; z?: string | number }

export async function parseWorkbook(bytes: Uint8Array): Promise<{ sheets: SheetData[]; warnings: string[] }> {
  const XLSX = await import('xlsx');
  let wb: import('xlsx').WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: true, dense: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypt/i.test(msg)) throw new ImportFileError('PASSWORD', 'This file is password-protected. Remove the password in Excel (File > Info > Protect Workbook) and try again.');
    throw new ImportFileError('UNREADABLE', 'This file could not be read as a spreadsheet. Save it again as .xlsx or .csv and retry.');
  }
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const warnings: string[] = [];
  let formulaErrors = 0;
  const sheets: SheetData[] = wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name] as unknown as { '!data'?: Cell[][] };
    const data = ws?.['!data'] ?? [];
    const matrix: unknown[][] = [];
    for (let r = 0; r < data.length; r++) {
      const src = data[r];
      const row: unknown[] = [];
      if (src) {
        for (let c = 0; c < src.length; c++) {
          const cell = src[c];
          if (!cell || cell.t === 'z' || cell.v == null) { row.push(null); continue; }
          if (cell.t === 'n') {
            const v = cell.v as number;
            if (cell.z != null && XLSX.SSF.is_date(String(cell.z))) row.push(excelSerialToISO(v, date1904));
            else if (typeof cell.w === 'string' && /^0\d+$/.test(cell.w.trim())) row.push(cell.w.trim()); // 00123 stays text
            else row.push(v);
          } else if (cell.t === 'e') { formulaErrors++; row.push(cell.w || '#N/A'); }
          else if (cell.t === 'd') { const d = cell.v as Date; row.push(excelSerialToISO((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000)); }
          else if (cell.t === 'b') row.push(cell.v ? 1 : 0);
          else row.push(cell.v);
        }
        while (row.length && (row[row.length - 1] == null || row[row.length - 1] === '')) row.pop();
      }
      matrix.push(row);
    }
    while (matrix.length && !matrix[matrix.length - 1].length) matrix.pop();
    return { name, hidden: !!wb.Workbook?.Sheets?.[i]?.Hidden, matrix };
  });
  if (formulaErrors) warnings.push(`${formulaErrors} cell(s) contain Excel errors such as #DIV/0! and will be imported as empty.`);
  return { sheets, warnings };
}
