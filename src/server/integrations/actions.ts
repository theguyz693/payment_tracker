"use server";

// Server actions for the Financial Integrations Hub. Same contract as every
// other action: gate() (session + rate limit), validate with Zod, then call
// user-scoped code. Simulators never write data directly — they deliver a
// signed provider payload to the common pipeline.

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { isIdempotencyKey, nextAttempt } from "@/lib/integrations/rules";
import { isProviderId, type PaymentStatus } from "@/lib/integrations/types";
import { mandateSchema, requestSimSchema, tradeSimSchema, upiSimSchema } from "@/lib/integrations/validation";
import { findCategory } from "@/lib/types";
import { UserError } from "../errors";
import { formGetter, GENERIC_ERROR, requestIdFrom, toFieldErrors, type FormState } from "../form";
import { finish, gate } from "../guard";
import { logError } from "../log";
import { attemptsCollection, eventsCollection, mandatesCollection } from "../models";
import { getRawBody, toEventRow, type EventRow } from "./queries";
import { createMandate, decidePaymentRequest, requireConnection, setConnection, setMandateStatus } from "./operations";
import { processDueRetries, processEvent, recoverStuckEvents, type DeliveryResult } from "./pipeline";
import { buildMandateDebit, buildRequest, buildTrade, buildUpi, buildUpiStatus, deliver, deliverBody } from "./simulator";
import { getTransactionDoc } from "../repository";
import { getToday } from "../session";

/** What the simulator panels show after a delivery. */
export interface SimState extends FormState {
  result?: {
    kind: "accepted" | "rejected";
    duplicate?: boolean;
    httpStatus: number;
    event?: EventRow;
    reason?: string;
    issues?: string[];
  };
}

function toSimState(r: DeliveryResult, okMessage: string): SimState {
  if (r.kind === "rejected") {
    return { message: `${r.message}${r.issues?.length ? ` (${r.issues.join("; ")})` : ""}`, result: { kind: "rejected", httpStatus: r.httpStatus, reason: r.reason, issues: r.issues } };
  }
  const event = toEventRow(r.event);
  const msg = r.duplicate
    ? `Duplicate delivery of ${event.externalEventId}: blocked, nothing processed again.`
    : event.status === "PROCESSED"
      ? `${okMessage} ${event.outcome?.message ?? ""}`.trim()
      : event.status === "RETRY_PENDING"
        ? `Processing failed: ${(event.lastError?.message ?? "transient error").replace(/\.$/, "")}. A retry is scheduled.`
        : event.status === "FAILED"
          ? `Event rejected by business rules: ${event.lastError?.message ?? "failed"}.`
          : `Event is ${event.status.toLowerCase()}.`;
  return { ok: true, message: msg, result: { kind: "accepted", duplicate: r.duplicate, httpStatus: r.httpStatus, event } };
}

function failState(e: unknown, op: string, userId: string): SimState {
  logError(op, e, { userId });
  return { message: e instanceof UserError ? e.message : GENERIC_ERROR };
}

const refresh = () => revalidatePath("/integrations", "layout");

// ---- Connections ----

