// Business handlers: what each normalised event does to the user's data.
//
// They only use the existing repositories and collections, and every write
// takes the processor's session, so a handler's writes, the event's
// PROCESSED marker and the audit entry commit together or not at all.
// Natural keys (requestId `evt:<eventId>`, unique attempt numbers, unique
// external request ids) make a re-run after a rollback land on the same
// records instead of creating new ones.
//
// A UserError means "this event can't be applied" (permanent failure, no
// automatic retry). Any other error is treated as transient.

import "server-only";
import { ObjectId, type ClientSession } from "mongodb";
import { canResolveAttempt, nextAttempt } from "@/lib/integrations/rules";
import { PROVIDERS, type NormalizedEvent } from "@/lib/integrations/types";
import { findCategory, type ISODate } from "@/lib/types";
import { UserError } from "../errors";
import { addInvTxn, findOrCreateImportedHolding } from "../investments-repo";
import { attemptsCollection, eventsCollection, invTxnsCollection, mandatesCollection, paymentRequestsCollection, type IntegrationEventDoc } from "../models";
import { archiveTransaction, createTransaction, getTransactionDoc, recordSettledTransaction, settleOccurrence } from "../repository";

export interface HandlerContext {
  userId: string;
  event: IntegrationEventDoc;
  normalized: NormalizedEvent;
  today: ISODate;
  session: ClientSession | undefined;
}

export interface HandlerResult {
  outcome: { code: string; message: string };
  linked: IntegrationEventDoc["linked"];
  paymentStatus?: IntegrationEventDoc["paymentStatus"];
}

type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

const providerName = (ctx: HandlerContext) => PROVIDERS[ctx.normalized.provider].name;

function categoryFor(hint: string | null, direction: "PAY" | "RECEIVE"): string {
  const c = hint ? findCategory(hint) : undefined;
  return c && c.direction === direction ? c.id : `${direction}:Other`;
}

// ---- UPI payments ----

const payment: Handler = async (ctx) => {
  const d = ctx.normalized.data;
  if (d.kind !== "payment") throw new UserError("Unexpected payload for a payment event.");
  const amount = ctx.normalized.amountPaise!;
  const direction = d.flow === "debit" ? "PAY" : "RECEIVE";
  const title = d.flow === "debit" ? `UPI to ${d.counterpartyName}` : `UPI from ${d.counterpartyName}`;

  if (d.status === "FAILED") {
    return {
      outcome: { code: "payment_failed", message: `${providerName(ctx)} reported this payment as failed. No transaction was recorded.` },
      linked: null,
      paymentStatus: "FAILED",
    };
  }

  const input = {
    direction,
    title,
    amount,
    categoryId: categoryFor(d.categoryHint, direction),
    dueDate: ctx.today,
    counterparty: d.counterpartyVpa ? `${d.counterpartyName} (${d.counterpartyVpa})` : d.counterpartyName,
    notes: [d.note, `Simulated via ${providerName(ctx)} · ref ${d.paymentRef}`].filter(Boolean).join(" · "),
  } as const;
  const source = { kind: "integration" as const, provider: ctx.normalized.provider, eventId: ctx.event._id };
  const requestId = `evt:${ctx.event._id.toHexString()}`;

  if (d.status === "SUCCESS") {
    const id = await recordSettledTransaction(ctx.userId, input, { requestId, settledOn: ctx.today, source, session: ctx.session });
    return {
      outcome: { code: "transaction_recorded", message: `Recorded as a ${direction === "PAY" ? "paid" : "received"} transaction.` },
      linked: { kind: "transaction", id },
      paymentStatus: "SUCCESS",
    };
  }
  // PENDING: an open item that a later status update settles or cancels.
  const id = await createTransaction(
    ctx.userId,
    { ...input, frequency: "ONE_TIME", startDate: ctx.today, endDate: null },
    { requestId, source, session: ctx.session },
  );
  return {
    outcome: { code: "pending_transaction_created", message: "Payment pending at the provider. Added as a pending item until a status update arrives." },
    linked: { kind: "transaction", id },
    paymentStatus: "PENDING",
  };
};

