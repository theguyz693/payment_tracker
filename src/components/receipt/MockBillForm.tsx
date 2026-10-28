"use client";

import { useState } from "react";
import { formatINR, parseRupees } from "@/lib/money";
import { mockReceipt, type MockItem } from "@/lib/receipt";
import { Field, inputCls, MoneyInput } from "../forms";
import { Close, Plus } from "../icons";
import { btnGhost, btnPrimary, btnSecondary } from "../ui";
import { ReceiptExperience } from "./ReceiptExperience";

type Row = { name: string; qty: string; price: string };

/** Make a clearly-labelled SAMPLE bill for fun. Nothing is saved. */
export function MockBillForm({ today }: { today: string }) {
  const [title, setTitle] = useState("Friday chai run");
  const [merchant, setMerchant] = useState("Corner tea stall");
  const [rows, setRows] = useState<Row[]>([
    { name: "Masala chai", qty: "3", price: "20" },
    { name: "Samosa", qty: "2", price: "15" },
  ]);
  const [printed, setPrinted] = useState<ReturnType<typeof mockReceipt> | null>(null);

  const items: MockItem[] = rows
    .map((r) => ({ name: r.name, qty: Math.max(0, Math.min(99, Math.floor(Number(r.qty) || 0))), unitPaise: parseRupees(r.price || "0") ?? 0 }))
    .filter((i) => i.name.trim() && i.qty > 0);
  const total = items.reduce((a, i) => a + i.qty * i.unitPaise, 0);
  const set = (i: number, k: keyof Row) => (e: React.ChangeEvent<HTMLInputElement>) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  if (printed) {
    return (
      <div className="space-y-4">
        <ReceiptExperience receipt={printed} />
        <div className="text-center">
          <button type="button" onClick={() => setPrinted(null)} className={btnGhost}>
            ← Make another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setPrinted(mockReceipt({ title, merchant: merchant || null, items, date: today, seed: crypto.randomUUID().replace(/-/g, "") }));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bill title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} className={inputCls()} />
        </Field>
        <Field label="From (optional)">
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={32} className={inputCls()} />
        </Field>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_64px_110px_32px] gap-2 text-xs font-medium text-ink-2">
          <span>Item</span>
          <span>Qty</span>
          <span>Price</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_64px_110px_32px] items-center gap-2">
            <input value={r.name} onChange={set(i, "name")} maxLength={28} aria-label={`Item ${i + 1} name`} className={inputCls()} />
            <input value={r.qty} onChange={set(i, "qty")} inputMode="numeric" aria-label={`Item ${i + 1} quantity`} className={`${inputCls()} num`} />
            <MoneyInput value={r.price} onChange={set(i, "price")} aria-label={`Item ${i + 1} price`} />
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`} className={btnGhost} disabled={rows.length === 1}>
              <Close width={14} height={14} />
            </button>
          </div>
        ))}
        {rows.length < 12 && (
          <button type="button" onClick={() => setRows([...rows, { name: "", qty: "1", price: "" }])} className={btnSecondary}>
            <Plus width={14} height={14} /> Add item
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm text-ink-2">
          Total <strong className="num text-ink">{formatINR(total)}</strong>
        </span>
        <button type="submit" disabled={items.length === 0} className={btnPrimary}>
          Print sample bill
        </button>
      </div>
      <p className="text-xs text-ink-3">Sample bills are stamped &ldquo;SAMPLE — NOT A RECEIPT&rdquo;, aren&apos;t saved, and never count as a payment.</p>
    </form>
  );
}
