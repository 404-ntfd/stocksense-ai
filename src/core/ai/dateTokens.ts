// Relative dates worked out in code, so the model never has to do date arithmetic.
// The same tokens fill the {{placeholders}} in the golden SQL.
import { addDays, addMonths, endOfMonth, fyOf, startOfMonth, startOfWeek, WEEKDAYS, weekdayOf } from '../util/dates';

export function dateTokens(today: string): Record<string, string> {
  const tm = startOfMonth(today);
  const lm = addMonths(tm, -1);
  const pm = addMonths(tm, -2);
  const fy = fyOf(today);
  const lfy = fyOf(addDays(fy.start, -1));
  const tw = startOfWeek(today);
  const y = Number(today.slice(0, 4));
  return {
    today, yesterday: addDays(today, -1), weekday: WEEKDAYS[weekdayOf(today)],
    this_month_from: tm, this_month: tm.slice(0, 7),
    last_month_from: lm, last_month_to: endOfMonth(lm), last_month: lm.slice(0, 7),
    prev_month_from: pm, prev_month_to: endOfMonth(pm), prev_month: pm.slice(0, 7),
    this_week_from: tw, last_week_from: addDays(tw, -7), last_week_to: addDays(tw, -1),
    this_fy_from: fy.start, this_fy: fy.label, last_fy_from: lfy.start, last_fy_to: lfy.end, last_fy: lfy.label,
    this_year_from: `${y}-01-01`, last_year_from: `${y - 1}-01-01`, last_year_to: `${y - 1}-12-31`,
    d7_from: addDays(today, -6), d30_from: addDays(today, -29), d90_from: addDays(today, -89), d365_from: addDays(today, -364),
    m3_from: addMonths(tm, -2), m6_from: addMonths(tm, -5), m12_from: addMonths(tm, -11),
  };
}

export function fillTokens(sql: string, tokens: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, k: string) => tokens[k] ?? `{{${k}}}`);
}

/** One compact line the prompt shows the model. */
export function datesLine(t: Record<string, string>): string {
  return `today=${t.today} (${t.weekday}); yesterday=${t.yesterday}; this_week=${t.this_week_from}..${t.today}; last_week=${t.last_week_from}..${t.last_week_to}; ` +
    `this_month=${t.this_month_from}..${t.today} (month '${t.this_month}'); last_month=${t.last_month_from}..${t.last_month_to} (month '${t.last_month}'); ` +
    `this_fy=${t.this_fy} ${t.this_fy_from}..${t.today}; last_fy=${t.last_fy} ${t.last_fy_from}..${t.last_fy_to}; ` +
    `last_7_days=${t.d7_from}..${t.today}; last_30_days=${t.d30_from}..${t.today}; last_90_days=${t.d90_from}..${t.today}; this_year=${t.this_year_from}..${t.today}; last_year=${t.last_year_from}..${t.last_year_to}`;
}
