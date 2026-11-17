"use client";

// Simulator forms. Each one sends a provider-shaped, signed payload through
// the common event pipeline (server action) and shows exactly what happened.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { EVENT_TYPE_LABEL, PROVIDERS, STATUS_LABEL, type ProviderId } from "@/lib/integrations/types";
import { formatINR } from "@/lib/money";
import type { Category } from "@/lib/types";
import { simulateRequestAction, simulateTradeAction, simulateUpiAction, type SimState } from "@/server/integrations/actions";
import { Field, inputCls, MoneyInput } from "../forms";
import { useToast } from "../Toast";

function useSim(action: (prev: SimState, fd: FormData) => Promise<SimState>) {
  const [state, formAction, pending] = useActionState<SimState, FormData>(action, {});
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (!state.result && !state.message) return;
    if (state.message && !state.errors) toast(state.message, state.ok ? undefined : { tone: "error" });
    router.refresh();
  }, [state, router, toast]);
  return { state, formAction, pending, err: state.errors ?? {} };
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={pending} className="press inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:opacity-90 disabled:opacity-70">
      {pending && <span className="spinner" aria-hidden />}
      {pending ? "Delivering event…" : children}
    </button>
  );
}

function NotConnected({ provider }: { provider: ProviderId }) {
  return (
    <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-2">
      {PROVIDERS[provider].name} isn&apos;t connected. Connect its demo account on the{" "}
      <Link href="/integrations" className="font-semibold underline">
        Overview
      </Link>{" "}
      tab first.
    </p>
  );
}

/** Demo-only failure injection, to show rollback, retries and crash recovery. */
function FailureControls({ crash = true }: { crash?: boolean }) {
  return (
    <details className="rounded-lg border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-ink-2">Failure injection (demo)</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Fail the first attempts" hint="Fails after the writes, so you can see them roll back and the retry succeed.">
          <select name="failFirstAttempts" defaultValue="0" className={inputCls()}>
            <option value="0">Never</option>
            <option value="1">First attempt</option>
            <option value="2">First two attempts</option>
          </select>
        </Field>
        {crash && (
          <label className="flex items-start gap-2 pt-7 text-sm text-ink-2">
            <input type="checkbox" name="simulateCrash" className="mt-0.5" />
            <span>Simulate a crash mid-processing (event stays PROCESSING until its lease expires and the worker recovers it)</span>
          </label>
        )}
      </div>
    </details>
  );
}

