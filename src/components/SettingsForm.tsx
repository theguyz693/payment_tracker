"use client";

import { saveSettingsAction } from "@/server/finance-actions";
import { Field, FormAlert, inputCls, SubmitButton, useSavingAction } from "./forms";

export function SettingsForm({ cashBalance, cashAsOf, today }: { cashBalance: string; cashAsOf: string; today: string }) {
  const { state, formAction, pending } = useSavingAction(saveSettingsAction);
  const err = state.errors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cash balance" hint="All bank accounts and cash combined. Leave empty to clear." error={err.cashBalance}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">₹</span>
            <input name="cashBalance" defaultValue={cashBalance} inputMode="decimal" placeholder="e.g. 85,000" className={`${inputCls(err.cashBalance)} num pl-7`} />
          </div>
        </Field>
        <Field label="As of" hint="The date that balance was true." error={err.cashAsOf}>
          <input type="date" name="cashAsOf" defaultValue={cashAsOf || today} max={today} className={inputCls(err.cashAsOf)} />
        </Field>
      </div>
      <FormAlert state={state} />
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Save balance</SubmitButton>
      </div>
    </form>
  );
}
