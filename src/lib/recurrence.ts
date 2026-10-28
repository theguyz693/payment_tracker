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
