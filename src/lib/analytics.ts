// Overview and analytics calculations. Pure functions over plain data.
//
// Definitions (see docs/ROADMAP.md §2):
// - Cash flow (actual): settlement history by `settledOn`. RECEIVE = incoming, PAY = outgoing.
// - Investment flows are kept apart from spending: buying is "invested", selling is "divested".
// - Outstanding: open (PENDING, not paused) items at their current due date.
//   A receivable is never counted as money received.
// - Scheduled: future occurrences of open items, expanded from the recurrence rule.

import { addDays, diffDays, monthBounds, monthKey } from "./dates";
import { monthsInRange } from "./period";
import { annualCost, monthlyCost, occurrencesBetween } from "./recurrence";
import type { Direction, Frequency, ISODate, Settlement, Transaction } from "./types";

export interface Bucket {
  count: number;
  totalPaise: number;
}

const empty = (): Bucket => ({ count: 0, totalPaise: 0 });
function sum(items: { amountPaise: number }[]): Bucket {
  return items.reduce((b, t) => ({ count: b.count + 1, totalPaise: b.totalPaise + t.amountPaise }), empty());
}

/** Money moved into / out of investments (from the investment tracker). */
export interface InvestmentFlow {
  date: ISODate;
  kind: "INVEST" | "DIVEST";
  amountPaise: number;
}

export function isActiveOpen(t: Transaction): boolean {
  return !t.archived && !t.paused && t.status === "PENDING";
}

// ---- Cash flow ----

export interface CashFlowTotals {
  incoming: Bucket;
  outgoing: Bucket; // spending: PAY settlements only
  investedPaise: number;
  divestedPaise: number;
  /** incoming + divested − outgoing − invested */
  netPaise: number;
}

export function cashFlowTotals(
  settlements: Settlement[],
  flows: InvestmentFlow[],
  start: ISODate,
  end: ISODate,
): CashFlowTotals {
  const inRange = settlements.filter((s) => s.settledOn >= start && s.settledOn <= end);
  const incoming = sum(inRange.filter((s) => s.direction === "RECEIVE"));
  const outgoing = sum(inRange.filter((s) => s.direction === "PAY"));
  const f = flows.filter((x) => x.date >= start && x.date <= end);
  const investedPaise = f.filter((x) => x.kind === "INVEST").reduce((a, x) => a + x.amountPaise, 0);
  const divestedPaise = f.filter((x) => x.kind === "DIVEST").reduce((a, x) => a + x.amountPaise, 0);
  return {
    incoming,
    outgoing,
    investedPaise,
    divestedPaise,
    netPaise: incoming.totalPaise + divestedPaise - outgoing.totalPaise - investedPaise,
  };
}

export interface MonthFlow {
  month: string;
  incomingPaise: number;
  outgoingPaise: number;
  investedPaise: number;
  netPaise: number;
}

/** Month-by-month actual cash flow over [start, end]. */
export function cashFlowByMonth(
  settlements: Settlement[],
  flows: InvestmentFlow[],
  start: ISODate,
  end: ISODate,
): MonthFlow[] {
  return monthsInRange(start, end).map((month) => {
    const b = monthBounds(month);
    const t = cashFlowTotals(settlements, flows, b.start > start ? b.start : start, b.end < end ? b.end : end);
    return {
      month,
      incomingPaise: t.incoming.totalPaise,
      outgoingPaise: t.outgoing.totalPaise,
      investedPaise: t.investedPaise - t.divestedPaise,
      netPaise: t.netPaise,
    };
  });
}

export interface CategoryShare {
  id: string;
  name: string;
  totalPaise: number;
  count: number;
  share: number; // 0..1
}

