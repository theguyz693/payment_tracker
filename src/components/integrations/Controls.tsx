"use client";

// Interactive controls for the hub: demo connections, request decisions,
// pending-payment resolution, mandates and event console actions.

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { FREQUENCIES, FREQUENCY_LABEL, type Category } from "@/lib/types";
import {
  connectProviderAction,
  createMandateAction,
  decideRequestAction,
  mandateStatusAction,
  resendEventAction,
  resolveAttemptAction,
  resolvePaymentAction,
  retryEventAction,
  runMandateAttemptAction,
  runWorkerAction,
  type SimState,
} from "@/server/integrations/actions";
import { Field, FormAlert, inputCls, MoneyInput, RequestIdField, SubmitButton, useSavingAction } from "../forms";
import { useToast } from "../Toast";
import { btnSecondary } from "../ui";
import { SimResult } from "./Simulators";

/** Runs a server action from a button, then toasts and refreshes. */
function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false, message: "Couldn't reach the server. Check your connection." }));
      toast(r.message, r.ok ? undefined : { tone: "error" });
      router.refresh();
    });
  return { pending, run };
}

const small = "press inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60";

export function ConnectToggle({ provider, connected }: { provider: string; connected: boolean }) {
  const { pending, run } = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => connectProviderAction(provider, !connected))}
      className={`${small} ${connected ? "border border-line-strong text-ink-2 hover:bg-canvas" : "bg-ink text-on-ink hover:opacity-90"}`}
    >
      {pending && <span className="spinner" aria-hidden />}
      {connected ? "Disconnect" : "Connect demo account"}
    </button>
  );
}

/** Accept / reject with one idempotency key per request (reused if the click is retried). */
export function RequestDecision({ id }: { id: string }) {
  const { pending, run } = useRun();
  const [key] = useState(() => (typeof crypto !== "undefined" ? crypto.randomUUID() : `k-${id}-${Date.now()}`));
  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => decideRequestAction(id, "ACCEPT", key))} className={`${small} bg-pay text-white hover:bg-pay-hover`}>
        {pending && <span className="spinner" aria-hidden />}
        Accept &amp; pay
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => decideRequestAction(id, "REJECT", `${key}-r`))} className={`${small} border border-line-strong text-ink-2 hover:bg-canvas`}>
        Reject
      </button>
    </div>
  );
}

export function ResolvePayment({ eventId }: { eventId: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-1.5">
      <button type="button" disabled={pending} onClick={() => run(() => resolvePaymentAction(eventId, "SUCCESS"))} className={`${small} bg-gain-soft text-gain hover:opacity-90`}>
        Provider: success
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => resolvePaymentAction(eventId, "FAILED"))} className={`${small} bg-loss-soft text-loss hover:opacity-90`}>
        Provider: failed
      </button>
    </div>
  );
}

