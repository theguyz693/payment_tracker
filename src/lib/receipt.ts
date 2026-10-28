// Receipt data for the printer animation. Pure, so it's easy to test.
//
// Receipts are a personal record from this app — not a bank, payment
// processor or tax receipt. Mock receipts are always labelled SAMPLE.

import { formatDate } from "./dates";
import { formatINR } from "./money";
import type { Direction, ISODate } from "./types";

export interface ReceiptLine {
  label: string;
  value: string;
}

export interface ReceiptData {
  kind: "record" | "mock";
  number: string;
  heading: string;
  title: string;
  amount: string;
  amountPaise: number;
  direction: Direction;
  status: string;
  lines: ReceiptLine[];
  items: { name: string; qty: number; amount: string }[];
  footer: string[];
}

/** "PT-20261028-3F9A1C" — date of settlement + last 6 hex of the entry id. */
export function receiptNumber(entryId: string, settledOn: ISODate): string {
  const tail = entryId.replace(/[^a-f\d]/gi, "").slice(-6).toUpperCase().padStart(6, "0");
  return `PT-${settledOn.replaceAll("-", "")}-${tail}`;
}

export function settlementReceipt(s: {
  id: string;
  title: string;
  direction: Direction;
  categoryName: string;
  counterparty: string | null;
  amountPaise: number;
  dueDate: ISODate;
  settledOn: ISODate;
}): ReceiptData {
  const pay = s.direction === "PAY";
  const lines: ReceiptLine[] = [
    { label: "Date", value: formatDate(s.settledOn, "0000-01-01") },
    { label: "For due date", value: formatDate(s.dueDate, "0000-01-01") },
    { label: "Category", value: s.categoryName },
  ];
  if (s.counterparty) lines.push({ label: pay ? "Paid to" : "From", value: s.counterparty });
  return {
    kind: "record",
    number: receiptNumber(s.id, s.settledOn),
    heading: pay ? "PAYMENT RECORD" : "RECEIPT RECORD",
    title: s.title,
    amount: formatINR(s.amountPaise),
    amountPaise: s.amountPaise,
    direction: s.direction,
    status: pay ? "PAID" : "RECEIVED",
    lines,
    items: [],
    footer: ["Personal record from Payment Tracker.", "Not a bank, payment or tax receipt."],
  };
}

export interface MockItem {
  name: string;
  qty: number;
  unitPaise: number;
}

export function mockReceipt(input: { title: string; merchant: string | null; items: MockItem[]; date: ISODate; seed: string }): ReceiptData {
  const items = input.items
    .filter((i) => i.name.trim() && i.qty > 0)
    .slice(0, 12)
    .map((i) => ({ name: i.name.trim().slice(0, 28), qty: i.qty, amount: formatINR(i.qty * i.unitPaise), paise: i.qty * i.unitPaise }));
  const total = items.reduce((a, i) => a + i.paise, 0);
  const lines: ReceiptLine[] = [{ label: "Date", value: formatDate(input.date, "0000-01-01") }];
  if (input.merchant) lines.push({ label: "From", value: input.merchant.slice(0, 32) });
  return {
    kind: "mock",
    number: `SAMPLE-${input.seed.slice(-6).toUpperCase()}`,
    heading: "SAMPLE BILL",
    title: input.title.trim().slice(0, 40) || "Just for fun",
    amount: formatINR(total),
    amountPaise: total,
    direction: "PAY",
    status: "SAMPLE",
    lines,
    items: items.map(({ name, qty, amount }) => ({ name, qty, amount })),
    footer: ["SAMPLE — NOT A RECEIPT.", "Made for fun. No money moved."],
  };
}

/** Plain-text version (used for the download and as accessible text). */
export function receiptText(r: ReceiptData, width = 32): string {
  const rule = "-".repeat(width);
  const center = (t: string) => t.padStart(Math.floor((width + t.length) / 2)).padEnd(width);
  const row = (l: string, v: string) => {
    const space = width - l.length - v.length;
    return space >= 1 ? `${l}${" ".repeat(space)}${v}` : `${l}\n${v.padStart(width)}`;
  };
  const wrap = (t: string) => {
    const lines: string[] = [];
    let cur = "";
    for (const word of t.split(/\s+/)) {
      const w = word.slice(0, width);
      if (cur && cur.length + 1 + w.length > width) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const out = [center(r.heading), center(r.number), rule, ...wrap(r.title), ...r.lines.map((l) => row(l.label, l.value)), rule];
  for (const i of r.items) out.push(row(`${i.qty} x ${i.name}`, i.amount));
  if (r.items.length) out.push(rule);
  out.push(row("TOTAL", r.amount), row("STATUS", r.status), rule, ...r.footer.flatMap(wrap).map(center));
  return out.map((l) => l.trimEnd()).join("\n");
}
