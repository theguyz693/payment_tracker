// Transaction list filtering and sorting (pure; driven by URL search params).

import { isISODate } from "./dates";
import { effectiveStatus } from "./status";
import type { Direction, ISODate, Status, Transaction } from "./types";

export const SORTS = {
  due_asc: "Due date (soonest)",
  due_desc: "Due date (latest)",
  amount_desc: "Amount (high to low)",
  amount_asc: "Amount (low to high)",
} as const;
export type Sort = keyof typeof SORTS;

export const STATUS_FILTERS = {
  PENDING: "Pending",
  OVERDUE: "Overdue",
  PAID: "Paid",
  RECEIVED: "Received",
  PAUSED: "Paused",
  ARCHIVED: "Deleted (archived)",
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

export interface Filters {
  direction?: Direction;
  status?: StatusFilter;
  categoryId?: string;
  from?: ISODate;
  to?: ISODate;
  q?: string;
  /** Only recurring items. */
  recurring?: boolean;
  sort: Sort;
}

type Params = Record<string, string | string[] | undefined>;

export function parseFilters(params: Params): Filters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const direction = one("direction");
  const status = one("status");
  const sort = one("sort");
  const from = one("from");
  const to = one("to");
  return {
    direction: direction === "PAY" || direction === "RECEIVE" ? direction : undefined,
    status: status && status in STATUS_FILTERS ? (status as StatusFilter) : undefined,
    categoryId: one("category"),
    from: from && isISODate(from) ? from : undefined,
    to: to && isISODate(to) ? to : undefined,
    q: one("q")?.toLowerCase(),
    recurring: one("view") === "recurring" || undefined,
    sort: sort && sort in SORTS ? (sort as Sort) : "due_asc",
  };
}

export function applyFilters(items: Transaction[], f: Filters, today: ISODate): Transaction[] {
  const result = items.filter((t) => {
    if (f.status === "ARCHIVED" ? !t.archived : t.archived) return false;
    if (f.direction && t.direction !== f.direction) return false;
    if (f.recurring && t.frequency === "ONE_TIME") return false;
    if (f.status === "PAUSED") {
      if (!t.paused) return false;
    } else if (f.status && f.status !== "ARCHIVED") {
      if (t.paused || effectiveStatus(t, today) !== (f.status as Status)) return false;
    }
    if (f.categoryId && t.category.id !== f.categoryId) return false;
    if (f.from && t.dueDate < f.from) return false;
    if (f.to && t.dueDate > f.to) return false;
    if (f.q) {
      const hay = `${t.title} ${t.counterparty ?? ""} ${t.notes ?? ""}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });

  const cmp: Record<Sort, (a: Transaction, b: Transaction) => number> = {
    due_asc: (a, b) => a.dueDate.localeCompare(b.dueDate),
    due_desc: (a, b) => b.dueDate.localeCompare(a.dueDate),
    amount_desc: (a, b) => b.amountPaise - a.amountPaise,
    amount_asc: (a, b) => a.amountPaise - b.amountPaise,
  };
  return result.sort((a, b) => cmp[f.sort](a, b) || a.title.localeCompare(b.title));
}
