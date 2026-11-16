import { describe, expect, it } from 'vitest';
import { formatCompactINR, formatINR, formatNumber, formatPct, formatQty, fromPaise, groupIndian, growthPct, ratio, spokenINR, toPaise } from '@/core/util/money';
import { addDays, addMonths, diffDays, endOfMonth, formatDate, fyOf, isValidISO, monthLabel, periodRange, startOfWeek, todayISO, weekdayOf } from '@/core/util/dates';

describe('money', () => {
  it('converts rupees to integer paise without float drift', () => {
    expect(toPaise(1234.56)).toBe(123456);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(fromPaise(123456)).toBe(1234.56);
    expect(fromPaise(null)).toBe(0);
  });
  it('groups digits the Indian way', () => {
    expect(groupIndian('123')).toBe('123');
    expect(groupIndian('1234')).toBe('1,234');
    expect(groupIndian('123456')).toBe('1,23,456');
    expect(groupIndian('12345678')).toBe('1,23,45,678');
  });
  it('formats rupees for cards', () => {
    expect(formatINR(123456)).toBe('₹1,23,456');
    expect(formatINR(123456.4)).toBe('₹1,23,456');
    expect(formatINR(45.5)).toBe('₹45.50');
    expect(formatINR(-2500)).toBe('-₹2,500');
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(null)).toBe('–');
    expect(formatINR(NaN)).toBe('–');
    expect(formatINR(10, { decimals: 2 })).toBe('₹10.00');
  });
  it('formats compact rupees for charts', () => {
    expect(formatCompactINR(120000)).toBe('₹1.2L');
    expect(formatCompactINR(34000000)).toBe('₹3.4Cr');
    expect(formatCompactINR(12500)).toBe('₹12.5K');
    expect(formatCompactINR(950)).toBe('₹950');
    expect(formatCompactINR(-250000)).toBe('-₹2.5L');
    expect(formatCompactINR(undefined)).toBe('–');
  });
  it('words large amounts in lakh and crore', () => {
    expect(spokenINR(123000)).toBe('₹1.23 lakh');
    expect(spokenINR(25000000)).toBe('₹2.5 crore');
    expect(spokenINR(9999)).toBe('₹9,999');
  });
  it('formats quantities with up to three decimals', () => {
    expect(formatQty(12)).toBe('12');
    expect(formatQty(2.5)).toBe('2.5');
    expect(formatQty(1.23456)).toBe('1.235');
    expect(formatQty(-5)).toBe('-5');
    expect(formatQty(125000)).toBe('1,25,000');
    expect(formatQty(null)).toBe('–');
  });
  it('never divides by zero', () => {
    expect(ratio(10, 0)).toBeNull();
    expect(ratio(10, 4)).toBe(2.5);
    expect(ratio(null, 4)).toBeNull();
    expect(growthPct(120, 100)).toBeCloseTo(20);
    expect(growthPct(50, 0)).toBeNull();
    expect(growthPct(80, 100)).toBeCloseTo(-20);
    expect(formatPct(null)).toBe('–');
    expect(formatPct(23.456)).toBe('23.5%');
    expect(formatNumber(-0.0001, 2)).toBe('0.00');
  });
});

describe('dates', () => {
  it('adds and subtracts days across month, year and leap boundaries', () => {
    expect(addDays('2026-11-17', 14)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(diffDays('2026-11-01', '2026-11-17')).toBe(16);
  });
  it('validates ISO dates', () => {
    expect(isValidISO('2028-02-29')).toBe(true);
    expect(isValidISO('2026-02-29')).toBe(false);
    expect(isValidISO('2026-13-01')).toBe(false);
    expect(isValidISO('17/11/2026')).toBe(false);
  });
  it('starts weeks on Monday', () => {
    expect(weekdayOf('2026-11-17')).toBe(2); // Tuesday
    expect(startOfWeek('2026-11-17')).toBe('2026-11-16');
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16'); // Sunday belongs to the week that began Monday
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16');
  });
  it('handles month ends and month arithmetic', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-17', -12)).toBe('2025-11-17');
  });
  it('computes the Indian financial year across the 31 Mar / 1 Apr boundary', () => {
    expect(fyOf('2026-03-31')).toEqual({ label: 'FY2025-26', start: '2025-04-01', end: '2026-03-31' });
    expect(fyOf('2026-04-01')).toEqual({ label: 'FY2026-27', start: '2026-04-01', end: '2027-03-31' });
    expect(fyOf('2099-12-31').label).toBe('FY2099-00');
  });
  it('formats dates for display', () => {
    expect(formatDate('2026-11-17')).toBe('17 Nov 2026');
    expect(formatDate(null)).toBe('–');
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
  it('builds dashboard periods with a matching previous period', () => {
    expect(periodRange('7d', '2026-11-17')).toMatchObject({ from: '2026-11-11', to: '2026-11-17', prevFrom: '2026-11-04', prevTo: '2026-11-10' });
    expect(periodRange('today', '2026-11-17')).toMatchObject({ from: '2026-11-17', to: '2026-11-17', prevFrom: '2026-11-16', prevTo: '2026-11-16' });
    expect(periodRange('month', '2026-11-17')).toMatchObject({ from: '2026-11-01', to: '2026-11-17', prevFrom: '2026-10-01', prevTo: '2026-10-17' });
    expect(periodRange('month', '2026-03-31')).toMatchObject({ prevFrom: '2026-02-01', prevTo: '2026-02-28' });
    expect(periodRange('fy', '2026-11-17')).toMatchObject({ from: '2026-04-01', to: '2026-11-17', prevFrom: '2025-04-01', prevTo: '2025-11-17', label: 'FY2026-27' });
  });
  it('reads today from the device clock', () => {
    expect(todayISO(new Date(2026, 10, 17, 23, 59))).toBe('2026-11-17');
  });
});
