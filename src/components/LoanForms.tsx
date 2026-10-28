"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addMonths } from "@/lib/dates";
import { parseDecimal } from "@/lib/decimal";
import { amortise, compareScenarios, computeEmi } from "@/lib/emi";
import { formatINR, paiseToInput, parseRupees } from "@/lib/money";
import type { Loan } from "@/server/finance-repo";
import { linkLoanAction, prepaymentAction, saveLoanAction } from "@/server/finance-actions";
import { LoanBalanceChart } from "./charts";
import { Field, FormAlert, inputCls, MoneyInput, RequestIdField, SubmitButton, useSavingAction } from "./forms";

function parseRate(v: string): number | null {
  const bps = parseDecimal(v.replace(/%/g, "").trim() || "0", 2);
  return bps !== null && bps <= 10_000 ? bps : null;
}

/** EMI calculator with scenario comparison. Everything is illustrative. */
export function EmiCalculator({ today }: { today: string }) {
  const [principal, setPrincipal] = useState("1000000");
  const [rate, setRate] = useState("8.5");
  const [years, setYears] = useState("20");
  const [alt, setAlt] = useState({ rate: "8", years: "15", prepay: "100000", after: "12" });

  const firstEmi = addMonths(today, 1);
  const calc = useMemo(() => {
    const p = parseRupees(principal);
    const r = parseRate(rate);
    const months = Math.round(Number(years) * 12);
    if (!p || r === null || !Number.isFinite(months) || months < 1 || months > 600) return null;
    const sch = amortise({ principalPaise: p, annualRateBps: r, months, firstEmiDate: firstEmi });
    const altRate = parseRate(alt.rate);
    const altMonths = Math.round(Number(alt.years) * 12);
    const prepay = parseRupees(alt.prepay || "0") ?? 0;
    const after = Math.max(1, Math.round(Number(alt.after) || 1));
    const scenarios = compareScenarios(p, firstEmi, [
      { label: "Your loan", annualRateBps: r, months, prepaymentPaise: 0, afterInstalment: 0 },
      ...(altRate !== null ? [{ label: `At ${alt.rate}%`, annualRateBps: altRate, months, prepaymentPaise: 0, afterInstalment: 0 }] : []),
      ...(altMonths >= 1 && altMonths <= 600 ? [{ label: `Over ${alt.years} years`, annualRateBps: r, months: altMonths, prepaymentPaise: 0, afterInstalment: 0 }] : []),
      ...(prepay > 0 ? [{ label: `Prepay ${formatINR(prepay)} after EMI ${after}`, annualRateBps: r, months, prepaymentPaise: prepay, afterInstalment: after }] : []),
    ]);
    return { emi: computeEmi(p, r, months), sch, scenarios, months };
  }, [principal, rate, years, alt, firstEmi]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Loan amount">
          <MoneyInput value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label="Interest rate (% a year)">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={`${inputCls()} num`} />
        </Field>
        <Field label="Tenure (years)">
          <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="decimal" className={`${inputCls()} num`} />
        </Field>
      </div>

      {calc ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3" aria-live="polite">
            <Stat label="Monthly EMI" value={formatINR(calc.emi)} strong />
            <Stat label="Total interest" value={formatINR(calc.sch.totalInterestPaise)} />
            <Stat label="Total repayment" value={formatINR(calc.sch.totalPaidPaise)} sub={`${calc.months} EMIs`} />
          </div>
          <LoanBalanceChart data={calc.sch.rows.filter((_, i) => i % Math.max(1, Math.floor(calc.sch.rows.length / 60)) === 0).map((r) => ({ date: r.date, balance: r.closingPaise }))} />

          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 text-sm font-semibold">Compare alternatives</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Different rate (%)">
                <input value={alt.rate} onChange={(e) => setAlt({ ...alt, rate: e.target.value })} inputMode="decimal" className={`${inputCls()} num`} />
              </Field>
              <Field label="Different tenure (years)">
                <input value={alt.years} onChange={(e) => setAlt({ ...alt, years: e.target.value })} inputMode="decimal" className={`${inputCls()} num`} />
              </Field>
              <Field label="One-off prepayment">
                <MoneyInput value={alt.prepay} onChange={(e) => setAlt({ ...alt, prepay: e.target.value })} />
              </Field>
              <Field label="…after EMI number">
                <input value={alt.after} onChange={(e) => setAlt({ ...alt, after: e.target.value })} inputMode="numeric" className={`${inputCls()} num`} />
              </Field>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="py-1.5 pr-3 font-semibold">Scenario</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">EMI</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">EMIs</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Total interest</th>
                    <th className="py-1.5 text-right font-semibold">vs your loan</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.scenarios.map((s, i) => {
                    const diff = s.totalInterestPaise - calc.scenarios[0].totalInterestPaise;
                    return (
                      <tr key={s.label} className="border-t border-line">
                        <td className="py-2 pr-3 font-medium">{s.label}</td>
                        <td className="num py-2 pr-3 text-right">{formatINR(s.emiPaise)}</td>
                        <td className="num py-2 pr-3 text-right">{s.actualMonths}</td>
                        <td className="num py-2 pr-3 text-right">{formatINR(s.totalInterestPaise)}</td>
                        <td className={`num py-2 text-right ${i === 0 ? "text-ink-3" : diff < 0 ? "text-gain" : "text-loss"}`}>
                          {i === 0 ? "—" : `${diff < 0 ? "saves " : "costs "}${formatINR(Math.abs(diff))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-3">Enter an amount, a rate and a tenure up to 50 years.</p>
      )}
    </div>
  );
}

function Stat({ label, value, sub, strong = false }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${strong ? "bg-pay-soft" : "bg-canvas"}`}>
      <div className={`text-xs font-medium ${strong ? "text-pay-strong" : "text-ink-2"}`}>{label}</div>
      <div className="num text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function LoanForm({
  initial,
  today,
  emiCandidates,
}: {
  initial?: Loan;
  today: string;
  /** Recurring payments not yet linked to a loan (to link an existing EMI item). */
  emiCandidates: { id: string; title: string; amountPaise: number }[];
}) {
  const { state, formAction, pending } = useSavingAction(saveLoanAction);
  const err = state.errors ?? {};
  const [f, setF] = useState({
    principal: initial ? paiseToInput(initial.principalPaise) : "",
    rate: initial ? String(initial.annualRateBps / 100) : "",
    tenure: initial ? String(initial.tenureMonths) : "",
    emi: initial ? paiseToInput(initial.emiPaise) : "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const computed = useMemo(() => {
    const p = parseRupees(f.principal);
    const r = parseRate(f.rate);
    const n = Number(f.tenure);
    return p && r !== null && Number.isInteger(n) && n > 0 && n <= 600 ? computeEmi(p, r, n) : null;
  }, [f.principal, f.rate, f.tenure]);

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-6" noValidate>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <RequestIdField />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loan name" error={err.name}>
          <input name="name" defaultValue={initial?.name} maxLength={80} autoFocus={!initial} placeholder="e.g. Car loan" className={inputCls(err.name)} />
        </Field>
        <Field label="Lender (optional)" error={err.lender}>
          <input name="lender" defaultValue={initial?.lender ?? ""} maxLength={80} placeholder="e.g. HDFC Bank" className={inputCls(err.lender)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Amount borrowed" error={err.principal}>
          <MoneyInput name="principal" value={f.principal} onChange={set("principal")} error={err.principal} />
        </Field>
        <Field label="Interest rate (% a year)" error={err.rate}>
          <input name="rate" value={f.rate} onChange={set("rate")} inputMode="decimal" placeholder="e.g. 9.25" className={`${inputCls(err.rate)} num`} />
        </Field>
        <Field label="Tenure (months)" error={err.tenure}>
          <input name="tenure" value={f.tenure} onChange={set("tenure")} inputMode="numeric" placeholder="e.g. 60" className={`${inputCls(err.tenure)} num`} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="First EMI date" error={err.firstEmiDate}>
          <input type="date" name="firstEmiDate" defaultValue={initial?.firstEmiDate ?? addMonths(today, 1)} className={inputCls(err.firstEmiDate)} />
        </Field>
        <Field label="EMI (from your lender)" hint={computed ? `Calculated: ${formatINR(computed)}. Leave empty to use it.` : "Leave empty to calculate it."} error={err.emi}>
          <MoneyInput name="emi" value={f.emi} onChange={set("emi")} error={err.emi} />
        </Field>
        <Field label="EMIs already paid" hint="Before you started tracking here." error={err.paidBefore}>
          <input name="paidBefore" defaultValue={initial?.paidBeforeTracking ?? 0} inputMode="numeric" className={`${inputCls(err.paidBefore)} num`} />
        </Field>
      </div>

      {!initial && (
        <fieldset className="space-y-2 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Track EMI payments</legend>
          <p className="text-xs text-ink-3">Each EMI is tracked by ONE recurring payment, so it never shows up twice.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="emiItem" value="create" defaultChecked className="mt-1" />
            <span>
              <strong>Create a monthly EMI payment</strong>
              <span className="block text-xs text-ink-3">Shows on your dashboard and calendar; mark each EMI as paid there.</span>
            </span>
          </label>
          {emiCandidates.map((c) => (
            <label key={c.id} className="flex items-start gap-2 text-sm">
              <input type="radio" name="emiItem" value={`link:${c.id}`} className="mt-1" />
              <span>
                Use my existing payment <strong>{c.title}</strong> <span className="num text-ink-3">({formatINR(c.amountPaise)})</span>
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="emiItem" value="none" className="mt-1" />
            <span>Don&apos;t track payments (calculations only)</span>
          </label>
        </fieldset>
      )}

      <FormAlert state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={initial ? `/loans/${initial.id}` : "/loans"} className="press rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-ink-2 hover:bg-canvas">
          Cancel
        </Link>
        <SubmitButton pending={pending} tone="pay">
          {initial ? "Save changes" : "Add loan"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function PrepaymentForm({ loanId, today }: { loanId: string; today: string }) {
  const { state, formAction, pending, successes } = useSavingAction(prepaymentAction);
  const err = state.errors ?? {};
  return (
    <form key={successes} action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="loanId" value={loanId} />
      <RequestIdField resetKey={successes} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" error={err.amount}>
          <MoneyInput name="amount" error={err.amount} />
        </Field>
        <Field label="Date" error={err.date}>
          <input type="date" name="date" defaultValue={today} className={inputCls(err.date)} />
        </Field>
      </div>
      <FormAlert state={state} />
      <SubmitButton pending={pending} tone="pay">
        Record prepayment
      </SubmitButton>
      <p className="text-xs text-ink-3">Applied after the last EMI on or before this date, shortening the tenure (EMI unchanged).</p>
    </form>
  );
}

export function LinkEmiForm({ loanId, candidates }: { loanId: string; candidates: { id: string; title: string; amountPaise: number }[] }) {
  const { state, formAction, pending } = useSavingAction(linkLoanAction);
  if (candidates.length === 0) return <p className="text-sm text-ink-3">No unlinked recurring payments. Add a monthly payment for the EMI first.</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium text-ink-2">Recurring payment</span>
        <select name="transactionId" className={inputCls()}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({formatINR(c.amountPaise)})
            </option>
          ))}
        </select>
      </label>
      <SubmitButton pending={pending}>Link</SubmitButton>
      <FormAlert state={state} />
    </form>
  );
}

