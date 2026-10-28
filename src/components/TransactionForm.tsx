"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { formatDate } from "@/lib/dates";
import { paiseToInput } from "@/lib/money";
import { describeRecurrence, isRecurring } from "@/lib/recurrence";
import { FREQUENCIES, FREQUENCY_LABEL, type Category, type Direction, type Frequency, type Transaction } from "@/lib/types";
import { saveTransaction, type FormState } from "@/server/actions";
import { ArrowIn, ArrowOut, Repeat } from "./icons";
import { useToast } from "./Toast";

interface Props {
  categories: Category[];
  today: string;
  initial?: Transaction;
  defaultDirection?: Direction;
  returnTo?: string;
}

export function TransactionForm({ categories, today, initial, defaultDirection, returnTo }: Props) {
  const [state, formAction, submitting] = useActionState<FormState, FormData>(saveTransaction, {});
  const router = useRouter();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const saving = submitting || leaving;

  // Saved: confirm with a toast and go back to where the user came from.
  useEffect(() => {
    if (state.ok && state.redirectTo) {
      setLeaving(true);
      toast(state.message ?? "Saved");
      router.push(state.redirectTo);
    }
  }, [state, router, toast]);
  const [direction, setDirection] = useState<Direction | null>(initial?.direction ?? defaultDirection ?? null);
  const [f, setF] = useState({
    title: initial?.title ?? "",
    amount: initial ? paiseToInput(initial.amountPaise) : "",
    categoryId: initial?.category.id ?? "",
    frequency: (initial?.frequency ?? "ONE_TIME") as Frequency,
    dueDate: initial?.dueDate ?? today,
    startDate: initial?.startDate ?? "",
    endDate: initial?.endDate ?? "",
    counterparty: initial?.counterparty ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const err = state.errors ?? {};
  const recurring = isRecurring(f.frequency);
  const options = categories.filter((c) => c.direction === direction);
  const pay = direction === "PAY";

  function chooseDirection(d: Direction) {
    if (d !== direction) setF((prev) => ({ ...prev, categoryId: "" }));
    setDirection(d);
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {direction && <input type="hidden" name="direction" value={direction} />}
      <input type="hidden" name="frequency" value={f.frequency} />

      {/* Step 1: what is this? */}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">What is this?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <DirectionChoice
            selected={direction === "PAY"}
            onClick={() => chooseDirection("PAY")}
            icon={<ArrowOut width={18} height={18} />}
            title="Payment I need to make"
            hint="Rent, EMI, bills, shopping"
            tone="pay"
          />
          <DirectionChoice
            selected={direction === "RECEIVE"}
            onClick={() => chooseDirection("RECEIVE")}
            icon={<ArrowIn width={18} height={18} />}
            title="Money I need to receive"
            hint="Salary, rent from tenants, refunds"
            tone="receive"
          />
        </div>
        {err.direction && <FieldError>{err.direction}</FieldError>}
      </fieldset>

      {direction && (
        <div className="rise space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Title" error={err.title}>
              <input
                name="title"
                value={f.title}
                onChange={set("title")}
                required
                autoFocus={!initial}
                maxLength={100}
                placeholder={pay ? "e.g. Home Rent" : "e.g. Rent from Rahul"}
                className={inputCls(err.title)}
              />
            </Field>
            <Field label="Amount" error={err.amount}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">₹</span>
                <input
                  name="amount"
                  value={f.amount}
                  onChange={set("amount")}
                  required
                  inputMode="decimal"
                  placeholder="0"
                  className={`${inputCls(err.amount)} num pl-7`}
                />
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" error={err.categoryId}>
              <select name="categoryId" value={f.categoryId} onChange={set("categoryId")} required className={inputCls(err.categoryId)}>
                <option value="" disabled>
                  Choose a category
                </option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={recurring ? "Next due date" : pay ? "Due date" : "Expected on"} error={err.dueDate}>
              <input type="date" name="dueDate" value={f.dueDate} onChange={set("dueDate")} required className={inputCls(err.dueDate)} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-2">How often?</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {FREQUENCIES.map((fr) => (
                <button
                  key={fr}
                  type="button"
                  role="radio"
                  aria-checked={f.frequency === fr}
                  onClick={() => setF((p) => ({ ...p, frequency: fr }))}
                  className="press rounded-full border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-2 hover:border-ink-3 hover:bg-canvas aria-checked:border-ink aria-checked:bg-ink aria-checked:text-on-ink"
                >
                  {FREQUENCY_LABEL[fr]}
                </button>
              ))}
            </div>
            {recurring && f.dueDate && (
              <p className="fade-in mt-3 flex items-start gap-2 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-2">
                <Repeat width={16} height={16} className="mt-0.5 shrink-0" />
                <span>
                  <strong className="font-semibold text-ink">{describeRecurrence(f.frequency, f.dueDate)}.</strong> When you mark
                  the {formatDate(f.dueDate)} one as {pay ? "paid" : "received"}, the next one shows up automatically.
                </span>
              </p>
            )}
          </fieldset>

          {recurring && (
            <div className="fade-in grid gap-4 sm:grid-cols-2">
              <Field label="Start date" hint="When this began. Defaults to the due date." error={err.startDate}>
                <input type="date" name="startDate" value={f.startDate} onChange={set("startDate")} className={inputCls(err.startDate)} />
              </Field>
              <Field label="End date (optional)" hint="Leave empty if it repeats indefinitely." error={err.endDate}>
                <input type="date" name="endDate" value={f.endDate} onChange={set("endDate")} className={inputCls(err.endDate)} />
              </Field>
            </div>
          )}

          <Field label={pay ? "Paid to (optional)" : "From (optional)"} error={err.counterparty}>
            <input
              name="counterparty"
              value={f.counterparty}
              onChange={set("counterparty")}
              maxLength={100}
              placeholder={pay ? "e.g. Landlord, HDFC Bank, Netflix" : "e.g. Rahul - Tenant"}
              className={inputCls(err.counterparty)}
            />
          </Field>

          <Field label="Notes (optional)" error={err.notes}>
            <textarea name="notes" value={f.notes} onChange={set("notes")} rows={2} maxLength={1000} className={inputCls(err.notes)} />
          </Field>

          {state.message && !state.ok && (
            <p role="alert" className="fade-in rounded-lg bg-overdue-soft px-3 py-2 text-sm text-overdue">
              {state.message}
            </p>
          )}
          {Object.keys(err).length > 0 && !state.message && (
            <p role="alert" className="fade-in text-sm font-medium text-overdue">
              Fix the highlighted fields and save again.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link
              href={returnTo ?? "/transactions"}
              className="press rounded-lg px-4 py-2.5 text-center text-sm font-semibold text-ink-2 hover:bg-canvas"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className={`press inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-80 ${
                pay ? "bg-pay hover:bg-pay-hover" : "bg-receive hover:bg-receive-hover"
              }`}
            >
              {saving && <span className="spinner" aria-hidden />}
              {saving ? "Saving…" : initial ? "Save changes" : pay ? "Add payment" : "Add money to receive"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function DirectionChoice({
  selected,
  onClick,
  icon,
  title,
  hint,
  tone,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  tone: "pay" | "receive";
}) {
  const sel =
    tone === "pay" ? "border-pay bg-pay-soft ring-1 ring-pay" : "border-receive bg-receive-soft ring-1 ring-receive";
  const iconCls = tone === "pay" ? "bg-pay text-white" : "bg-receive text-white";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`press flex items-center gap-3 rounded-xl border p-4 text-left ${
        selected ? sel : "border-line-strong bg-surface hover:bg-canvas"
      }`}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconCls}`}>{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-ink-3">{hint}</span>
      </span>
    </button>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <span className="fade-in mt-1 block text-xs font-medium text-overdue">{children}</span>;
}

function inputCls(error?: string) {
  return `block w-full rounded-lg border bg-surface px-3 py-2 text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:outline-none focus:ring-2 ${
    error ? "border-overdue focus:ring-overdue/30" : "border-line-strong hover:border-ink-3 focus:border-pay focus:ring-pay/20"
  }`;
}
