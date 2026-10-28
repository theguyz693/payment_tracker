"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatDate } from "@/lib/dates";
import { formatScaled, parseDecimal, PRICE_DP, QTY_DP, unitPrice4, valuePaise } from "@/lib/decimal";
import { formatINR, paiseToInput, parseRupees } from "@/lib/money";
import { ASSET_LABEL, ASSET_TYPES, type AssetType } from "@/lib/portfolio";
import type { Holding } from "@/server/investments-repo";
import { invTxnAction, manualPriceAction, saveHoldingAction, searchSchemesAction } from "@/server/invest-actions";
import type { AmfiScheme } from "@/server/prices";
import { Field, FormAlert, inputCls, MoneyInput, RequestIdField, SubmitButton, useSavingAction } from "./forms";
import { Search } from "./icons";

const FREQS = [
  ["MONTHLY", "Monthly"],
  ["WEEKLY", "Weekly"],
  ["QUARTERLY", "Quarterly"],
  ["YEARLY", "Yearly"],
] as const;

const TYPE_HINT: Record<AssetType, string> = {
  MF: "Mutual fund or SIP. NAVs come from AMFI once a day.",
  STOCK: "Shares listed on an exchange.",
  ETF: "Exchange-traded fund.",
  GOLD: "Physical gold, coins, or gold-backed holdings.",
  OTHER: "Anything else. Prices are entered by you.",
};

