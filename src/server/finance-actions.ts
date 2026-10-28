"use server";

// Server actions for settings, savings goals and loans.
// Same contract as actions.ts: requireUser() first (never a client user id),
// validate, then call the user-scoped repository.

import { revalidatePath } from "next/cache";
import { addMonths, formatDate } from "@/lib/dates";
import { computeEmi } from "@/lib/emi";
import { goalEntrySchema, goalSchema, loanSchema, prepaymentSchema, settingsSchema } from "@/lib/finance-validation";
import { formatINR } from "@/lib/money";
import * as fin from "./finance-repo";
import { formGetter, GENERIC_ERROR, requestIdFrom, toFieldErrors, type FormState } from "./form";
import { createTransaction, UserError } from "./repository";
import { getToday, requireUser } from "./session";

function fail(e: unknown, where: string): FormState {
  if (e instanceof UserError) return { message: e.message };
  console.error(`[${where}]`, e);
  return { message: GENERIC_ERROR };
}

// ---------------- Settings ----------------

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = settingsSchema.safeParse({ cashBalance: get("cashBalance"), cashAsOf: get("cashAsOf") });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  try {
    await fin.saveSettings(user.id, {
      cashBalancePaise: parsed.data.cashBalance,
      cashAsOf: parsed.data.cashBalance === null ? null : parsed.data.cashAsOf,
    });
  } catch (e) {
    return fail(e, "saveSettings");
  }
  revalidatePath("/", "layout");
  return { ok: true, message: parsed.data.cashBalance === null ? "Cash balance cleared." : "Cash balance saved." };
}

// ---------------- Goals ----------------

export async function saveGoalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = goalSchema.safeParse({
    name: get("name"),
    description: get("description"),
    target: get("target"),
    targetDate: get("targetDate"),
    priority: get("priority"),
    category: get("category"),
    initial: get("initial"),
    planAmount: get("planAmount"),
    planFrequency: get("planFrequency") || undefined,
    planStart: get("planStart"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const plan = d.planAmount > 0 && d.planStart ? { amountPaise: d.planAmount, frequency: d.planFrequency ?? "MONTHLY", anchorDate: d.planStart } : null;
  const input = { name: d.name, description: d.description, targetPaise: d.target, targetDate: d.targetDate, priority: d.priority, category: d.category, plan };
  const id = get("id");
  try {
    if (id) {
      await fin.updateGoal(user.id, id, input);
      revalidatePath("/", "layout");
      return { ok: true, message: `${d.name} saved.`, redirectTo: `/goals/${id}` };
    }
    const newId = await fin.createGoal(user.id, { ...input, initialPaise: d.initial, today: await getToday() }, requestIdFrom(formData));
    revalidatePath("/", "layout");
    return { ok: true, message: `${d.name} added.`, redirectTo: `/goals/${newId}` };
  } catch (e) {
    return fail(e, "saveGoal");
  }
}

export async function goalEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = goalEntrySchema.safeParse({ type: get("type"), amount: get("amount"), date: get("date"), note: get("note") });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const goalId = get("goalId") ?? "";
  try {
    const today = await getToday();
    if (parsed.data.date > today) return { errors: { date: "Record money once it has moved (today or earlier)." } };
    const r = await fin.addGoalEntry(
      user.id,
      goalId,
      { type: parsed.data.type, amountPaise: parsed.data.amount, date: parsed.data.date, note: parsed.data.note },
      requestIdFrom(formData),
    );
    revalidatePath("/", "layout");
    const verb = parsed.data.type === "CONTRIBUTION" ? "added to" : "withdrawn from";
    return { ok: true, message: r === "duplicate" ? "Already recorded." : `${formatINR(parsed.data.amount)} ${verb} the goal.` };
  } catch (e) {
    return fail(e, "goalEntry");
  }
}

export async function archiveGoalAction(id: unknown, archived: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof archived !== "boolean") return { ok: false };
  try {
    const ok = await fin.setGoalArchived(user.id, id, archived);
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    console.error("[archiveGoal]", e);
    return { ok: false };
  }
}

// ---------------- Loans ----------------

export async function saveLoanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = loanSchema.safeParse({
    name: get("name"),
    lender: get("lender"),
    principal: get("principal"),
    rate: get("rate") ?? "",
    tenure: get("tenure"),
    firstEmiDate: get("firstEmiDate"),
    emi: get("emi"),
    paidBefore: get("paidBefore") || 0,
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  if (d.paidBefore >= d.tenure) return { errors: { paidBefore: "That's every EMI — this loan is already paid off." } };
  const input: fin.LoanInput = {
    name: d.name,
    lender: d.lender,
    principalPaise: d.principal,
    annualRateBps: d.rate,
    tenureMonths: d.tenure,
    firstEmiDate: d.firstEmiDate,
    emiPaise: d.emi > 0 ? d.emi : computeEmi(d.principal, d.rate, d.tenure),
    paidBeforeTracking: d.paidBefore,
  };
  const id = get("id");
  try {
    if (id) {
      await fin.updateLoan(user.id, id, input);
      revalidatePath("/", "layout");
      return { ok: true, message: `${d.name} saved.`, redirectTo: `/loans/${id}` };
    }
    const requestId = requestIdFrom(formData);
    const { id: loanId, created } = await fin.createLoan(user.id, input, requestId);
    const emiMode = get("emiItem") ?? "create";
    if (created && emiMode === "create") {
      // Track EMIs with a recurring payment (the single source of EMI payment history).
      const nextDue = addMonths(d.firstEmiDate, d.paidBefore);
      const txId = await createTransaction(
        user.id,
        {
          direction: "PAY",
          title: `${d.name} EMI`,
          amount: input.emiPaise,
          categoryId: "PAY:EMI / Loan",
          frequency: "MONTHLY",
          dueDate: nextDue,
          startDate: d.firstEmiDate <= nextDue ? d.firstEmiDate : nextDue,
          endDate: addMonths(d.firstEmiDate, d.tenure - 1),
          counterparty: d.lender,
          notes: "Created with the loan. Mark each EMI as paid here.",
        },
        { requestId: `${requestId}-emi` },
      );
      await fin.linkLoanTransaction(user.id, loanId, txId);
    } else if (created && emiMode.startsWith("link:")) {
      await fin.linkLoanTransaction(user.id, loanId, emiMode.slice(5));
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `${d.name} added.`, redirectTo: `/loans/${loanId}` };
  } catch (e) {
    return fail(e, "saveLoan");
  }
}

export async function linkLoanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  try {
    await fin.linkLoanTransaction(user.id, get("loanId") ?? "", get("transactionId") ?? "");
    revalidatePath("/", "layout");
    return { ok: true, message: "EMI payment linked." };
  } catch (e) {
    return fail(e, "linkLoan");
  }
}

export async function prepaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = prepaymentSchema.safeParse({ amount: get("amount"), date: get("date") });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  try {
    const r = await fin.addPrepayment(user.id, get("loanId") ?? "", { amountPaise: parsed.data.amount, date: parsed.data.date }, requestIdFrom(formData));
    revalidatePath("/", "layout");
    return { ok: true, message: r === "duplicate" ? "Already recorded." : `Prepayment of ${formatINR(parsed.data.amount)} on ${formatDate(parsed.data.date)} recorded.` };
  } catch (e) {
    return fail(e, "prepayment");
  }
}

export async function archiveLoanAction(id: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false };
  try {
    const ok = await fin.archiveLoan(user.id, id);
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    console.error("[archiveLoan]", e);
    return { ok: false };
  }
}