/** What the pipeline did with the delivery. */
export function SimResult({ state }: { state: SimState }) {
  const r = state.result;
  if (!r) return null;
  if (r.kind === "rejected") {
    return (
      <div role="status" className="fade-in rounded-xl border border-loss/30 bg-loss-soft p-4 text-sm">
        <div className="font-semibold text-loss">
          Rejected by GateKeeper · HTTP {r.httpStatus} · {r.reason}
        </div>
        <p className="mt-1 text-ink-2">{state.message}</p>
      </div>
    );
  }
  const e = r.event!;
  return (
    <div role="status" className="fade-in rounded-xl border border-line bg-canvas p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">
          {r.duplicate ? "Duplicate blocked" : STATUS_LABEL[e.status]} · HTTP {r.httpStatus}
        </div>
        <Link href={`/integrations/events/${e.id}`} className="text-xs font-semibold underline">
          Open in event console
        </Link>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <Row k="Provider" v={PROVIDERS[e.provider].name} />
        <Row k="Event" v={EVENT_TYPE_LABEL[e.eventType]} />
        <Row k="Event ID" v={<span className="font-mono text-xs break-all">{e.externalEventId}</span>} />
        <Row k="Amount" v={e.amountPaise !== null ? formatINR(e.amountPaise) : "—"} />
        {e.paymentStatus && <Row k="Payment status" v={e.paymentStatus} />}
        <Row k="Attempts" v={String(e.attemptCount)} />
        {e.durationMs !== null && <Row k="Processing time" v={`${e.durationMs} ms`} />}
      </dl>
      <p className="mt-3 text-ink-2">{state.message}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/70 py-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

// ---- UPI ----

export function UpiSimulator({ categories, connected }: { categories: Category[]; connected: Record<string, boolean> }) {
  const { state, formAction, pending, err } = useSim(simulateUpiAction);
  const [flow, setFlow] = useState<"debit" | "credit">("debit");
  const [provider, setProvider] = useState<"gpay_sim" | "phonepe_sim">("gpay_sim");
  const direction = flow === "debit" ? "PAY" : "RECEIVE";
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="flow" value={flow} />
        <div className="flex gap-1 rounded-lg border border-line p-1 text-sm" role="radiogroup" aria-label="Direction">
          {(["debit", "credit"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={flow === f}
              onClick={() => setFlow(f)}
              className="press flex-1 rounded-md px-3 py-1.5 font-medium text-ink-2 aria-checked:bg-ink aria-checked:text-on-ink"
            >
              {f === "debit" ? "Send a payment" : "Receive a payment"}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Simulated UPI app" error={err.provider}>
            <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className={inputCls(err.provider)}>
              <option value="gpay_sim">Google Pay Simulator</option>
              <option value="phonepe_sim">PhonePe Simulator</option>
            </select>
          </Field>
          <Field label="Amount" error={err.amount}>
            <MoneyInput name="amount" defaultValue="1500" error={err.amount} />
          </Field>
          <Field label={flow === "debit" ? "Recipient name" : "Sender name"} error={err.name}>
            <input name="name" defaultValue={flow === "debit" ? "Rahul" : "Demo Contact"} key={flow} maxLength={80} className={inputCls(err.name)} />
          </Field>
          <Field label="Demo UPI ID (optional)" error={err.vpa}>
            <input name="vpa" placeholder="name@okdemo" maxLength={80} className={inputCls(err.vpa)} />
          </Field>
          <Field label="Category">
            <select name="categoryId" defaultValue={`${direction}:Other`} key={direction} className={inputCls()}>
              {categories
                .filter((c) => c.direction === direction)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Note (optional)" error={err.note}>
            <input name="note" maxLength={140} placeholder="Dinner split" className={inputCls(err.note)} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Provider outcome</legend>
          <div className="flex flex-wrap gap-2 text-sm">
            {(["SUCCESS", "PENDING", "FAILED"] as const).map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 has-checked:border-ink has-checked:bg-canvas">
                <input type="radio" name="outcome" value={o} defaultChecked={o === "SUCCESS"} />
                {o === "SUCCESS" ? "Success" : o === "PENDING" ? "Pending" : "Failed"}
              </label>
            ))}
          </div>
        </fieldset>
        <FailureControls />
        {connected[provider] ? <Submit pending={pending}>{flow === "debit" ? "Simulate payment" : "Simulate incoming payment"}</Submit> : <NotConnected provider={provider} />}
      </form>
      <div className="space-y-3">
        <SimResult state={state} />
        {!state.result && (
          <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-3">
            The result appears here: the event ID, how the pipeline handled it and what it recorded. Success records a settled transaction; pending adds an open item
            you can resolve later; failed records nothing.
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Payment requests ----

export function RequestSimulator({ connected }: { connected: boolean }) {
  const { state, formAction, pending, err } = useSim(simulateRequestAction);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <form action={formAction} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact" error={err.name}>
            <input name="name" defaultValue="Rahul" maxLength={80} className={inputCls(err.name)} />
          </Field>
          <Field label="Amount" error={err.amount}>
            <MoneyInput name="amount" defaultValue="800" error={err.amount} />
          </Field>
          <Field label="Demo UPI ID (optional)" error={err.vpa}>
            <input name="vpa" placeholder="rahul@okdemo" maxLength={80} className={inputCls(err.vpa)} />
          </Field>
          <Field label="Message" error={err.message}>
            <input name="message" defaultValue="Dinner split" maxLength={140} className={inputCls(err.message)} />
          </Field>
        </div>
        {connected ? <Submit pending={pending}>Send request to me</Submit> : <NotConnected provider="requests_sim" />}
      </form>
      <SimResult state={state} />
    </div>
  );
}

// ---- Investments ----

const PRESETS = [
  { label: "Buy 10 Nifty BeES (ETF)", symbol: "NIFTYBEES", name: "Nippon India Nifty BeES", segment: "ETF", side: "BUY", quantity: "10", price: "270.50" },
  { label: "Buy 5 Infosys (stock)", symbol: "INFY", name: "Infosys Ltd", segment: "EQ", side: "BUY", quantity: "5", price: "1832.40" },
  { label: "SIP: Parag Parikh Flexi Cap", symbol: "PPFAS-FLEXI", name: "Parag Parikh Flexi Cap Fund", segment: "MF", side: "BUY", quantity: "117.453", price: "85.1234", sip: true },
  { label: "Sell 4 Nifty BeES", symbol: "NIFTYBEES", name: "Nippon India Nifty BeES", segment: "ETF", side: "SELL", quantity: "4", price: "281.10" },
] as const;

export function TradeSimulator({ connected, today }: { connected: boolean; today: string }) {
  const { state, formAction, pending, err } = useSim(simulateTradeAction);
  const [f, setF] = useState({ symbol: "NIFTYBEES", name: "Nippon India Nifty BeES", segment: "ETF", side: "BUY", quantity: "10", price: "270.50", sipDate: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <form action={formAction} className="space-y-4" noValidate>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setF({ symbol: p.symbol, name: p.name, segment: p.segment, side: p.side, quantity: p.quantity, price: p.price, sipDate: "sip" in p ? today : "" })}
              className="press rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-ink-2 hover:bg-canvas"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Symbol" error={err.symbol}>
            <input name="symbol" value={f.symbol} onChange={set("symbol")} maxLength={40} className={`${inputCls(err.symbol)} font-mono uppercase`} />
          </Field>
          <Field label="Instrument name" error={err.name}>
            <input name="name" value={f.name} onChange={set("name")} maxLength={80} className={inputCls(err.name)} />
          </Field>
          <Field label="Segment">
            <select name="segment" value={f.segment} onChange={set("segment")} className={inputCls()}>
              <option value="EQ">Stock</option>
              <option value="ETF">ETF</option>
              <option value="MF">Mutual fund</option>
            </select>
          </Field>
          <Field label="Side">
            <select name="side" value={f.side} onChange={set("side")} className={inputCls()}>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </Field>
          <Field label="Quantity (units)" error={err.quantity}>
            <input name="quantity" value={f.quantity} onChange={set("quantity")} inputMode="decimal" className={`${inputCls(err.quantity)} num`} />
          </Field>
          <Field label="Average price (₹)" error={err.price}>
            <input name="price" value={f.price} onChange={set("price")} inputMode="decimal" className={`${inputCls(err.price)} num`} />
          </Field>
          <Field label="Charges (₹)" error={err.charges}>
            <input name="charges" defaultValue="0" inputMode="decimal" className={`${inputCls(err.charges)} num`} />
          </Field>
          <Field label="Trade date" error={err.tradeDate}>
            <input type="date" name="tradeDate" defaultValue={today} max={today} className={inputCls(err.tradeDate)} />
          </Field>
          {f.segment === "MF" && f.side === "BUY" && (
            <Field label="SIP instalment date (optional)" hint="One import per SIP date: a second one is recognised as already recorded." error={err.sipDate}>
              <input type="date" name="sipDate" value={f.sipDate} onChange={set("sipDate")} className={inputCls(err.sipDate)} />
            </Field>
          )}
        </div>
        <FailureControls crash={false} />
        {connected ? <Submit pending={pending}>Import trade</Submit> : <NotConnected provider="groww_sim" />}
      </form>
      <div className="space-y-3">
        <SimResult state={state} />
        <p className="text-xs text-ink-3">Imports are recorded in Investments (never as ordinary payments). Sales are checked against your units, FIFO, so an import can&apos;t oversell.</p>
      </div>
    </div>
  );
}
