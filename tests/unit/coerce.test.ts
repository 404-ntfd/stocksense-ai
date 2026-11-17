import { describe, expect, it } from 'vitest';
import { cleanText, dedupeNames, excelSerialToISO, normaliseUnit, parseDate, parseNumber, parseSku, toIdentifier } from '@/core/import/coerce';

const n = (v: unknown) => { const r = parseNumber(v); return r.ok ? r.value : 'ERR'; };
const d = (v: unknown, dayFirst = true) => { const r = parseDate(v, { dayFirst }); return r.ok ? r.value : 'ERR'; };

describe('parseNumber', () => {
  it.each([
    ['₹1,23,456.50', 123456.5], ['Rs. 500', 500], ['rs 1,000', 1000], ['INR 250', 250], ['1.2L', 120000], ['2 lakh', 200000], ['1.5 cr', 15000000],
    ['12k', 12000], ['(250)', -250], ['-75', -75], ['250-', -250], ['250/-', 250], ['12%', 12], ['1.5E+3', 1500], ['  42  ', 42], ['+7', 7],
    [42, 42], [true, 1], ['-', null], ['NA', null], ['—', null], ['', null], [null, null], ['#DIV/0!', null], ['#N/A', null], ['1 234', 1234],
  ])('%s -> %s', (input, out) => expect(n(input)).toBe(out));
  it('rejects text', () => { expect(n('abc')).toBe('ERR'); expect(n('12 boxes')).toBe('ERR'); expect(parseNumber('#DIV/0!')).toMatchObject({ warn: 'excel_error' }); });
});

describe('parseDate', () => {
  it.each([
    ['17/11/2026', '2026-11-17'], ['17-11-2026', '2026-11-17'], ['17.11.26', '2026-11-17'], ['2026-11-17', '2026-11-17'], ['2026/11/17', '2026-11-17'],
    ['17-Nov-26', '2026-11-17'], ['17 November 2026', '2026-11-17'], ['Nov 17, 2026', '2026-11-17'], ['17th Nov 2026', '2026-11-17'],
    ['2026-11-17 14:30:00', '2026-11-17'], ['17/11/2026 2:30 PM', '2026-11-17'], ['20261117', '2026-11-17'], [46343, '2026-11-17'], ['46343', '2026-11-17'],
    ['29/02/2028', '2028-02-29'], ['', null], ['-', null], [new Date(2026, 10, 17), '2026-11-17'],
  ])('%s -> %s', (input, out) => expect(d(input)).toBe(out));
  it('reads ambiguous dates by the day-first setting and flags them', () => {
    expect(d('03/04/2026')).toBe('2026-04-03');
    expect(d('03/04/2026', false)).toBe('2026-03-04');
    expect(parseDate('03/04/2026')).toMatchObject({ ambiguous: true });
    expect(d('11/25/2026', true)).toBe('2026-11-25'); // unambiguous US order still works
  });
  it('rejects impossible dates', () => { expect(d('31/02/2026')).toBe('ERR'); expect(d('29/02/2026')).toBe('ERR'); expect(d('hello')).toBe('ERR'); });
});

describe('Excel serials', () => {
  it('handles the 1900 leap-year bug and the 1904 system', () => {
    expect(excelSerialToISO(1)).toBe('1900-01-01');
    expect(excelSerialToISO(59)).toBe('1900-02-28');
    expect(excelSerialToISO(60)).toBe('1900-02-28');
    expect(excelSerialToISO(61)).toBe('1900-03-01');
    expect(excelSerialToISO(45658)).toBe('2025-01-01');
    expect(excelSerialToISO(44196, true)).toBe('2025-01-01');
    expect(excelSerialToISO(46343.75)).toBe('2026-11-17');
  });
});

describe('SKUs, text, units and identifiers', () => {
  it('keeps SKUs as text', () => {
    expect(parseSku('00123')).toMatchObject({ value: '00123' });
    expect(parseSku(890123)).toMatchObject({ value: '890123' });
    expect(parseSku('8.90103E+12')).toMatchObject({ value: '8901030000000', warn: 'sci_notation' });
    expect(parseSku(' NA ')).toMatchObject({ value: null });
  });
  it('cleans text', () => { expect(cleanText('  Sugar   1kg ')).toBe('Sugar 1kg'); expect(cleanText('   ')).toBeNull(); });
  it('normalises units', () => {
    expect(normaliseUnit('Kgs')).toBe('kg'); expect(normaliseUnit('litres')).toBe('l'); expect(normaliseUnit('Nos.')).toBe('pcs'); expect(normaliseUnit('packets')).toBe('pkt'); expect(normaliseUnit('')).toBeNull();
  });
  it('builds safe SQL identifiers', () => {
    expect(toIdentifier('Item Name')).toBe('item_name');
    expect(toIdentifier('Qty.')).toBe('qty');
    expect(toIdentifier('2024 Sales')).toBe('c_2024_sales');
    expect(toIdentifier('Price (₹)')).toBe('price_rs');
    expect(toIdentifier('Café 🍰')).toBe('cafe');
    expect(toIdentifier('🍰')).toBe('column');
    expect(toIdentifier('Margin %')).toBe('margin_pct');
  });
  it('dedupes header names', () => expect(dedupeNames(['qty', 'Qty', 'qty', 'qty_2'])).toEqual(['qty', 'Qty_2', 'qty_3', 'qty_2_2']));
});
