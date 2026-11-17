// User-initiated operations in the Integrations Hub: demo connections,
// payment-request decisions and autopay mandate setup. Every function takes
// the authenticated user id first and scopes every query by it.

import "server-only";
import { ObjectId } from "mongodb";
import { canDecide, type RequestDecision } from "@/lib/integrations/rules";
import { PROVIDER_IDS, type ProviderId } from "@/lib/integrations/types";
import { findCategory, type Frequency, type ISODate } from "@/lib/types";
import { recordAudit } from "../audit";
import { UserError } from "../errors";
import { withIdempotency } from "../idempotency";
import {
  connectionsCollection,
  isDuplicateKey,
  mandatesCollection,
  paymentRequestsCollection,
  runInTransaction,
  type IntegrationConnectionDoc,
  type MandateStatus,
} from "../models";
import { createTransaction, pauseTransaction, recordSettledTransaction, resumeTransaction } from "../repository";
import { newAccountRef } from "./simulator";

const toObjectId = (id: string) => (/^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null);

// ---- Demo connections ----

export async function listConnections(userId: string): Promise<Record<ProviderId, IntegrationConnectionDoc | null>> {
  const docs = await connectionsCollection().find({ userId }).toArray();
  return Object.fromEntries(PROVIDER_IDS.map((p) => [p, docs.find((d) => d.provider === p) ?? null])) as Record<ProviderId, IntegrationConnectionDoc | null>;
}

/** The user's connected demo account for a provider, or a UserError. */
export async function requireConnection(userId: string, provider: ProviderId): Promise<IntegrationConnectionDoc> {
  const c = await connectionsCollection().findOne({ userId, provider, status: "CONNECTED" });
  if (!c) throw new UserError("Connect this demo provider first.");
  return c;
}

export async function setConnection(userId: string, provider: ProviderId, connected: boolean): Promise<void> {
  const col = connectionsCollection();
  const now = new Date();
  if (!connected) {
    await col.updateOne({ userId, provider }, { $set: { status: "DISCONNECTED", updatedAt: now } });
    return;
  }
  const res = await col.updateOne({ userId, provider }, { $set: { status: "CONNECTED", updatedAt: now } });
  if (res.matchedCount === 1) return;
  try {
    await col.insertOne({ _id: new ObjectId(), userId, provider, accountRef: newAccountRef(provider), status: "CONNECTED", connectedAt: now, updatedAt: now });
  } catch (e) {
    if (!isDuplicateKey(e)) throw e; // a concurrent connect won
  }
  await recordAudit({ userId, action: "connection.connected", entity: { kind: "integrationConnection", id: provider }, summary: `Demo ${provider} account connected.` });
}

// ---- Payment requests ----

/**
 * Accept or reject a pending request. Idempotent per client key, and the
 * state change is guarded (PENDING -> ACCEPTED/REJECTED once), so two tabs
 * or a retried click can never create two payments. Accepting records the
 * payment in the existing transactions collection, in the same transaction.
 */
export async function decidePaymentRequest(userId: string, id: string, decision: RequestDecision, key: string, today: ISODate) {
  const _id = toObjectId(id);
  if (!_id) throw new UserError("That request no longer exists.");
  return withIdempotency({ userId, scope: "payment_request.decide", key, payload: { id, decision } }, async (session) => {
    const col = paymentRequestsCollection();
    const req = await col.findOne({ _id, userId }, { session });
    if (!req) throw new UserError("That request no longer exists.");
    const target = decision === "ACCEPT" ? "ACCEPTED" : "REJECTED";
    if (!canDecide(req.status)) {
      if (req.status === target) return { status: req.status, transactionId: req.transactionId?.toHexString() ?? null, repeated: true };
      throw new UserError(`This request was already ${req.status.toLowerCase()}.`);
    }
    let transactionId: ObjectId | null = null;
    if (decision === "ACCEPT") {
      const txId = await recordSettledTransaction(
        userId,
        {
          direction: "PAY",
          title: `Paid ${req.contactName} (request)`,
          amount: req.amountPaise,
          categoryId: findCategory("PAY:Other")!.id,
          dueDate: today,
          counterparty: req.contactVpa ? `${req.contactName} (${req.contactVpa})` : req.contactName,
          notes: [req.message, "Accepted payment request (simulated)"].filter(Boolean).join(" · "),
        },
        { requestId: `preq:${id}`, settledOn: today, source: { kind: "payment_request", requestId: _id }, session },
      );
      transactionId = new ObjectId(txId);
    }
    const res = await col.updateOne(
      { _id, userId, status: "PENDING" },
      { $set: { status: target, decidedAt: new Date(), transactionId }, $push: { history: { status: target, at: new Date(), requestId: key } } },
      { session },
    );
    if (res.matchedCount !== 1) throw new UserError("This request was decided elsewhere. Refresh to see it.");
    await recordAudit(
      {
        userId,
        action: decision === "ACCEPT" ? "payment_request.accepted" : "payment_request.rejected",
        entity: { kind: "paymentRequest", id },
        summary: `${req.contactName}'s request ${decision === "ACCEPT" ? "accepted and paid" : "rejected"}.`,
        requestId: key,
        eventId: req.eventId,
      },
      session,
    );
    return { status: target, transactionId: transactionId?.toHexString() ?? null, repeated: false };
  });
}