export function EventActions({ id, canRetry }: { id: string; canRetry: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap gap-2">
      {canRetry && (
        <button type="button" disabled={pending} onClick={() => run(() => retryEventAction(id))} className={btnSecondary}>
          {pending && <span className="spinner" aria-hidden />}
          Retry processing
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => run(() => resendEventAction(id))} className={btnSecondary} title="Delivers the identical payload again">
        Resend same event (duplicate test)
      </button>
    </div>
  );
}

export function RunWorker() {
  const { pending, run } = useRun();
  return (
    <button type="button" disabled={pending} onClick={() => run(() => runWorkerAction())} className={btnSecondary}>
      {pending && <span className="spinner" aria-hidden />}
      Run retry worker
    </button>
  );
}

// ---- Autopay ----

export function MandateForm({ categories, today, connected }: { categories: Category[]; today: string; connected: boolean }) {
  const { state, formAction, pending, successes } = useSavingAction(createMandateAction);
  const err = state.errors ?? {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <RequestIdField resetKey={successes} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mandate name" error={err.name}>
          <input name="name" defaultValue="Netflix" maxLength={60} className={inputCls(err.name)} />
        </Field>
        <Field label="Payee" error={err.payeeName}>
          <input name="payeeName" defaultValue="Netflix (demo)" maxLength={80} className={inputCls(err.payeeName)} />
        </Field>
        <Field label="Amount per debit" error={err.amount}>
          <MoneyInput name="amount" defaultValue="649" error={err.amount} />
        </Field>
        <Field label="Frequency" error={err.frequency}>
          <select name="frequency" defaultValue="MONTHLY" className={inputCls(err.frequency)}>
            {FREQUENCIES.filter((f) => f !== "ONE_TIME").map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABEL[f]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="First debit date" error={err.startDate}>
          <input type="date" name="startDate" defaultValue={today} className={inputCls(err.startDate)} />
        </Field>
        <Field label="End date (optional)" error={err.endDate}>
          <input type="date" name="endDate" className={inputCls(err.endDate)} />
        </Field>
        <Field label="Simulated provider">
          <select name="provider" defaultValue="autopay_sim" className={inputCls()}>
            <option value="autopay_sim">Autopay Simulator</option>
            <option value="gpay_sim">Google Pay Simulator (UPI Autopay)</option>
            <option value="phonepe_sim">PhonePe Simulator (UPI Autopay)</option>
          </select>
        </Field>
        <Field label="Category" error={err.categoryId}>
          <select name="categoryId" defaultValue="PAY:Subscription" className={inputCls(err.categoryId)}>
            {categories
              .filter((c) => c.direction === "PAY")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <FormAlert state={state} />
      {connected ? (
        <SubmitButton pending={pending}>Create mandate</SubmitButton>
      ) : (
        <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-2">Connect the Autopay Simulator on the Overview tab to create mandates.</p>
      )}
    </form>
  );
}

export function MandateControls({ id, status }: { id: string; status: "ACTIVE" | "PAUSED" | "CANCELLED" }) {
  const { pending, run } = useRun();
  if (status === "CANCELLED") return null;
  return (
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => mandateStatusAction(id, status === "ACTIVE" ? "PAUSED" : "ACTIVE"))} className={btnSecondary}>
        {status === "ACTIVE" ? "Pause mandate" : "Resume mandate"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm("Cancel this mandate? It can't be resumed afterwards.")) run(() => mandateStatusAction(id, "CANCELLED"));
        }}
        className={`${btnSecondary} text-loss`}
      >
        Cancel
      </button>
    </div>
  );
}

export function AttemptRunner({ mandateId, disabled, reason }: { mandateId: string; disabled: boolean; reason: string | null }) {
  const [state, formAction, pending] = useActionState<SimState, FormData>(runMandateAttemptAction, {});
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (!state.message) return;
    toast(state.message, state.ok ? undefined : { tone: "error" });
    router.refresh();
  }, [state, router, toast]);
  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="mandateId" value={mandateId} />
        <div className="flex flex-wrap gap-2">
          {(["SUCCESS", "PENDING", "FAILED"] as const).map((o) => (
            <button
              key={o}
              type="submit"
              name="outcome"
              value={o}
              disabled={pending || disabled}
              className={`${small} ${o === "SUCCESS" ? "bg-gain text-white" : o === "PENDING" ? "bg-pending-soft text-pending" : "bg-loss-soft text-loss"} px-3.5 py-2`}
            >
              Run debit: {o.toLowerCase()}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" name="repeat" value="1" />
          Re-send the last attempt (same event identity) to see duplicate protection
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" name="failFirstAttempts" value="1" />
          Inject one transient processing failure (rolls back, retried from the console)
        </label>
        {disabled && reason && <p className="text-xs text-ink-3">{reason}</p>}
      </form>
      <SimResult state={state} />
    </div>
  );
}

export function ResolveAttempt({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-1.5">
      <button type="button" disabled={pending} onClick={() => run(() => resolveAttemptAction(id, "SUCCESS"))} className={`${small} bg-gain-soft text-gain`}>
        Bank: success
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => resolveAttemptAction(id, "FAILED"))} className={`${small} bg-loss-soft text-loss`}>
        Bank: failed
      </button>
    </div>
  );
}
