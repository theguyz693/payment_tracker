"use client";

// Form building blocks shared by the new feature forms (same look as TransactionForm).

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { FormState } from "@/server/form";
import { useToast } from "./Toast";

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="fade-in mt-1 block text-xs font-medium text-overdue">{children}</span>;
}

export function inputCls(error?: string) {
  return `block w-full rounded-lg border bg-surface px-3 py-2 text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:outline-none focus:ring-2 ${
    error ? "border-overdue focus:ring-overdue/30" : "border-line-strong hover:border-ink-3 focus:border-pay focus:ring-pay/20"
  }`;
}

/** ₹-prefixed amount input. */
export function MoneyInput({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">₹</span>
      <input inputMode="decimal" placeholder="0" {...props} className={`${inputCls(error)} num pl-7`} />
    </div>
  );
}

/**
 * Idempotency key for one form "session". The server dedupes on it, so a
 * double-click or retried submit never records the same thing twice.
 * A new key is issued after each successful save (`resetKey`).
 */
export function RequestIdField({ resetKey }: { resetKey?: unknown }) {
  const [id, setId] = useState("");
  useEffect(() => {
    setId(crypto.randomUUID());
  }, [resetKey]);
  return <input type="hidden" name="requestId" value={id} />;
}

export function FormAlert({ state }: { state: FormState }) {
  const errs = state.errors ?? {};
  if (state.message && !state.ok)
    return (
      <p role="alert" className="fade-in rounded-lg bg-overdue-soft px-3 py-2 text-sm text-overdue">
        {state.message}
      </p>
    );
  if (Object.keys(errs).length > 0)
    return (
      <p role="alert" className="fade-in text-sm font-medium text-overdue">
        {errs.form ?? "Fix the highlighted fields and save again."}
      </p>
    );
  return null;
}

export function SubmitButton({ pending, children, tone = "ink" }: { pending: boolean; children: React.ReactNode; tone?: "ink" | "save" | "invest" | "pay" }) {
  const toneCls = { ink: "bg-ink text-on-ink hover:opacity-90", save: "bg-save text-white hover:opacity-90", invest: "bg-invest text-white hover:opacity-90", pay: "bg-pay text-white hover:bg-pay-hover" }[tone];
  return (
    <button type="submit" disabled={pending} className={`press inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-80 ${toneCls}`}>
      {pending && <span className="spinner" aria-hidden />}
      {pending ? "Saving…" : children}
    </button>
  );
}

/**
 * useActionState + toast + optional redirect/refresh on success.
 * Returns a counter that bumps after each success (use it to reset the form).
 */
export function useSavingAction(action: (prev: FormState, fd: FormData) => Promise<FormState>) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();
  const toast = useToast();
  const [successes, setSuccesses] = useState(0);
  useEffect(() => {
    if (!state.ok) return;
    toast(state.message ?? "Saved");
    setSuccesses((n) => n + 1);
    if (state.redirectTo) router.push(state.redirectTo);
    else router.refresh();
  }, [state, router, toast]);
  return { state, formAction, pending, successes };
}
