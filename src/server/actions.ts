"use server";

// Server actions = public POST endpoints. Every action:
//   1. passes the GateKeeper: session (requireUser — never a client-sent user
//      id) and the operation's rate limit
//   2. validates its input
//   3. calls the user-scoped repository
// Errors shown to the user are generic unless they're a UserError.

import { revalidatePath } from "next/cache";
import { formatDate, isISODate } from "@/lib/dates";
import { isIdempotencyKey } from "@/lib/integrations/rules";
import { transactionInputSchema } from "@/lib/validation";
import { UserError } from "./errors";
import { GENERIC_ERROR, safeReturnPath, toFieldErrors, type FormState } from "./form";
import { finish, gate } from "./guard";
import { withIdempotency } from "./idempotency";
import { logError } from "./log";
import * as repo from "./repository";
import { getToday } from "./session";

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
  const g = await gate("transaction.save", "tx.write");
  if (g.blocked) return { message: g.blocked };
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const id = formData.get("id");
  const isEdit = typeof id === "string" && id.length > 0;
  try {
    if (isEdit) {
      const version = formData.get("version");
      await repo.updateTransaction(g.user.id, id, parsed.data, await getToday(), {
        expectedVersion: typeof version === "string" && /^\d{1,16}$/.test(version) ? version : undefined,
      });
      finish(g, "updated");
    } else {
      // Idempotent create: the form sends one key per logical submission and
      // keeps it across retries, so a double-click or a retry after a lost
      // response returns the first result instead of adding a duplicate.
      const key = formData.get("requestId");
      if (!isIdempotencyKey(key)) return { message: "This form is out of date. Reload the page and try again." };
      const { result, replayed } = await withIdempotency(
        { userId: g.user.id, scope: "transaction.create", key, payload: parsed.data },
        async (session) => ({ id: await repo.createTransaction(g.user.id, parsed.data, { requestId: key, session }) }),
      );
      finish(g, replayed ? "replayed" : "created", { transactionId: result.id });
    }
  } catch (e) {
    logError("transaction.save", e, { requestId: g.requestId, userId: g.user.id });
    if (e instanceof UserError) return { message: e.message };
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
  /** What actually happened (another device may have settled it first). */
  outcome?: repo.SettleOutcome | "error";
}

/**
 * Mark the current occurrence paid/received.
 * Does not revalidate: the client plays its success animation, then refreshes.
 */
export async function settleAction(id: unknown, dueDate: unknown): Promise<SettleResult> {
  const g = await gate("transaction.settle", "tx.write");
  if (g.blocked) return { ok: false, message: g.blocked, nextDue: null, outcome: "error" };
  if (typeof id !== "string" || typeof dueDate !== "string" || !isISODate(dueDate)) {
    return { ok: false, message: "That item couldn't be updated.", nextDue: null, outcome: "error" };
  }
  try {
    const settledOn = await getToday();
    const res = await repo.settleOccurrence(g.user.id, id, dueDate, settledOn);
    const tx = res?.tx ?? null;
    finish(g, res?.outcome ?? "not_found");
    if (!res || !tx || res.outcome === "not_found") return { ok: false, message: "That item no longer exists.", nextDue: null, outcome: "not_found" };
    const verb = tx.direction === "PAY" ? "paid" : "received";
    const nextDue = tx.status === "PENDING" ? tx.dueDate : null;
    switch (res.outcome) {
      case "settled":
        return {
          ok: true,
          outcome: "settled",
          nextDue,
          message: nextDue ? `${tx.title} marked as ${verb} ✓ Next due ${formatDate(tx.dueDate, settledOn)}` : `${tx.title} marked as ${verb} ✓`,
        };
      case "already_settled":
        return { ok: true, outcome: "already_settled", nextDue, message: `${tx.title} was already marked as ${verb}. Nothing changed.` };
      case "archived":
        return { ok: false, outcome: "archived", nextDue: null, message: `${tx.title} was deleted, so it can't be marked as ${verb}.` };
      case "paused":
        return { ok: false, outcome: "paused", nextDue: null, message: `${tx.title} is paused. Resume it first.` };
      default:
        return { ok: false, outcome: "changed", nextDue: null, message: `${tx.title} changed since this page loaded. Refresh and try again.` };
    }
  } catch (e) {
    logError("transaction.settle", e, { requestId: g.requestId, userId: g.user.id });
    return { ok: false, message: GENERIC_ERROR, nextDue: null, outcome: "error" };
  }
}

export async function archiveAction(id: unknown): Promise<{ ok: boolean }> {
  const g = await gate("transaction.archive", "tx.write");
  if (g.blocked || typeof id !== "string") return { ok: false };
  try {
    const ok = await repo.archiveTransaction(g.user.id, id);
    finish(g, ok ? "archived" : "not_found");
    return { ok };
  } catch (e) {
    logError("transaction.archive", e, { requestId: g.requestId, userId: g.user.id });
    return { ok: false };
  }
}

export async function restoreAction(id: unknown): Promise<{ ok: boolean }> {
  const g = await gate("transaction.restore", "tx.write");
  if (g.blocked || typeof id !== "string") return { ok: false };
  try {
    const ok = await repo.restoreTransaction(g.user.id, id);
    finish(g, ok ? "restored" : "not_found");
    return { ok };
  } catch (e) {
    logError("transaction.restore", e, { requestId: g.requestId, userId: g.user.id });
    return { ok: false };
  }
}

export async function pauseAction(id: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("transaction.pause", "tx.write");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof id !== "string") return { ok: false, message: "That item couldn't be paused." };
  try {
    const ok = await repo.pauseTransaction(g.user.id, id);
    finish(g, ok ? "paused" : "not_pausable");
    if (ok) revalidatePath("/", "layout");
    return ok ? { ok, message: "Paused. It won't show as due until you resume it." } : { ok, message: "Only active recurring items can be paused." };
  } catch (e) {
    logError("transaction.pause", e, { requestId: g.requestId, userId: g.user.id });
    return { ok: false, message: GENERIC_ERROR };
  }
}

export async function resumeAction(id: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("transaction.resume", "tx.write");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof id !== "string") return { ok: false, message: "That item couldn't be resumed." };
  try {
    const today = await getToday();
    const due = await repo.resumeTransaction(g.user.id, id, today);
    finish(g, "resumed");
    revalidatePath("/", "layout");
    return { ok: true, message: `Resumed. Next due ${formatDate(due, today)}.` };
  } catch (e) {
    logError("transaction.resume", e, { requestId: g.requestId, userId: g.user.id });
    if (e instanceof UserError) return { ok: false, message: e.message };
    return { ok: false, message: GENERIC_ERROR };
  }
}