const paymentStatus: Handler = async (ctx) => {
  const d = ctx.normalized.data;
  if (d.kind !== "payment_status") throw new UserError("Unexpected payload for a status update.");
  const original = await eventsCollection().findOne(
    {
      userId: ctx.userId,
      provider: ctx.normalized.provider,
      eventType: { $in: ["payment.debit", "payment.credit"] },
      "normalizedPayload.data.paymentRef": d.paymentRef,
      status: "PROCESSED",
    },
    { session: ctx.session },
  );
  if (!original) throw new UserError(`No processed payment with reference ${d.paymentRef}.`);
  const linked = original.linked;

  if (original.paymentStatus !== "PENDING") {
    if (original.paymentStatus === d.status) {
      return { outcome: { code: "no_change", message: `Payment was already ${d.status}. Nothing changed.` }, linked, paymentStatus: d.status };
    }
    throw new UserError(`Payment is already final (${original.paymentStatus}); a ${d.status} update can't change it.`);
  }
  if (d.status === "PENDING") return { outcome: { code: "no_change", message: "Still pending." }, linked, paymentStatus: "PENDING" };
  if (!linked || linked.kind !== "transaction") throw new UserError("The pending payment has no linked transaction.");

  const txId = new ObjectId(linked.id);
  const tx = await getTransactionDoc(ctx.userId, txId, { session: ctx.session });
  if (!tx) throw new UserError("The pending payment's transaction no longer exists.");
  let outcome: HandlerResult["outcome"];
  if (d.status === "SUCCESS") {
    const r = await settleOccurrence(ctx.userId, linked.id, tx.dueDate, ctx.today, { session: ctx.session });
    if (r.outcome !== "settled" && r.outcome !== "already_settled") throw new UserError(`Couldn't settle the pending payment (${r.outcome}).`);
    outcome = { code: "pending_payment_settled", message: "Provider confirmed the payment. The pending item is now settled." };
  } else {
    await archiveTransaction(ctx.userId, linked.id, { session: ctx.session });
    outcome = { code: "pending_payment_cancelled", message: "Provider reported the payment failed. The pending item was removed." };
  }
  await eventsCollection().updateOne({ _id: original._id, userId: ctx.userId }, { $set: { paymentStatus: d.status } }, { session: ctx.session });
  return { outcome, linked, paymentStatus: d.status };
};

// ---- Payment requests ----

const paymentRequest: Handler = async (ctx) => {
  const d = ctx.normalized.data;
  if (d.kind !== "payment_request") throw new UserError("Unexpected payload for a payment request.");
  const col = paymentRequestsCollection();
  const key = { userId: ctx.userId, provider: ctx.normalized.provider, externalRequestId: d.requestRef };
  const existing = await col.findOne(key, { session: ctx.session });
  if (existing) {
    return { outcome: { code: "request_already_received", message: "This request was already received." }, linked: { kind: "paymentRequest", id: existing._id.toHexString() } };
  }
  const now = new Date();
  const res = await col.insertOne(
    {
      _id: new ObjectId(),
      ...key,
      eventId: ctx.event._id,
      contactName: d.contactName,
      contactVpa: d.contactVpa,
      amountPaise: ctx.normalized.amountPaise!,
      message: d.message,
      status: "PENDING",
      transactionId: null,
      history: [{ status: "PENDING", at: now, requestId: null }],
      createdAt: now,
      decidedAt: null,
    },
    { session: ctx.session },
  );
  return {
    outcome: { code: "request_received", message: `${d.contactName} requested a payment. Waiting for you to accept or reject it.` },
    linked: { kind: "paymentRequest", id: res.insertedId.toHexString() },
  };
};

// ---- Autopay ----

