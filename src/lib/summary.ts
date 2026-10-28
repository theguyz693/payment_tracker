// Dashboard and monthly-summary calculations. Pure functions over plain data.
//
// Simple, predictable rule: each open item counts once, at its next due date.
// Money actually paid/received comes from Settlement history (settledOn date).

import { addDays, monthBounds, monthKey } from "./dates";
import type { Direction, ISODate, Settlement, Transaction } from "./types";

export interface Bucket {
  count: number;
  totalPaise: number;
}

const empty = (): Bucket => ({ count: 0, totalPaise: 0 });

function sum(items: { amountPaise: number }[]): Bucket {
  return items.reduce((b, t) => ({ count: b.count + 1, totalPaise: b.totalPaise + t.amountPaise }), empty());
}

export interface DashboardSummary {
  month: string;
  dueToday: Bucket; // to pay, due today
  dueThisWeek: Bucket; // to pay, today .. today+6
  upcoming: Bucket; // to pay, tomorrow .. today+30
  overduePay: Bucket;
  overdueReceive: Bucket;
  toReceive: Bucket; // all open receivables (incl. overdue)
  paidThisMonth: Bucket;
  receivedThisMonth: Bucket;
  expensesThisMonth: Bucket; // paid this month + still due this month
  netCashFlow: number; // received - paid this month
  horizon: { pay: Bucket; receive: Bucket }; // overdue + due within 30 days
}

export function dashboardSummary(
  transactions: Transaction[],
  settlements: Settlement[],
  today: ISODate,
): DashboardSummary {
  const open = transactions.filter((t) => !t.archived && t.status === "PENDING");
  const pay = open.filter((t) => t.direction === "PAY");
  const receive = open.filter((t) => t.direction === "RECEIVE");
  const weekEnd = addDays(today, 6);
  const horizonEnd = addDays(today, 30);
  const month = monthKey(today);
  const { start, end } = monthBounds(month);

  const monthSettlements = settlements.filter((s) => s.settledOn >= start && s.settledOn <= end);
  const paid = sum(monthSettlements.filter((s) => s.direction === "PAY"));
  const received = sum(monthSettlements.filter((s) => s.direction === "RECEIVE"));
  const stillDueThisMonth = sum(pay.filter((t) => t.dueDate >= start && t.dueDate <= end));

  return {
    month,
    dueToday: sum(pay.filter((t) => t.dueDate === today)),
    dueThisWeek: sum(pay.filter((t) => t.dueDate >= today && t.dueDate <= weekEnd)),
    upcoming: sum(pay.filter((t) => t.dueDate > today && t.dueDate <= horizonEnd)),
    overduePay: sum(pay.filter((t) => t.dueDate < today)),
    overdueReceive: sum(receive.filter((t) => t.dueDate < today)),
    toReceive: sum(receive),
    paidThisMonth: paid,
    receivedThisMonth: received,
    expensesThisMonth: {
      count: paid.count + stillDueThisMonth.count,
      totalPaise: paid.totalPaise + stillDueThisMonth.totalPaise,
    },
    netCashFlow: received.totalPaise - paid.totalPaise,
    horizon: {
      pay: sum(pay.filter((t) => t.dueDate <= horizonEnd)),
      receive: sum(receive.filter((t) => t.dueDate <= horizonEnd)),
    },
  };
}

/** Open items in a direction, overdue first then by due date. */
export function openItems(transactions: Transaction[], direction: Direction): Transaction[] {
  return transactions
    .filter((t) => !t.archived && t.status === "PENDING" && t.direction === direction)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amountPaise - a.amountPaise);
}

export interface CategoryShare {
  name: string;
  totalPaise: number;
  share: number; // 0..1
}

export interface MonthlySummary {
  month: string;
  paid: Bucket;
  received: Bucket;
  netCashFlow: number;
  pendingPay: Bucket; // due this month, not yet late
  pendingReceive: Bucket;
  overduePay: Bucket; // due this month, now late
  overdueReceive: Bucket;
  categories: CategoryShare[]; // paid expenses by category
  settlements: Settlement[]; // activity, newest first
}

export function monthlySummary(
  transactions: Transaction[],
  settlements: Settlement[],
  month: string,
  today: ISODate,
): MonthlySummary {
  const { start, end } = monthBounds(month);
  const inMonth = settlements
    .filter((s) => s.settledOn >= start && s.settledOn <= end)
    .sort((a, b) => b.settledOn.localeCompare(a.settledOn));
  const paidList = inMonth.filter((s) => s.direction === "PAY");
  const paid = sum(paidList);
  const received = sum(inMonth.filter((s) => s.direction === "RECEIVE"));

  const open = transactions.filter(
    (t) => !t.archived && t.status === "PENDING" && t.dueDate >= start && t.dueDate <= end,
  );
  const late = (t: Transaction) => t.dueDate < today;

  const byCategory = new Map<string, number>();
  for (const s of paidList) byCategory.set(s.categoryName, (byCategory.get(s.categoryName) ?? 0) + s.amountPaise);
  const categories = [...byCategory.entries()]
    .map(([name, totalPaise]) => ({ name, totalPaise, share: paid.totalPaise ? totalPaise / paid.totalPaise : 0 }))
    .sort((a, b) => b.totalPaise - a.totalPaise);

  return {
    month,
    paid,
    received,
    netCashFlow: received.totalPaise - paid.totalPaise,
    pendingPay: sum(open.filter((t) => t.direction === "PAY" && !late(t))),
    pendingReceive: sum(open.filter((t) => t.direction === "RECEIVE" && !late(t))),
    overduePay: sum(open.filter((t) => t.direction === "PAY" && late(t))),
    overdueReceive: sum(open.filter((t) => t.direction === "RECEIVE" && late(t))),
    categories,
    settlements: inMonth,
  };
}