export async function connectProviderAction(provider: unknown, connected: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.connect", "mandate.config");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (!isProviderId(provider) || typeof connected !== "boolean") return { ok: false, message: "Unknown provider." };
  try {
    await setConnection(g.user.id, provider, connected);
    finish(g, connected ? "connected" : "disconnected", { provider });
    refresh();
    return { ok: true, message: connected ? "Demo account connected." : "Demo account disconnected." };
  } catch (e) {
    logError("integration.connect", e, { userId: g.user.id });
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ---- UPI simulator ----

export async function simulateUpiAction(_prev: SimState, formData: FormData): Promise<SimState> {
  const g = await gate("integration.simulate_upi", "integration.simulate");
  if (g.blocked) return { message: g.blocked };
  const get = formGetter(formData);
  const parsed = upiSimSchema.safeParse({
    provider: get("provider"),
    flow: get("flow"),
    name: get("name") ?? "",
    vpa: get("vpa"),
    amount: get("amount") ?? "",
    note: get("note"),
    categoryId: get("categoryId"),
    outcome: get("outcome"),
    failFirstAttempts: get("failFirstAttempts"),
    simulateCrash: get("simulateCrash"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const direction = d.flow === "debit" ? "PAY" : "RECEIVE";
  const category = d.categoryId && findCategory(d.categoryId)?.direction === direction ? d.categoryId : null;
  try {
    const conn = await requireConnection(g.user.id, d.provider);
    const payload = buildUpi(
      d.provider,
      conn.accountRef,
      { flow: d.flow, name: d.name, vpa: d.vpa, amountPaise: d.amount, note: d.note, category, status: d.outcome },
      { failFirstAttempts: d.failFirstAttempts, simulateCrash: d.simulateCrash },
    );
    const r = await deliver(d.provider, payload, { userId: g.user.id, today: await getToday(), requestId: g.requestId });
    finish(g, r.kind === "accepted" ? r.event.status : r.reason);
    refresh();
    return toSimState(r, d.flow === "debit" ? "Simulated payment processed." : "Simulated incoming payment processed.");
  } catch (e) {
    return failState(e, "integration.simulate_upi", g.user.id);
  }
}

/** Send the provider's final status for a PENDING simulated payment. */
export async function resolvePaymentAction(eventId: unknown, status: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.resolve_payment", "integration.simulate");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof eventId !== "string" || !/^[a-f\d]{24}$/i.test(eventId) || (status !== "SUCCESS" && status !== "FAILED")) return { ok: false, message: "Invalid request." };
  try {
    const original = await eventsCollection().findOne({ _id: new ObjectId(eventId), userId: g.user.id });
    if (!original || (original.provider !== "gpay_sim" && original.provider !== "phonepe_sim")) return { ok: false, message: "Payment not found." };
    const ref = (original.normalizedPayload as { data?: { paymentRef?: string } }).data?.paymentRef;
    if (!ref) return { ok: false, message: "Payment not found." };
    const conn = await requireConnection(g.user.id, original.provider);
    const r = await deliver(original.provider, buildUpiStatus(original.provider, conn.accountRef, ref, status), { userId: g.user.id, today: await getToday(), requestId: g.requestId });
    finish(g, r.kind === "accepted" ? r.event.status : r.reason);
    refresh();
    revalidatePath("/", "layout");
    const s = toSimState(r, "Status update processed.");
    return { ok: !!s.ok, message: s.message ?? "" };
  } catch (e) {
    const s = failState(e, "integration.resolve_payment", g.user.id);
    return { ok: false, message: s.message ?? GENERIC_ERROR };
  }
}

// ---- Payment requests ----

export async function simulateRequestAction(_prev: SimState, formData: FormData): Promise<SimState> {
  const g = await gate("integration.simulate_request", "integration.simulate");
  if (g.blocked) return { message: g.blocked };
  const get = formGetter(formData);
  const parsed = requestSimSchema.safeParse({ name: get("name") ?? "", vpa: get("vpa"), amount: get("amount") ?? "", message: get("message") });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  try {
    const conn = await requireConnection(g.user.id, "requests_sim");
    const r = await deliver("requests_sim", buildRequest(conn.accountRef, { name: parsed.data.name, vpa: parsed.data.vpa, amountPaise: parsed.data.amount, message: parsed.data.message }), {
      userId: g.user.id,
      today: await getToday(),
      requestId: g.requestId,
    });
    finish(g, r.kind === "accepted" ? r.event.status : r.reason);
    refresh();
    return toSimState(r, "Request delivered.");
  } catch (e) {
    return failState(e, "integration.simulate_request", g.user.id);
  }
}

export async function decideRequestAction(id: unknown, decision: unknown, key: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.decide_request", "request.decide");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof id !== "string" || (decision !== "ACCEPT" && decision !== "REJECT") || !isIdempotencyKey(key)) return { ok: false, message: "Invalid request." };
  try {
    const { result, replayed } = await decidePaymentRequest(g.user.id, id, decision, key, await getToday());
    finish(g, replayed ? "replayed" : String(result.status));
    refresh();
    revalidatePath("/", "layout");
    if (replayed || result.repeated) return { ok: true, message: `Already ${String(result.status).toLowerCase()}. Nothing changed.` };
    return { ok: true, message: decision === "ACCEPT" ? "Accepted. The payment was recorded (simulated)." : "Rejected. No payment was recorded." };
  } catch (e) {
    logError("integration.decide_request", e, { userId: g.user.id, requestId: g.requestId });
    return { ok: false, message: e instanceof UserError ? e.message : GENERIC_ERROR };
  }
}

// ---- Autopay ----

export async function createMandateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const g = await gate("integration.create_mandate", "mandate.config");
  if (g.blocked) return { message: g.blocked };
  const get = formGetter(formData);
  const parsed = mandateSchema.safeParse({
    name: get("name") ?? "",
    payeeName: get("payeeName") ?? "",
    provider: get("provider"),
    amount: get("amount") ?? "",
    frequency: get("frequency"),
    startDate: get("startDate") ?? "",
    endDate: get("endDate"),
    categoryId: get("categoryId") ?? "PAY:Subscription",
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const cat = findCategory(d.categoryId);
  if (!cat || cat.direction !== "PAY") return { errors: { categoryId: "Choose a payment category" } };
  try {
    await requireConnection(g.user.id, "autopay_sim");
    const id = await createMandate(
      g.user.id,
      { name: d.name, payeeName: d.payeeName, provider: d.provider, amountPaise: d.amount, frequency: d.frequency as Exclude<typeof d.frequency, "ONE_TIME">, startDate: d.startDate, endDate: d.endDate, categoryId: d.categoryId },
      requestIdFrom(formData),
    );
    finish(g, "created", { mandateId: id });
    refresh();
    revalidatePath("/", "layout");
    return { ok: true, message: `Mandate "${d.name}" created.`, redirectTo: `/integrations/autopay/${id}` };
  } catch (e) {
    return failState(e, "integration.create_mandate", g.user.id);
  }
}

export async function mandateStatusAction(id: unknown, status: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.mandate_status", "mandate.config");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof id !== "string" || (status !== "ACTIVE" && status !== "PAUSED" && status !== "CANCELLED")) return { ok: false, message: "Invalid request." };
  try {
    await setMandateStatus(g.user.id, id, status, await getToday());
    finish(g, status);
    refresh();
    revalidatePath("/", "layout");
    return { ok: true, message: { ACTIVE: "Mandate resumed.", PAUSED: "Mandate paused.", CANCELLED: "Mandate cancelled." }[status] };
  } catch (e) {
    logError("integration.mandate_status", e, { userId: g.user.id });
    return { ok: false, message: e instanceof UserError ? e.message : GENERIC_ERROR };
  }
}

/** Simulate the provider attempting the mandate's current due debit with a chosen outcome. */
export async function runMandateAttemptAction(_prev: SimState, formData: FormData): Promise<SimState> {
  const g = await gate("integration.mandate_attempt", "integration.simulate");
  if (g.blocked) return { message: g.blocked };
  const get = formGetter(formData);
  const id = get("mandateId") ?? "";
  const outcome = get("outcome") as PaymentStatus;
  const repeat = get("repeat") === "1";
  if (!/^[a-f\d]{24}$/i.test(id) || !["SUCCESS", "PENDING", "FAILED"].includes(outcome)) return { message: "Invalid request." };
  try {
    const mandate = await mandatesCollection().findOne({ _id: new ObjectId(id), userId: g.user.id });
    if (!mandate) return { message: "That mandate no longer exists." };
    const conn = await requireConnection(g.user.id, "autopay_sim");
    let payload;
    if (repeat) {
      // Re-deliver the most recent attempt exactly as the provider sent it: same
      // identity and contents, so the pipeline must treat it as a duplicate.
      const last = await attemptsCollection().find({ userId: g.user.id, mandateId: mandate._id }).sort({ createdAt: -1 }).limit(1).next();
      if (!last) return { message: "There's no previous attempt to re-send yet." };
      const ev = await eventsCollection().findOne({ _id: last.eventId, userId: g.user.id }, { projection: { rawBody: 1, provider: 1 } });
      if (!ev) return { message: "The previous attempt's event is no longer available." };
      const r = await deliverBody("autopay_sim", ev.rawBody, { userId: g.user.id, today: await getToday(), requestId: g.requestId });
      finish(g, r.kind === "accepted" ? (r.duplicate ? "duplicate" : r.event.status) : r.reason);
      refresh();
      return toSimState(r, "Debit attempt processed.");
    } else {
      const tx = await getTransactionDoc(g.user.id, mandate.transactionId);
      if (!tx || tx.status !== "PENDING") return { message: "This mandate has no occurrence left to debit." };
      const attempts = await attemptsCollection().find({ userId: g.user.id, mandateId: mandate._id, dueDate: tx.dueDate }).toArray();
      const next = nextAttempt(attempts);
      const attemptNo = next.ok ? next.attemptNo : attempts.reduce((m, a) => Math.max(m, a.attemptNo), 0) + 1;
      payload = buildMandateDebit(conn.accountRef, { mandateId: id, dueDate: tx.dueDate, attemptNo, amountPaise: mandate.amountPaise, result: outcome }, { failFirstAttempts: Number(get("failFirstAttempts")) || 0 });
    }
    const r = await deliver("autopay_sim", payload, { userId: g.user.id, today: await getToday(), requestId: g.requestId });
    finish(g, r.kind === "accepted" ? r.event.status : r.reason);
    refresh();
    revalidatePath("/", "layout");
    return toSimState(r, "Debit attempt processed.");
  } catch (e) {
    return failState(e, "integration.mandate_attempt", g.user.id);
  }
}

/** Resolve a PENDING debit attempt with the bank's final answer. */
export async function resolveAttemptAction(attemptId: unknown, status: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.resolve_attempt", "integration.simulate");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof attemptId !== "string" || !/^[a-f\d]{24}$/i.test(attemptId) || (status !== "SUCCESS" && status !== "FAILED")) return { ok: false, message: "Invalid request." };
  try {
    const a = await attemptsCollection().findOne({ _id: new ObjectId(attemptId), userId: g.user.id });
    if (!a) return { ok: false, message: "Attempt not found." };
    const m = await mandatesCollection().findOne({ _id: a.mandateId, userId: g.user.id });
    if (!m) return { ok: false, message: "Mandate not found." };
    const conn = await requireConnection(g.user.id, "autopay_sim");
    const payload = buildMandateDebit(conn.accountRef, { mandateId: m._id.toHexString(), dueDate: a.dueDate, attemptNo: a.attemptNo, amountPaise: m.amountPaise, result: status, update: true });
    const r = await deliver("autopay_sim", payload, { userId: g.user.id, today: await getToday(), requestId: g.requestId });
    finish(g, r.kind === "accepted" ? r.event.status : r.reason);
    refresh();
    revalidatePath("/", "layout");
    const s = toSimState(r, "Attempt updated.");
    return { ok: !!s.ok, message: s.message ?? "" };
  } catch (e) {
    const s = failState(e, "integration.resolve_attempt", g.user.id);
    return { ok: false, message: s.message ?? GENERIC_ERROR };
  }
}

// ---- Investment import simulator ----

export async function simulateTradeAction(_prev: SimState, formData: FormData): Promise<SimState> {
  const g = await gate("integration.simulate_trade", "integration.simulate");
  if (g.blocked) return { message: g.blocked };
  const get = formGetter(formData);
  const parsed = tradeSimSchema.safeParse({
    symbol: get("symbol") ?? "",
    name: get("name") ?? "",
    segment: get("segment"),
    side: get("side"),
    quantity: get("quantity") ?? "",
    price: get("price") ?? "",
    charges: get("charges"),
    tradeDate: get("tradeDate") ?? "",
    sipDate: get("sipDate"),
    failFirstAttempts: get("failFirstAttempts"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  try {
    const today = await getToday();
    if (d.tradeDate > today) return { errors: { tradeDate: "Imports are for executed trades (today or earlier)." } };
    const conn = await requireConnection(g.user.id, "groww_sim");
    const payload = buildTrade(
      conn.accountRef,
      { symbol: d.symbol.toUpperCase(), name: d.name, segment: d.segment, side: d.side, quantity: d.quantity, price: d.price, charges: d.charges, tradeDate: d.tradeDate, sipDate: d.sipDate },
      { failFirstAttempts: d.failFirstAttempts },
    );
    const r = await deliver("groww_sim", payload, { userId: g.user.id, today, requestId: g.requestId });
    finish(g, r.kind === "accepted" ? r.event.status : r.reason);
    refresh();
    revalidatePath("/", "layout");
    return toSimState(r, "Trade imported.");
  } catch (e) {
    return failState(e, "integration.simulate_trade", g.user.id);
  }
}

// ---- Event console ----

export async function retryEventAction(id: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.retry_event", "event.retry");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) return { ok: false, message: "Invalid event." };
  try {
    await recoverStuckEvents(g.user.id, 10);
    const e = await processEvent(g.user.id, new ObjectId(id), { manual: true, today: await getToday(), requestId: g.requestId });
    finish(g, e?.status ?? "not_found");
    refresh();
    revalidatePath("/", "layout");
    if (!e) return { ok: false, message: "Event not found." };
    if (e.status === "PROCESSED") return { ok: true, message: `Processed on attempt ${e.attemptCount}. ${e.outcome?.message ?? ""}`.trim() };
    if (e.status === "PROCESSING") return { ok: false, message: "This event is being processed right now (its lease hasn't expired yet). Try again in a few seconds." };
    return { ok: false, message: `Still ${e.status.toLowerCase().replace("_", " ")}: ${e.lastError?.message ?? ""}` };
  } catch (e) {
    logError("integration.retry_event", e, { userId: g.user.id });
    return { ok: false, message: GENERIC_ERROR };
  }
}

/** Deliver the exact same payload again: the pipeline must recognise it as a duplicate. */
export async function resendEventAction(id: unknown): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.resend_event", "event.retry");
  if (g.blocked) return { ok: false, message: g.blocked };
  if (typeof id !== "string") return { ok: false, message: "Invalid event." };
  try {
    const raw = await getRawBody(g.user.id, id);
    if (!raw) return { ok: false, message: "Event not found." };
    const r = await deliverBody(raw.provider, raw.body, { userId: g.user.id, today: await getToday(), requestId: g.requestId });
    finish(g, r.kind === "accepted" ? (r.duplicate ? "duplicate" : r.event.status) : r.reason);
    refresh();
    if (r.kind === "accepted" && r.duplicate) return { ok: true, message: `Duplicate detected: delivery #${r.event.duplicateCount + 1} of ${r.event.externalEventId} was blocked. No side effects.` };
    return { ok: false, message: r.kind === "rejected" ? r.message : "The resend was processed as a new event (unexpected)." };
  } catch (e) {
    logError("integration.resend_event", e, { userId: g.user.id });
    return { ok: false, message: GENERIC_ERROR };
  }
}

/** Run the retry worker for this user now: recover abandoned events, then process due retries. */
export async function runWorkerAction(): Promise<{ ok: boolean; message: string }> {
  const g = await gate("integration.run_worker", "event.retry");
  if (g.blocked) return { ok: false, message: g.blocked };
  try {
    const tz = await getToday();
    const recovered = await recoverStuckEvents(g.user.id);
    const processed = await processDueRetries(g.user.id, () => tz);
    finish(g, "ok", { recovered, processed });
    refresh();
    revalidatePath("/", "layout");
    return { ok: true, message: `Recovered ${recovered} stuck event${recovered === 1 ? "" : "s"}; processed ${processed} due retr${processed === 1 ? "y" : "ies"}.` };
  } catch (e) {
    logError("integration.run_worker", e, { userId: g.user.id });
    return { ok: false, message: GENERIC_ERROR };
  }
}