export function HoldingForm({ initial, livePricesForStocks }: { initial?: Holding; livePricesForStocks: boolean }) {
  const { state, formAction, pending } = useSavingAction(saveHoldingAction);
  const err = state.errors ?? {};
  const [type, setType] = useState<AssetType>(initial?.type ?? "MF");
  const [name, setName] = useState(initial?.name ?? "");
  const [schemeCode, setSchemeCode] = useState(initial?.type === "MF" ? (initial.providerKey ?? "") : "");
  const sipable = type === "MF" || type === "STOCK" || type === "ETF";

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-6" noValidate>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="type" value={type} />
      {initial?.sip && <input type="hidden" name="sipStatus" value={initial.sip.status} />}
      <RequestIdField />

      {!initial && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">What kind of investment?</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {ASSET_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className="press rounded-full border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-canvas aria-checked:border-ink aria-checked:bg-ink aria-checked:text-on-ink"
              >
                {ASSET_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">{TYPE_HINT[type]}</p>
        </fieldset>
      )}

      {type === "MF" && <SchemeSearch onPick={(s) => (setName(s.name), setSchemeCode(s.code))} />}

      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <Field label="Name" error={err.name}>
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={type === "GOLD" ? "e.g. Gold coins (10 g)" : "e.g. Nifty 50 Index Fund"} className={inputCls(err.name)} />
        </Field>
        {type === "MF" ? (
          <Field label="AMFI scheme code" hint="Fills in from the search. Needed for daily NAVs." error={err.schemeCode}>
            <input name="schemeCode" value={schemeCode} onChange={(e) => setSchemeCode(e.target.value)} inputMode="numeric" className={`${inputCls(err.schemeCode)} num`} />
          </Field>
        ) : type === "GOLD" || type === "OTHER" ? null : (
          <Field label="Symbol" hint={livePricesForStocks ? "e.g. RELIANCE.BSE or IBM" : "Live prices need an API key (see README)."} error={err.symbol}>
            <input name="symbol" defaultValue={initial?.symbol ?? ""} maxLength={40} className={`${inputCls(err.symbol)} uppercase`} />
          </Field>
        )}
      </div>

      {type === "GOLD" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purity (karats)" hint="24K is pure gold; jewellery is often 22K or 18K." error={err.karat}>
            <select name="karat" defaultValue={initial?.gold?.karat ?? 24} className={inputCls(err.karat)}>
              {[24, 22, 20, 18, 14].map((k) => (
                <option key={k} value={k}>
                  {k}K
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected sell deduction (%)" hint="Jewellers typically buy back below market. 0 if unsure." error={err.spread}>
            <input name="spread" defaultValue={initial?.gold ? String(initial.gold.sellSpreadBps / 100) : "3"} inputMode="decimal" className={`${inputCls(err.spread)} num`} />
          </Field>
        </div>
      )}

      {sipable && (
        <fieldset className="space-y-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">SIP (optional)</legend>
          <p className="text-xs text-ink-3">A schedule only. Scheduled instalments don&apos;t count as invested until you record them.</p>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Amount" error={err.sipAmount}>
              <MoneyInput name="sipAmount" defaultValue={initial?.sip ? paiseToInput(initial.sip.amountPaise) : ""} error={err.sipAmount} />
            </Field>
            <Field label="Frequency">
              <select name="sipFrequency" defaultValue={initial?.sip?.frequency ?? "MONTHLY"} className={inputCls()}>
                {FREQS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date" error={err.sipStart}>
              <input type="date" name="sipStart" defaultValue={initial?.sip?.anchorDate ?? ""} className={inputCls(err.sipStart)} />
            </Field>
            <Field label="End date (optional)" error={err.sipEnd}>
              <input type="date" name="sipEnd" defaultValue={initial?.sip?.endDate ?? ""} className={inputCls(err.sipEnd)} />
            </Field>
          </div>
        </fieldset>
      )}

      <Field label="Notes (optional)" error={err.notes}>
        <textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} maxLength={500} className={inputCls(err.notes)} />
      </Field>
      <FormAlert state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={initial ? `/investments/${initial.id}` : "/investments"} className="press rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-ink-2 hover:bg-canvas">
          Cancel
        </Link>
        <SubmitButton pending={pending} tone="invest">
          {initial ? "Save changes" : "Add investment"}
        </SubmitButton>
      </div>
    </form>
  );
}

function SchemeSearch({ onPick }: { onPick: (s: AmfiScheme) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AmfiScheme[] | null>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => start(async () => setResults(await searchSchemesAction(q))), 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="rounded-xl bg-canvas p-3">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-2">
          <Search width={14} height={14} /> Find the fund (AMFI list)
        </span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. parag parikh flexi direct growth" className={inputCls()} />
      </label>
      {pending && <p className="mt-2 text-xs text-ink-3">Searching…</p>}
      {results === null && <p className="mt-2 text-xs text-pending">AMFI couldn&apos;t be reached. Type the name yourself; you can add the scheme code later.</p>}
      {results && results.length > 0 && (
        <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface">
          {results.map((s) => (
            <li key={s.code}>
              <button type="button" onClick={() => (onPick(s), setQ(""), setResults([]))} className="w-full px-3 py-2 text-left text-sm hover:bg-canvas">
                <span className="block font-medium">{s.name}</span>
                <span className="text-xs text-ink-3">
                  Code {s.code} · NAV ₹{formatScaled(s.price4, PRICE_DP, 2)} on {formatDate(s.asOf)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && q.trim().length >= 3 && !pending && <p className="mt-2 text-xs text-ink-3">No matches. Try fewer words.</p>}
    </div>
  );
}

export function InvTxnForm({
  holdingId,
  type: assetType,
  today,
  nextSip,
  canSell,
}: {
  holdingId: string;
  type: AssetType;
  today: string;
  nextSip: { date: string; amountPaise: number } | null;
  canSell: boolean;
}) {
  const { state, formAction, pending, successes } = useSavingAction(invTxnAction);
  const err = state.errors ?? {};
  const [kind, setKind] = useState<"BUY" | "SELL" | "DIVIDEND">("BUY");
  const [f, setF] = useState({ amount: "", qty: "", price: "", sipFor: "" });
  useEffect(() => setF({ amount: "", qty: "", price: "", sipFor: "" }), [successes]);
  const unit = assetType === "GOLD" ? "grams" : assetType === "MF" ? "units" : "shares";

  // Show what will be derived from the two figures entered.
  const derived = useMemo(() => {
    const a = parseRupees(f.amount);
    const q = parseDecimal(f.qty, QTY_DP);
    const p = parseDecimal(f.price, PRICE_DP);
    if (a && q && !p) return `= ₹${formatScaled(unitPrice4(a, q), PRICE_DP, 2)} per ${unit.replace(/s$/, "")}`;
    if (!a && q && p) return `= ${formatINR(valuePaise(q, p))}`;
    return null;
  }, [f, unit]);

  return (
    <form key={successes} action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="holdingId" value={holdingId} />
      <input type="hidden" name="type" value={kind} />
      <input type="hidden" name="sipFor" value={kind === "BUY" ? f.sipFor : ""} />
      <RequestIdField resetKey={successes} />
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-canvas p-1" role="radiogroup" aria-label="Transaction type">
        {(["BUY", "SELL", "DIVIDEND"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={kind === t}
            disabled={t === "SELL" && !canSell}
            onClick={() => setKind(t)}
            className="press rounded-md py-1.5 text-sm font-semibold text-ink-2 disabled:opacity-40 aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-sm"
          >
            {t === "BUY" ? "Buy" : t === "SELL" ? "Sell" : assetType === "MF" ? "Payout" : "Dividend"}
          </button>
        ))}
      </div>
      {nextSip && kind === "BUY" && (
        <button
          type="button"
          onClick={() => setF({ ...f, amount: paiseToInput(nextSip.amountPaise), sipFor: nextSip.date })}
          className="press w-full rounded-lg border border-dashed border-invest/50 px-3 py-2 text-left text-sm text-invest hover:bg-invest-soft"
        >
          Fill in the {formatDate(nextSip.date, today)} SIP ({formatINR(nextSip.amountPaise)})
        </button>
      )}
      {f.sipFor && kind === "BUY" && (
        <p className="text-xs text-ink-2">
          Recording the SIP scheduled for <strong>{formatDate(f.sipFor, today)}</strong>.{" "}
          <button type="button" className="underline" onClick={() => setF({ ...f, sipFor: "" })}>
            Not a SIP
          </button>
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" error={err.date}>
          <input type="date" name="date" defaultValue={today} max={today} className={inputCls(err.date)} />
        </Field>
        <Field label={kind === "SELL" ? "Proceeds" : kind === "DIVIDEND" ? "Amount received" : "Amount invested"} error={err.amount}>
          <MoneyInput name="amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={err.amount} />
        </Field>
      </div>
      {kind !== "DIVIDEND" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantity (${unit})`} hint={kind === "BUY" && assetType === "MF" ? "From your statement. Optional, but needed for value and gains." : undefined} error={err.qty}>
            <input name="qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="decimal" placeholder="0" className={`${inputCls(err.qty)} num`} />
          </Field>
          <Field label={assetType === "MF" ? "NAV" : assetType === "GOLD" ? "Price per gram" : "Price per share"} error={err.price}>
            <MoneyInput name="price" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} error={err.price} />
          </Field>
        </div>
      )}
      {derived && <p className="text-xs text-ink-3">{derived}</p>}
      {kind !== "DIVIDEND" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={assetType === "GOLD" ? "Making charges, GST & fees" : "Fees & charges"} error={err.fee}>
            <MoneyInput name="fee" error={err.fee} />
          </Field>
          <Field label="Note (optional)" error={err.note}>
            <input name="note" maxLength={200} className={inputCls(err.note)} />
          </Field>
        </div>
      )}
      <FormAlert state={state} />
      <SubmitButton pending={pending} tone="invest">
        Record {kind === "BUY" ? "purchase" : kind === "SELL" ? "sale" : "payout"}
      </SubmitButton>
      <p className="text-xs text-ink-3">Enter any two of amount, quantity and price; the third is worked out.</p>
    </form>
  );
}

export function ManualPriceForm({ holdingId, today, label }: { holdingId: string; today: string; label: string }) {
  const { state, formAction, pending, successes } = useSavingAction(manualPriceAction);
  const err = state.errors ?? {};
  return (
    <form key={successes} action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="holdingId" value={holdingId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={label} error={err.price}>
          <MoneyInput name="price" error={err.price} />
        </Field>
        <Field label="As of" error={err.asOf}>
          <input type="date" name="asOf" defaultValue={today} max={today} className={inputCls(err.asOf)} />
        </Field>
      </div>
      <FormAlert state={state} />
      <SubmitButton pending={pending}>Save price</SubmitButton>
    </form>
  );
}
