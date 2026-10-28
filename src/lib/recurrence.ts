// Recurrence rules. Pure functions — no DB access — so they're easy to test.
//
// Model: every recurring item has an `anchorDate` (its first due date). The
// n-th occurrence is anchor + n * interval. Always computing from the anchor
// (instead of from the previous due date) keeps a "due on the 31st" item on
// the 31st in long months even after passing through February.

import { addDays, addMonths, diffDays, formatDate, ordinal } from "./dates";
import type { Frequency, ISODate, StoredStatus, Direction } from "./types";

export function isRecurring(frequency: Frequency): boolean {
  return frequency !== "ONE_TIME";
}

/** The n-th occurrence (n = 0 is the anchor itself). */
export function occurrence(anchor: ISODate, frequency: Frequency, n: number): ISODate {
  switch (frequency) {
    case "ONE_TIME":
      return anchor;
    case "DAILY":
      return addDays(anchor, n);
    case "WEEKLY":
      return addDays(anchor, n * 7);
    case "MONTHLY":
      return addMonths(anchor, n);
    case "QUARTERLY":
      return addMonths(anchor, n * 3);
    case "YEARLY":
      return addMonths(anchor, n * 12);
  }
}

/** First occurrence strictly after `after`. Returns null for one-time items. */
export function nextOccurrenceAfter(anchor: ISODate, frequency: Frequency, after: ISODate): ISODate | null {
  if (frequency === "ONE_TIME") return null;
  if (anchor > after) return anchor;

  // Jump close to the answer, then step forward (cheap and exact).
  const approxDays: Record<Exclude<Frequency, "ONE_TIME">, number> = {
    DAILY: 1,
    WEEKLY: 7,
    MONTHLY: 31,
    QUARTERLY: 92,
    YEARLY: 366,
  };
  let n = Math.max(0, Math.floor(diffDays(after, anchor) / approxDays[frequency]) - 1);
  let date = occurrence(anchor, frequency, n);
  while (date <= after) {
    n += 1;
    date = occurrence(anchor, frequency, n);
  }
  return date;
}

export interface SettleInput {
  direction: Direction;
  frequency: Frequency;
  anchorDate: ISODate;
  dueDate: ISODate;
  endDate: ISODate | null;
}

export interface SettleResult {
  /** The occurrence that was settled. */
  settledDueDate: ISODate;
  /** New values for the item. */
  dueDate: ISODate;
  status: StoredStatus;
  /** True when the item has no more occurrences. */
  completed: boolean;
}

/**
 * What happens when the current occurrence is marked paid/received.
 * - One-time: the item becomes PAID / RECEIVED.
 * - Recurring: the due date moves to the next occurrence and stays PENDING,
 *   unless the next occurrence would fall after the end date — then it's done.
 */
export function settle(item: SettleInput): SettleResult {
  const doneStatus: StoredStatus = item.direction === "PAY" ? "PAID" : "RECEIVED";
  const next = nextOccurrenceAfter(item.anchorDate, item.frequency, item.dueDate);

  if (next === null || (item.endDate && next > item.endDate)) {
    return { settledDueDate: item.dueDate, dueDate: item.dueDate, status: doneStatus, completed: true };
  }
  return { settledDueDate: item.dueDate, dueDate: next, status: "PENDING", completed: false };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Repeats every month on the 5th" — shown in the form and on items. */
export function describeRecurrence(frequency: Frequency, anchor: ISODate): string {
  const day = Number(anchor.slice(8, 10));
  switch (frequency) {
    case "ONE_TIME":
      return "Happens once";
    case "DAILY":
      return "Repeats every day";
    case "WEEKLY": {
      const [y, m, d] = anchor.split("-").map(Number);
      return `Repeats every ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
    }
    case "MONTHLY":
      return `Repeats every month on the ${ordinal(day)}`;
    case "QUARTERLY":
      return `Repeats every 3 months on the ${ordinal(day)}`;
    case "YEARLY":
      return `Repeats every year on ${formatDate(anchor)}`;
  }
}

// ---- Expansion (previews, forecasts, commitments) ----

export interface ScheduleInput {
  frequency: Frequency;
  anchorDate: ISODate;
  /** Next unsettled occurrence (may be in the past = overdue). */
  dueDate: ISODate;
  endDate: ISODate | null;
}

/**
 * Unsettled occurrences of an open item with from <= date <= to, starting at
 * its current due date. Settled occurrences are never repeated because the
 * expansion starts at `dueDate` (everything before it is in history).
 */
export function occurrencesBetween(item: ScheduleInput, from: ISODate, to: ISODate, limit = 1000): ISODate[] {
  const out: ISODate[] = [];
  if (item.frequency === "ONE_TIME") {
    if (item.dueDate >= from && item.dueDate <= to) out.push(item.dueDate);
    return out;
  }
  let date: ISODate | null = item.dueDate;
  // Skip forward to `from` without stepping one by one from the anchor.
  if (date < from) {
    const prev = addDays(from, -1);
    date = nextOccurrenceAfter(item.anchorDate, item.frequency, prev > date ? prev : date);
  }
  while (date && date <= to && (!item.endDate || date <= item.endDate) && out.length < limit) {
    out.push(date);
    date = nextOccurrenceAfter(item.anchorDate, item.frequency, date);
  }
  return out;
}

/** Number of occurrences per year, for annual/monthly cost estimates. */
export const PER_YEAR: Record<Frequency, number> = {
  ONE_TIME: 0,
  DAILY: 365,
  WEEKLY: 52,
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
};

/** Annual cost of a recurring amount (0 for one-time). */
export function annualCost(amountPaise: number, frequency: Frequency): number {
  return amountPaise * PER_YEAR[frequency];
}

/** Monthly equivalent, rounded to the paise. */
export function monthlyCost(amountPaise: number, frequency: Frequency): number {
  return Math.round(annualCost(amountPaise, frequency) / 12);
}

/**
 * Where a paused item resumes. Occurrences missed while paused are skipped:
 * the item continues at the first occurrence on or after `today`.
 * Returns null when no occurrence remains before the end date.
 */
export function resumeDueDate(item: ScheduleInput, today: ISODate): ISODate | null {
  if (item.dueDate >= today) return item.dueDate;
  if (item.frequency === "ONE_TIME") return item.dueDate;
  const next = nextOccurrenceAfter(item.anchorDate, item.frequency, addDays(today, -1));
  if (!next || (item.endDate && next > item.endDate)) return null;
  return next;
}
