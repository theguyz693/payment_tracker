"use server";

// Server actions = public POST endpoints. Every action:
//   1. resolves the user from the session cookie (requireUser) — never trusts a client-sent user id
//   2. validates its input
//   3. calls the user-scoped repository
// Errors shown to the user are generic unless they're a UserError.

import { revalidatePath } from "next/cache";
import { formatDate, isISODate } from "@/lib/dates";
import { transactionInputSchema } from "@/lib/validation";
import { GENERIC_ERROR, requestIdFrom, safeReturnPath, toFieldErrors, type FormState } from "./form";
import * as repo from "./repository";
import { getToday, requireUser } from "./session";

export type { FormState } from "./form";

function parseForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return transactionInputSchema.safeParse({
    direction: get("direction"),
    title: get("title") ?? "",
    amount: get("amount") ?? "",
    categoryId: get("categoryId") ?? "",
    frequency: get("frequency"),
    dueDate: get("dueDate") ?? "",
    startDate: get("startDate") || get("dueDate") || "",
    endDate: get("endDate"),
    counterparty: get("counterparty"),
    notes: get("notes"),
  });
}

export async function saveTransaction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const id = formData.get("id");
  const isEdit = typeof id === "string" && id.length > 0;
  try {
    if (isEdit) await repo.updateTransaction(user.id, id, parsed.data, await getToday());
    else await repo.createTransaction(user.id, parsed.data, { requestId: requestIdFrom(formData) });
  } catch (e) {
    if (e instanceof repo.UserError) return { message: e.message };
    console.error("[saveTransaction]", e);
    return { message: GENERIC_ERROR };
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: isEdit ? `${parsed.data.title} saved.` : `${parsed.data.title} added.`,
    redirectTo: safeReturnPath(formData.get("returnTo"), "/transactions"),
  };
}

export interface SettleResult {
  ok: boolean;
  message: string;
  /** Next due date for a recurring item that continues; null when the item is done. */
  nextDue: string | null;
}

/**
 * Mark the current occurrence paid/received.
 * Does not revalidate: the client plays its success animation, then refreshes.
 */
export async function settleAction(id: unknown, dueDate: unknown): Promise<SettleResult> {
  const user = await requireUser();
  if (typeof id !== "string" || typeof dueDate !== "string" || !isISODate(dueDate)) {
    return { ok: false, message: "That item couldn't be updated.", nextDue: null };
  }
  try {
    const settledOn = await getToday();
    const tx = await repo.settleTransaction(user.id, id, dueDate, settledOn);
    if (!tx) return { ok: false, message: "That item no longer exists.", nextDue: null };
    const verb = tx.direction === "PAY" ? "paid" : "received";
    if (tx.status === "PENDING") {
      return {
        ok: true,
        message: `${tx.title} marked as ${verb} ✓ Next due ${formatDate(tx.dueDate, settledOn)}`,
        nextDue: tx.dueDate,
      };
    }
    return { ok: true, message: `${tx.title} marked as ${verb} ✓`, nextDue: null };
  } catch (e) {
    console.error("[settleAction]", e);
    return { ok: false, message: GENERIC_ERROR, nextDue: null };
  }
}

export async function archiveAction(id: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false };
  try {
    return { ok: await repo.archiveTransaction(user.id, id) };
  } catch (e) {
    console.error("[archiveAction]", e);
    return { ok: false };
  }
}

export async function restoreAction(id: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false };
  try {
    return { ok: await repo.restoreTransaction(user.id, id) };
  } catch (e) {
    console.error("[restoreAction]", e);
    return { ok: false };
  }
}

export async function pauseAction(id: unknown): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: "That item couldn't be paused." };
  try {
    const ok = await repo.pauseTransaction(user.id, id);
    if (ok) revalidatePath("/", "layout");
    return ok ? { ok, message: "Paused. It won't show as due until you resume it." } : { ok, message: "Only active recurring items can be paused." };
  } catch (e) {
    console.error("[pauseAction]", e);
    return { ok: false, message: GENERIC_ERROR };
  }
}

export async function resumeAction(id: unknown): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false, message: "That item couldn't be resumed." };
  try {
    const today = await getToday();
    const due = await repo.resumeTransaction(user.id, id, today);
    revalidatePath("/", "layout");
    return { ok: true, message: `Resumed. Next due ${formatDate(due, today)}.` };
  } catch (e) {
    if (e instanceof repo.UserError) return { ok: false, message: e.message };
    console.error("[resumeAction]", e);
    return { ok: false, message: GENERIC_ERROR };
  }
}
