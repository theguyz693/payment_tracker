// Unified chronological ledger of ACTUAL events: payments, receipts, goal
// contributions/withdrawals and investment transactions. Scheduled items and
// projections never appear here.

import { isISODate } from "./dates";
import type { ISODate, Settlement } from "./types";

export const LEDGER_TYPES = {
  PAYMENT: "Payment",
  RECEIPT: "Money received",
  GOAL_IN: "Goal contribution",
  GOAL_OUT: "Goal withdrawal",
  INVEST: "Investment buy",
  DIVEST: "Investment sale",
  DIVIDEND: "Dividend",
} as const;
export type LedgerType = keyof typeof LEDGER_TYPES;

export interface LedgerEntry {
  id: string;
  date: ISODate;
  type: LedgerType;
  title: string;
  category: string;
  /** Category id (payments) or asset type (investments) or "GOAL". */
  group: string;
  amountPaise: number;
  /** Effect on spendable cash: in, out, or moved within your own money. */
  flow: "in" | "out" | "internal";
  counterparty: string | null;
  notes: string | null;
  symbol: string | null;
  href: string | null;
  receiptable: boolean;
}

export function settlementsToLedger(settlements: Settlement[]): LedgerEntry[] {
  return settlements.map((s) => ({
    id: s.id,
    date: s.settledOn,
    type: s.direction === "PAY" ? "PAYMENT" : "RECEIPT",
    title: s.title,
    category: s.categoryName,
    group: s.categoryId,
    amountPaise: s.amountPaise,
    flow: s.direction === "PAY" ? "out" : "in",
    counterparty: s.counterparty,
    notes: s.notes,
    symbol: null,
    href: `/transactions/${s.transactionId}/edit`,
    receiptable: true,
  }));
}

export interface LedgerFilters {
  type?: LedgerType;
  from?: ISODate;
  to?: ISODate;
  q?: string;
  min?: number; // paise
  max?: number;
  group?: string;
  sort: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  page: number;
}

type Params = Record<string, string | string[] | undefined>;

export function parseLedgerFilters(params: Params): LedgerFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const rupees = (k: string) => {
    const v = one(k);
    if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return undefined;
    return Math.round(Number(v) * 100);
  };
  const type = one("type");
  const sort = one("sort");
  const from = one("from");
  const to = one("to");
  const page = Number(one("page"));
  return {
    type: type && Object.hasOwn(LEDGER_TYPES, type) ? (type as LedgerType) : undefined,
    from: from && isISODate(from) ? from : undefined,
    to: to && isISODate(to) ? to : undefined,
    q: one("q")?.toLowerCase().slice(0, 100),
    min: rupees("min"),
    max: rupees("max"),
    group: one("group"),
    sort: sort === "date_asc" || sort === "amount_desc" || sort === "amount_asc" ? sort : "date_desc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function filterLedger(entries: LedgerEntry[], f: LedgerFilters): LedgerEntry[] {
  const out = entries.filter((e) => {
    if (f.type && e.type !== f.type) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.min !== undefined && e.amountPaise < f.min) return false;
    if (f.max !== undefined && e.amountPaise > f.max) return false;
    if (f.group && e.group !== f.group) return false;
    if (f.q) {
      const hay = `${e.title} ${e.category} ${e.counterparty ?? ""} ${e.notes ?? ""} ${e.symbol ?? ""}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
  const cmp = {
    date_desc: (a: LedgerEntry, b: LedgerEntry) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    date_asc: (a: LedgerEntry, b: LedgerEntry) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    amount_desc: (a: LedgerEntry, b: LedgerEntry) => b.amountPaise - a.amountPaise || b.date.localeCompare(a.date),
    amount_asc: (a: LedgerEntry, b: LedgerEntry) => a.amountPaise - b.amountPaise || b.date.localeCompare(a.date),
  }[f.sort];
  return out.sort(cmp);
}

export const PAGE_SIZE = 50;

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages, total: items.length };
}

// ---- CSV ----

/** RFC 4180 field quoting, plus a guard against spreadsheet formula injection. */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function ledgerCsv(entries: LedgerEntry[]): string {
  return toCsv([
    ["Date", "Type", "Title", "Category", "Amount (INR)", "Cash effect", "Counterparty", "Symbol", "Notes"],
    ...entries.map((e) => [
      e.date,
      LEDGER_TYPES[e.type],
      e.title,
      e.category,
      (e.amountPaise / 100).toFixed(2),
      e.flow,
      e.counterparty,
      e.symbol,
      e.notes,
    ]),
  ]);
}