// ---- Autopay mandates ----

export interface MandateInput {
  name: string;
  payeeName: string;
  provider: ProviderId;
  amountPaise: number;
  frequency: Exclude<Frequency, "ONE_TIME">;
  startDate: ISODate;
  endDate: ISODate | null;
  categoryId: string;
}

/**
 * A mandate and its recurring PAY item are created together. Successful
 * debits settle that item's occurrences, so autopay payments live in the
 * same ledger as everything else.
 */
export async function createMandate(userId: string, input: MandateInput, requestId: string): Promise<string> {
  return runInTransaction(async (session) => {
    const prior = await mandatesCollection().findOne({ userId, requestId }, { session, projection: { _id: 1 } });
    if (prior) return prior._id.toHexString();
    const mandateId = new ObjectId();
    const txId = await createTransaction(
      userId,
      {
        direction: "PAY",
        title: `${input.name} (autopay)`,
        amount: input.amountPaise,
        categoryId: input.categoryId,
        frequency: input.frequency,
        dueDate: input.startDate,
        startDate: input.startDate,
        endDate: input.endDate,
        counterparty: input.payeeName,
        notes: "Simulated autopay mandate. Paid by debit attempts in the Integrations Hub.",
      },
      { requestId: `mandate:${requestId}`, source: { kind: "mandate", mandateId }, session },
    );
    const now = new Date();
    await mandatesCollection().insertOne(
      {
        _id: mandateId,
        userId,
        name: input.name,
        provider: input.provider,
        payeeName: input.payeeName,
        amountPaise: input.amountPaise,
        frequency: input.frequency,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "ACTIVE",
        transactionId: new ObjectId(txId),
        requestId,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );
    await recordAudit({ userId, action: "mandate.created", entity: { kind: "mandate", id: mandateId.toHexString() }, summary: `Mandate "${input.name}" created.` }, session);
    return mandateId.toHexString();
  });
}

const TRANSITIONS: Record<MandateStatus, MandateStatus[]> = { ACTIVE: ["PAUSED", "CANCELLED"], PAUSED: ["ACTIVE", "CANCELLED"], CANCELLED: [] };

/** Pause, resume or cancel. The linked payment item pauses/resumes with it. */
export async function setMandateStatus(userId: string, id: string, status: MandateStatus, today: ISODate): Promise<void> {
  const _id = toObjectId(id);
  if (!_id) throw new UserError("That mandate no longer exists.");
  await runInTransaction(async (session) => {
    const m = await mandatesCollection().findOne({ _id, userId }, { session });
    if (!m) throw new UserError("That mandate no longer exists.");
    if (m.status === status) return;
    if (!TRANSITIONS[m.status].includes(status)) throw new UserError(`A ${m.status.toLowerCase()} mandate can't be ${status.toLowerCase()}.`);
    const res = await mandatesCollection().updateOne({ _id, userId, status: m.status }, { $set: { status, updatedAt: new Date() } }, { session });
    if (res.matchedCount !== 1) throw new UserError("This mandate changed. Refresh and try again.");
    if (status === "ACTIVE") await resumeTransaction(userId, m.transactionId.toHexString(), today, { session });
    else if (m.status === "ACTIVE") await pauseTransaction(userId, m.transactionId.toHexString(), { session });
    await recordAudit({ userId, action: `mandate.${status.toLowerCase()}`, entity: { kind: "mandate", id }, summary: `Mandate "${m.name}" is now ${status.toLowerCase()}.` }, session);
  });
}
