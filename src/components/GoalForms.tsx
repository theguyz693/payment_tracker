"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/dates";
import { parseDecimal } from "@/lib/decimal";
import { GOAL_CATEGORIES, GOAL_PRIORITIES, monthsUntil, projectSavings, type Goal } from "@/lib/goals";
import { formatINR, paiseToInput, parseRupees } from "@/lib/money";
import { goalEntryAction, saveGoalAction } from "@/server/finance-actions";
import { Field, FormAlert, inputCls, MoneyInput, RequestIdField, SubmitButton, useSavingAction } from "./forms";

const PLAN_FREQS = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
const EVERY: Record<(typeof PLAN_FREQS)[number], string> = { WEEKLY: "Week", MONTHLY: "Month", QUARTERLY: "Quarter", YEARLY: "Year" };

export function GoalForm({ initial, today }: { initial?: Goal; today: string }) {
  const { state, formAction, pending } = useSavingAction(saveGoalAction);
  const err = state.errors ?? {};
  const [target, setTarget] = useState(initial ? paiseToInput(initial.targetPaise) : "");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [initialSaved, setInitialSaved] = useState("");

  // Live hint: required monthly saving for the entered target and date.
  const hint = useMemo(() => {
    const t = parseRupees(target);
    const s = parseRupees(initialSaved || "0") ?? 0;
    if (!t || !targetDate || targetDate <= today) return null;
    const months = monthsUntil(today, targetDate);
    return `Save about ${formatINR(Math.ceil(Math.max(0, t - s) / months))} a month for ${months} month${months === 1 ? "" : "s"} to get there by ${formatDate(targetDate, today)}.`;
  }, [target, targetDate, initialSaved, today]);

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-6" noValidate>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <RequestIdField />
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Goal name" error={err.name}>
          <input name="name" defaultValue={initial?.name} required maxLength={80} autoFocus={!initial} placeholder="e.g. New laptop" className={inputCls(err.name)} />
        </Field>
        <Field label="Target amount" error={err.target}>
          <MoneyInput name="target" value={target} onChange={(e) => setTarget(e.target.value)} error={err.target} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Target date (optional)" error={err.targetDate}>
          <input type="date" name="targetDate" value={targetDate} min={initial ? undefined : today} onChange={(e) => setTargetDate(e.target.value)} className={inputCls(err.targetDate)} />
        </Field>
        <Field label="Category" error={err.category}>
          <select name="category" defaultValue={initial?.category ?? "Big purchase"} className={inputCls(err.category)}>
            {GOAL_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" error={err.priority}>
          <select name="priority" defaultValue={initial?.priority ?? "MEDIUM"} className={inputCls(err.priority)}>
            {GOAL_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0] + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!initial && (
        <Field label="Already saved (optional)" hint="Recorded as the first contribution." error={err.initial}>
          <MoneyInput name="initial" value={initialSaved} onChange={(e) => setInitialSaved(e.target.value)} error={err.initial} />
        </Field>
      )}
      {hint && <p className="fade-in rounded-lg bg-save-soft px-3 py-2 text-sm text-save">{hint}</p>}

      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Contribution plan (optional)</legend>
        <p className="text-xs text-ink-3">A plan shows up on your calendar and drives the projected completion date. Nothing is moved automatically; you record contributions yourself.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount" error={err.planAmount}>
            <MoneyInput name="planAmount" defaultValue={initial?.plan ? paiseToInput(initial.plan.amountPaise) : ""} error={err.planAmount} />
          </Field>
          <Field label="Every" error={err.planFrequency}>
            <select name="planFrequency" defaultValue={initial?.plan?.frequency ?? "MONTHLY"} className={inputCls()}>
              {PLAN_FREQS.map((f) => (
                <option key={f} value={f}>
                  {EVERY[f]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starting" error={err.planStart}>
            <input type="date" name="planStart" defaultValue={initial?.plan?.anchorDate ?? ""} className={inputCls(err.planStart)} />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes (optional)" error={err.description}>
        <textarea name="description" defaultValue={initial?.description ?? ""} rows={2} maxLength={500} className={inputCls(err.description)} />
      </Field>
      <FormAlert state={state} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={initial ? `/goals/${initial.id}` : "/goals"} className="press rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-ink-2 hover:bg-canvas">
          Cancel
        </Link>
        <SubmitButton pending={pending} tone="save">
          {initial ? "Save changes" : "Create goal"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function GoalEntryForm({ goalId, today, savedPaise }: { goalId: string; today: string; savedPaise: number }) {
  const { state, formAction, pending, successes } = useSavingAction(goalEntryAction);
  const err = state.errors ?? {};
  const [type, setType] = useState<"CONTRIBUTION" | "WITHDRAWAL">("CONTRIBUTION");
  return (
    <form key={successes} action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="type" value={type} />
      <RequestIdField resetKey={successes} />
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1" role="radiogroup" aria-label="Entry type">
        {(["CONTRIBUTION", "WITHDRAWAL"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className="press rounded-md py-1.5 text-sm font-semibold text-ink-2 aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-sm"
          >
            {t === "CONTRIBUTION" ? "Add money" : "Withdraw"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" error={err.amount}>
          <MoneyInput name="amount" error={err.amount} />
        </Field>
        <Field label="Date" error={err.date}>
          <input type="date" name="date" defaultValue={today} max={today} className={inputCls(err.date)} />
        </Field>
      </div>
      <Field label="Note (optional)" error={err.note}>
        <input name="note" maxLength={200} className={inputCls(err.note)} placeholder={type === "WITHDRAWAL" ? "e.g. Used for the deposit" : "e.g. October savings"} />
      </Field>
      {type === "WITHDRAWAL" && <p className="text-xs text-ink-3">Up to {formatINR(savedPaise)} can be withdrawn.</p>}
      <FormAlert state={state} />
      <SubmitButton pending={pending} tone="save">
        {type === "CONTRIBUTION" ? "Record contribution" : "Record withdrawal"}
      </SubmitButton>
    </form>
  );
}

/** "If I save ₹X a month, how much by date Y?" Interest is hypothetical. */
export function ProjectionCalculator({ today }: { today: string }) {
  const [monthly, setMonthly] = useState("5000");
  const [start, setStart] = useState("0");
  const [until, setUntil] = useState(() => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10);
  });
  const [rate, setRate] = useState("");

  const result = useMemo(() => {
    const m = parseRupees(monthly || "0");
    const s = parseRupees(start || "0");
    const bps = rate ? parseDecimal(rate, 2) : 0;
    if (m === null || s === null || bps === null || bps > 5000 || !until || until <= today) return null;
    const months = monthsUntil(today, until);
    return { months, plain: projectSavings({ startingPaise: s, monthlyPaise: m, months, annualRateBps: 0 }), withRate: bps ? projectSavings({ startingPaise: s, monthlyPaise: m, months, annualRateBps: bps }) : null };
  }, [monthly, start, until, rate, today]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Save every month">
          <MoneyInput value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
        <Field label="Starting with">
          <MoneyInput value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Until">
          <input type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className={inputCls()} />
        </Field>
        <Field label="Assumed interest (optional)" hint="Annual %, e.g. 6.5 for a deposit.">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls()} num`} />
        </Field>
      </div>
      {result ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
          <div className="rounded-xl bg-save-soft px-4 py-3">
            <div className="text-xs font-medium text-save">Saved by {formatDate(until, today)} (no interest)</div>
            <div className="num text-2xl font-bold">{formatINR(result.plain.balancePaise)}</div>
            <div className="text-xs text-ink-3">{result.months} monthly contributions</div>
          </div>
          {result.withRate && (
            <div className="rounded-xl border border-dashed border-line-strong px-4 py-3">
              <div className="text-xs font-medium text-ink-2">Hypothetical, with {rate}% a year</div>
              <div className="num text-2xl font-bold">{formatINR(result.withRate.balancePaise)}</div>
              <div className="text-xs text-ink-3">incl. {formatINR(result.withRate.interestPaise)} assumed interest, not guaranteed</div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-3">Enter an amount and a future date.</p>
      )}
    </div>
  );
}
