"use server";

// Server actions for the investment tracker.
// Same contract as actions.ts: requireUser() first, validate, user-scoped repo.

import { revalidatePath } from "next/cache";
import { formatDate } from "@/lib/dates";
import { unitPrice4, valuePaise } from "@/lib/decimal";
import { holdingSchema, invTxnSchema, manualPriceSchema } from "@/lib/finance-validation";
import { formatINR } from "@/lib/money";
import type { SipStatus } from "@/lib/portfolio";
import { formGetter, GENERIC_ERROR, requestIdFrom, toFieldErrors, type FormState } from "./form";
import * as inv from "./investments-repo";
import { searchAmfi, type AmfiScheme } from "./prices";
import { UserError } from "./repository";
import { getToday, requireUser } from "./session";

function fail(e: unknown, where: string): FormState {
  if (e instanceof UserError) return { message: e.message };
  console.error(`[${where}]`, e);
  return { message: GENERIC_ERROR };
}

export async function saveHoldingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = holdingSchema.safeParse({
    type: get("type"),
    name: get("name"),
    symbol: get("symbol"),
    schemeCode: get("schemeCode"),
    notes: get("notes"),
    sipAmount: get("sipAmount"),
    sipFrequency: get("sipFrequency") || undefined,
    sipStart: get("sipStart"),
    sipEnd: get("sipEnd"),
    karat: get("karat") || undefined,
    spread: get("spread"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const id = get("id");
  const isMf = d.type === "MF";
  const marketSymbol = d.type === "STOCK" || d.type === "ETF" ? d.symbol : null;
  const input: inv.HoldingInput = {
    type: d.type,
    name: d.name,
    symbol: isMf ? null : d.symbol,
    provider: isMf && d.schemeCode ? "AMFI" : marketSymbol ? "ALPHAVANTAGE" : null,
    providerKey: isMf ? d.schemeCode : marketSymbol,
    sip:
      (d.type === "MF" || d.type === "ETF" || d.type === "STOCK") && d.sipAmount > 0 && d.sipStart
        ? {
            amountPaise: d.sipAmount,
            frequency: d.sipFrequency ?? "MONTHLY",
            anchorDate: d.sipStart,
            endDate: d.sipEnd,
            status: (get("sipStatus") as SipStatus) === "PAUSED" || get("sipStatus") === "STOPPED" ? (get("sipStatus") as SipStatus) : "ACTIVE",
          }
        : null,
    gold: d.type === "GOLD" ? { karat: d.karat ?? 24, sellSpreadBps: d.spread ?? 0 } : null,
    notes: d.notes,
  };
  try {
    if (id) {
      // The asset type is fixed once created (it decides how the holding is valued).
      const { name, symbol, provider, providerKey, sip, gold, notes } = input;
      await inv.updateHolding(user.id, id, { name, symbol, provider, providerKey, sip, gold, notes });
      revalidatePath("/", "layout");
      return { ok: true, message: `${d.name} saved.`, redirectTo: `/investments/${id}` };
    }
    const newId = await inv.createHolding(user.id, input, requestIdFrom(formData));
    revalidatePath("/", "layout");
    return { ok: true, message: `${d.name} added. Now record what you've bought.`, redirectTo: `/investments/${newId}` };
  } catch (e) {
    return fail(e, "saveHolding");
  }
}

export async function invTxnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = invTxnSchema.safeParse({
    type: get("type"),
    date: get("date"),
    amount: get("amount"),
    qty: get("qty"),
    price: get("price"),
    fee: get("fee"),
    sipFor: get("sipFor"),
    note: get("note"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const today = await getToday();
  if (d.date > today) return { errors: { date: "Record transactions once they've happened." } };

  // Fill in whichever of amount / quantity / price wasn't entered.
  let amount = d.amount;
  let qty = d.type === "DIVIDEND" ? null : d.qty;
  let price = d.type === "DIVIDEND" ? null : d.price;
  if (d.type !== "DIVIDEND") {
    if (!amount && qty && price) amount = valuePaise(qty, price);
    else if (amount && qty && !price) price = unitPrice4(amount, qty);
    else if (amount && !qty) {
      qty = null;
      price = null;
    }
  }
  if (!amount) return { errors: { amount: "Enter the amount" } };

  try {
    const r = await inv.addInvTxn(
      user.id,
      get("holdingId") ?? "",
      { type: d.type, date: d.date, qtyMicro: qty, price4: price, amountPaise: amount, feePaise: d.fee, sipFor: d.type === "BUY" ? d.sipFor : null, note: d.note },
      requestIdFrom(formData),
    );
    revalidatePath("/", "layout");
    if (r === "duplicate") return { ok: true, message: d.sipFor ? `The ${formatDate(d.sipFor)} SIP is already recorded.` : "Already recorded." };
    const verb = d.type === "BUY" ? "Purchase" : d.type === "SELL" ? "Sale" : "Dividend";
    return { ok: true, message: `${verb} of ${formatINR(amount)} recorded.` };
  } catch (e) {
    return fail(e, "invTxn");
  }
}

export async function manualPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const get = formGetter(formData);
  const parsed = manualPriceSchema.safeParse({ price: get("price"), asOf: get("asOf") });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  if (parsed.data.asOf > (await getToday())) return { errors: { asOf: "Use today or an earlier date." } };
  if (parsed.data.price === null) return { errors: { price: "Enter a price" } };
  try {
    const ok = await inv.setManualPrice(user.id, get("holdingId") ?? "", parsed.data.price, parsed.data.asOf);
    if (!ok) return { message: "This investment no longer exists." };
    revalidatePath("/", "layout");
    return { ok: true, message: "Price saved." };
  } catch (e) {
    return fail(e, "manualPrice");
  }
}

export async function sipStatusAction(id: unknown, status: unknown): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  if (typeof id !== "string" || (status !== "ACTIVE" && status !== "PAUSED" && status !== "STOPPED")) return { ok: false };
  try {
    const ok = await inv.setSipStatus(user.id, id, status);
    revalidatePath("/", "layout");
    return { ok, message: { ACTIVE: "SIP resumed.", PAUSED: "SIP paused.", STOPPED: "SIP marked as stopped." }[status] };
  } catch (e) {
    console.error("[sipStatus]", e);
    return { ok: false };
  }
}

export async function archiveHoldingAction(id: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false };
  try {
    const ok = await inv.setHoldingArchived(user.id, id, true);
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    console.error("[archiveHolding]", e);
    return { ok: false };
  }
}

export async function deleteInvTxnAction(id: unknown): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  if (typeof id !== "string") return { ok: false };
  try {
    const ok = await inv.deleteInvTxn(user.id, id);
    revalidatePath("/", "layout");
    return { ok, message: ok ? "Transaction removed." : "That transaction no longer exists." };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    console.error("[deleteInvTxn]", e);
    return { ok: false };
  }
}

/** AMFI scheme search for the add-fund form. Null when AMFI can't be reached. */
export async function searchSchemesAction(query: unknown): Promise<AmfiScheme[] | null> {
  await requireUser();
  if (typeof query !== "string" || query.length > 80) return [];
  return searchAmfi(query, 15);
}
