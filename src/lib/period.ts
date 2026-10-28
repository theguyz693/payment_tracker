// Reporting periods for the overview and analytics (driven by URL params).

import { addDays, formatDate, isISODate, monthBounds, monthKey, shiftMonth } from "./dates";
import type { ISODate } from "./types";

export const PERIODS = {
  this_month: "This month",
  last_month: "Last month",
  last_3_months: "Last 3 months",
  this_year: "This year",
  custom: "Custom range",
} as const;
export type PeriodKey = keyof typeof PERIODS;

export interface Period {
  key: PeriodKey;
  start: ISODate;
  end: ISODate;
  label: string;
}

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, k: string): string | undefined {
  const v = params[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

/** Longest custom range we accept (keeps month-by-month charts bounded). */
const MAX_CUSTOM_DAYS = 366 * 5;

export function resolvePeriod(params: Params, today: ISODate): Period {
  const raw = one(params, "period");
  const key: PeriodKey = raw && Object.hasOwn(PERIODS, raw) ? (raw as PeriodKey) : "this_month";
  const month = monthKey(today);

  switch (key) {
    case "last_month": {
      const { start, end } = monthBounds(shiftMonth(month, -1));
      return { key, start, end, label: PERIODS[key] };
    }
    case "last_3_months":
      return { key, start: `${shiftMonth(month, -2)}-01`, end: monthBounds(month).end, label: PERIODS[key] };
    case "this_year":
      return { key, start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31`, label: PERIODS[key] };
    case "custom": {
      const from = one(params, "from");
      const to = one(params, "to");
      if (from && to && isISODate(from) && isISODate(to) && from <= to) {
        const end = to > addDays(from, MAX_CUSTOM_DAYS) ? addDays(from, MAX_CUSTOM_DAYS) : to;
        return { key, start: from, end, label: `${formatDate(from, today)} – ${formatDate(end, today)}` };
      }
      break; // invalid custom range -> this month
    }
  }
  const { start, end } = monthBounds(month);
  return { key: "this_month", start, end, label: PERIODS.this_month };
}

/** "YYYY-MM" keys of every month touched by [start, end]. */
export function monthsInRange(start: ISODate, end: ISODate): string[] {
  const out: string[] = [];
  let m = monthKey(start);
  const last = monthKey(end);
  while (m <= last && out.length < 120) {
    out.push(m);
    m = shiftMonth(m, 1);
  }
  return out;
}

/** Query string that preserves the period selection (for drill-down links). */
export function periodQuery(p: Period): string {
  return p.key === "custom" ? `period=custom&from=${p.start}&to=${p.end}` : `period=${p.key}`;
}