const mandateAttempt: Handler = async (ctx) => {
  const d = ctx.normalized.data;
  if (d.kind !== "mandate_attempt") throw new UserError("Unexpected payload for an autopay attempt.");
  const mandateId = new ObjectId(d.mandateRef);
  const mandate = await mandatesCollection().findOne({ _id: mandateId, userId: ctx.userId }, { session: ctx.session });
  if (!mandate) throw new UserError("Unknown mandate.");
  if (mandate.amountPaise !== ctx.normalized.amountPaise) throw new UserError("Debit amount doesn't match the mandate.");

  const attempts = await attemptsCollection()
    .find({ userId: ctx.userId, mandateId, dueDate: d.dueDate }, { session: ctx.session })
    .sort({ attemptNo: 1 })
    .toArray();

  if (d.update) {
    const attempt = attempts.find((a) => a.attemptNo === d.attemptNo);
    if (!attempt) throw new UserError(`No attempt #${d.attemptNo} for ${d.dueDate}.`);
    if (!canResolveAttempt(attempt.status)) {
      if (attempt.status === d.status) return { outcome: { code: "no_change", message: `Attempt was already ${d.status}.` }, linked: { kind: "mandateAttempt", id: attempt._id.toHexString() } };
      throw new UserError(`Attempt #${d.attemptNo} is already ${attempt.status}.`);
    }
    if (d.status === "SUCCESS") await settleMandateOccurrence(ctx, mandate.transactionId, d.dueDate);
    const res = await attemptsCollection().updateOne(
      { _id: attempt._id, userId: ctx.userId, status: "PENDING" },
      { $set: { status: d.status, failureReason: d.failureReason, resolvedAt: new Date() } },
      { session: ctx.session },
    );
    if (res.matchedCount !== 1) throw new UserError("The attempt changed while updating.");
    return {
      outcome:
        d.status === "SUCCESS"
          ? { code: "debit_succeeded", message: `Pending debit for ${d.dueDate} confirmed. The occurrence is marked paid.` }
          : { code: "debit_failed", message: `Pending debit for ${d.dueDate} failed: ${d.failureReason}.` },
      linked: { kind: "mandateAttempt", id: attempt._id.toHexString() },
      paymentStatus: d.status,
    };
  }

  if (mandate.status !== "ACTIVE") throw new UserError(`The mandate is ${mandate.status.toLowerCase()}, so the debit was refused.`);
  const tx = await getTransactionDoc(ctx.userId, mandate.transactionId, { session: ctx.session });
  if (!tx || tx.archivedAt) throw new UserError("The mandate's payment item no longer exists.");
  if (tx.status !== "PENDING" || tx.dueDate !== d.dueDate) {
    throw new UserError(`The mandate's next due date is ${tx.status === "PENDING" ? tx.dueDate : "none (completed)"}, so a debit for ${d.dueDate} was refused.`);
  }
  const next = nextAttempt(attempts);
  if (!next.ok) {
    const why = { already_paid: "this occurrence is already paid", pending: "an attempt is still pending", exhausted: "the maximum number of attempts was reached" }[next.reason];
    throw new UserError(`Debit refused: ${why}.`);
  }
  if (next.attemptNo !== d.attemptNo) throw new UserError(`Expected attempt #${next.attemptNo}, got #${d.attemptNo}.`);

  if (d.status === "SUCCESS") await settleMandateOccurrence(ctx, mandate.transactionId, d.dueDate);
  const res = await attemptsCollection().insertOne(
    {
      _id: new ObjectId(),
      userId: ctx.userId,
      mandateId,
      dueDate: d.dueDate,
      attemptNo: d.attemptNo,
      status: d.status,
      eventId: ctx.event._id,
      failureReason: d.failureReason,
      createdAt: new Date(),
      resolvedAt: d.status === "PENDING" ? null : new Date(),
    },
    { session: ctx.session },
  );
  const message = {
    SUCCESS: `Debit for ${d.dueDate} succeeded. The occurrence is marked paid.`,
    PENDING: `Debit for ${d.dueDate} is pending at the bank (simulated).`,
    FAILED: `Debit for ${d.dueDate} failed: ${d.failureReason}. It can be retried.`,
  }[d.status];
  return {
    outcome: { code: { SUCCESS: "debit_succeeded", PENDING: "debit_pending", FAILED: "debit_failed" }[d.status], message },
    linked: { kind: "mandateAttempt", id: res.insertedId.toHexString() },
    paymentStatus: d.status,
  };
};

async function settleMandateOccurrence(ctx: HandlerContext, txId: ObjectId, dueDate: ISODate) {
  const r = await settleOccurrence(ctx.userId, txId.toHexString(), dueDate, ctx.today, { session: ctx.session });
  if (r.outcome !== "settled") throw new UserError(`The ${dueDate} occurrence couldn't be marked paid (${r.outcome.replace("_", " ")}).`);
}

// ---- Investments ----

const trade: Handler = async (ctx) => {
  const d = ctx.normalized.data;
  if (d.kind !== "trade") throw new UserError("Unexpected payload for a trade.");
  if (d.tradeDate > ctx.today) throw new UserError("Trade date is in the future.");
  const holdingId = await findOrCreateImportedHolding(ctx.userId, `groww_sim:${d.symbol}`, { type: d.assetType, name: d.name, symbol: d.symbol }, ctx.session);
  const requestId = `evt:${ctx.event._id.toHexString()}`;
  const r = await addInvTxn(
    ctx.userId,
    holdingId,
    {
      type: d.side,
      date: d.tradeDate,
      qtyMicro: d.qtyMicro,
      price4: d.price4,
      amountPaise: ctx.normalized.amountPaise!,
      feePaise: d.feePaise,
      sipFor: d.side === "BUY" ? d.sipFor : null,
      note: `Groww Simulator order ${d.orderId}`,
    },
    requestId,
    ctx.session,
  );
  const recorded = await invTxnsCollection().findOne({ userId: ctx.userId, requestId }, { session: ctx.session, projection: { _id: 1 } });
  return {
    outcome:
      r === "added"
        ? { code: "trade_recorded", message: `${d.side === "BUY" ? "Purchase" : "Sale"} of ${d.symbol} recorded in your investments.` }
        : { code: "trade_already_recorded", message: recorded ? "This trade was already recorded." : `A SIP instalment for ${d.sipFor} is already recorded for ${d.symbol}.` },
    linked: { kind: "holding", id: holdingId },
  };
};

const HANDLERS: Record<NormalizedEvent["eventType"], Handler> = {
  "payment.debit": payment,
  "payment.credit": payment,
  "payment.status_update": paymentStatus,
  "payment_request.created": paymentRequest,
  "mandate.debit_attempt": mandateAttempt,
  "mandate.attempt_update": mandateAttempt,
  "investment.trade": trade,
};

export function handlerFor(type: NormalizedEvent["eventType"]): Handler {
  return HANDLERS[type];
}