/** Spending (PAY settlements) by category over [start, end], largest first. */
export function spendingByCategory(settlements: Settlement[], start: ISODate, end: ISODate): CategoryShare[] {
  const paid = settlements.filter((s) => s.direction === "PAY" && s.settledOn >= start && s.settledOn <= end);
  const total = paid.reduce((a, s) => a + s.amountPaise, 0);
  const map = new Map<string, CategoryShare>();
  for (const s of paid) {
    const row = map.get(s.categoryId) ?? { id: s.categoryId, name: s.categoryName, totalPaise: 0, count: 0, share: 0 };
    row.totalPaise += s.amountPaise;
    row.count += 1;
    map.set(s.categoryId, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, share: total ? r.totalPaise / total : 0 }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
}

/** Largest individual payments in the range. */
export function largestExpenses(settlements: Settlement[], start: ISODate, end: ISODate, n = 5): Settlement[] {
  return settlements
    .filter((s) => s.direction === "PAY" && s.settledOn >= start && s.settledOn <= end)
    .sort((a, b) => b.amountPaise - a.amountPaise || b.settledOn.localeCompare(a.settledOn))
    .slice(0, n);
}

// ---- Outstanding obligations ----

export interface Obligations {
  owedByMe: Bucket; // all open payables at their current due date (incl. overdue)
  owedToMe: Bucket; // all open receivables (incl. overdue) — NOT cash
  overduePay: Bucket;
  overdueReceive: Bucket;
  dueToday: Bucket; // payables
  weekPay: Bucket; // today .. today+6, excluding overdue
  weekReceive: Bucket;
  monthPay: Bucket; // today .. end of month, excluding overdue (scheduled occurrences)
  monthReceive: Bucket;
}

export function obligations(transactions: Transaction[], today: ISODate): Obligations {
  const open = transactions.filter(isActiveOpen);
  const pay = open.filter((t) => t.direction === "PAY");
  const receive = open.filter((t) => t.direction === "RECEIVE");
  const weekEnd = addDays(today, 6);
  const monthEnd = monthBounds(monthKey(today)).end;
  return {
    owedByMe: sum(pay),
    owedToMe: sum(receive),
    overduePay: sum(pay.filter((t) => t.dueDate < today)),
    overdueReceive: sum(receive.filter((t) => t.dueDate < today)),
    dueToday: sum(pay.filter((t) => t.dueDate === today)),
    weekPay: scheduledSum(pay, today, weekEnd),
    weekReceive: scheduledSum(receive, today, weekEnd),
    monthPay: scheduledSum(pay, today, monthEnd),
    monthReceive: scheduledSum(receive, today, monthEnd),
  };
}

// ---- Scheduled (future) ----

export interface Occurrence {
  transactionId: string;
  title: string;
  direction: Direction;
  categoryName: string;
  frequency: Frequency;
  date: ISODate;
  amountPaise: number;
  loanId: string | null;
}

/** Every unsettled occurrence of active open items in [from, to], by date. */
export function upcomingOccurrences(transactions: Transaction[], from: ISODate, to: ISODate): Occurrence[] {
  return transactions
    .filter(isActiveOpen)
    .flatMap((t) =>
      occurrencesBetween(t, from, to).map((date) => ({
        transactionId: t.id,
        title: t.title,
        direction: t.direction,
        categoryName: t.category.name,
        frequency: t.frequency,
        date,
        amountPaise: t.amountPaise,
        loanId: t.loanId,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || b.amountPaise - a.amountPaise);
}

function scheduledSum(items: Transaction[], from: ISODate, to: ISODate): Bucket {
  return sum(upcomingOccurrences(items, from, to));
}

/** Planned outgoing payments from today over the next `days` days (overdue excluded). */
export function plannedExpenses(transactions: Transaction[], today: ISODate, days: number): Bucket {
  return scheduledSum(
    transactions.filter((t) => t.direction === "PAY"),
    today,
    addDays(today, days - 1),
  );
}

export interface Commitment {
  transaction: Transaction;
  monthlyPaise: number;
  annualPaise: number;
}

/** Active recurring payments with their monthly/annual cost, most expensive first. */
export function recurringCommitments(transactions: Transaction[]): {
  items: Commitment[];
  monthlyPaise: number;
  annualPaise: number;
  pausedCount: number;
} {
  const recurring = transactions.filter(
    (t) => !t.archived && t.status === "PENDING" && t.direction === "PAY" && t.frequency !== "ONE_TIME",
  );
  const items = recurring
    .filter((t) => !t.paused)
    .map((t) => ({
      transaction: t,
      monthlyPaise: monthlyCost(t.amountPaise, t.frequency),
      annualPaise: annualCost(t.amountPaise, t.frequency),
    }))
    .sort((a, b) => b.monthlyPaise - a.monthlyPaise);
  const annualPaise = items.reduce((a, c) => a + c.annualPaise, 0);
  return {
    items,
    annualPaise,
    monthlyPaise: Math.round(annualPaise / 12),
    pausedCount: recurring.length - items.length,
  };
}

/** Scheduled recurring payments for each of the next 12 months (from this month). */
export function recurringNext12Months(transactions: Transaction[], today: ISODate): { month: string; totalPaise: number }[] {
  const recurring = transactions.filter((t) => t.direction === "PAY" && t.frequency !== "ONE_TIME");
  const months = monthsInRange(today, addDays(today, 364)).slice(0, 12);
  const occ = upcomingOccurrences(recurring, today, monthBounds(months[months.length - 1]).end);
  return months.map((month) => ({
    month,
    totalPaise: occ.filter((o) => monthKey(o.date) === month).reduce((a, o) => a + o.amountPaise, 0),
  }));
}

/** Earliest date anything actually happened (charts start here, never earlier). */
export function earliestActivity(settlements: Settlement[], flows: InvestmentFlow[]): ISODate | null {
  let min: ISODate | null = null;
  for (const s of settlements) if (!min || s.settledOn < min) min = s.settledOn;
  for (const f of flows) if (!min || f.date < min) min = f.date;
  return min;
}

/** Spending per month for the top categories over [start, end] (for trend tables). */
export function categoryTrend(
  settlements: Settlement[],
  start: ISODate,
  end: ISODate,
  top = 5,
): { categories: { id: string; name: string }[]; rows: { month: string; values: number[]; otherPaise: number }[] } {
  const cats = spendingByCategory(settlements, start, end).slice(0, top);
  const rows = monthsInRange(start, end).map((month) => {
    const b = monthBounds(month);
    const inMonth = spendingByCategory(settlements, b.start > start ? b.start : start, b.end < end ? b.end : end);
    const values = cats.map((c) => inMonth.find((x) => x.id === c.id)?.totalPaise ?? 0);
    const total = inMonth.reduce((a, x) => a + x.totalPaise, 0);
    return { month, values, otherPaise: total - values.reduce((a, v) => a + v, 0) };
  });
  return { categories: cats.map(({ id, name }) => ({ id, name })), rows };
}

/** The same-length period immediately before [start, end]. */
export function previousPeriod(start: ISODate, end: ISODate): { start: ISODate; end: ISODate } {
  const days = diffDays(end, start) + 1;
  return { start: addDays(start, -days), end: addDays(start, -1) };
}

/**
 * Estimated cash at each month end from a known starting balance, using only
 * recorded actuals. Starts at the balance date — never earlier.
 */
export function cashTrend(
  startBalancePaise: number,
  asOf: ISODate,
  settlements: Settlement[],
  flows: InvestmentFlow[],
  today: ISODate,
): { date: ISODate; value: number }[] {
  const points: { date: ISODate; value: number }[] = [{ date: asOf, value: startBalancePaise }];
  const months = monthsInRange(asOf, today);
  let bal = startBalancePaise;
  let from = addDays(asOf, 1);
  for (const m of months) {
    const end = monthBounds(m).end < today ? monthBounds(m).end : today;
    if (end < from) continue;
    const t = cashFlowTotals(settlements, flows, from, end);
    bal += t.netPaise;
    points.push({ date: end, value: bal });
    from = addDays(end, 1);
  }
  return points;
}
