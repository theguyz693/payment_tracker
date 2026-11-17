// The single ingestion and processing pipeline for provider events
// ("IdemPay"). Simulator actions, the webhook route, console retries and the
// cron worker all go through these functions.
//
//   receiveDelivery
//     1. size limit, known provider
//     2. authenticate the delivery (HMAC signature + timestamp window)
//     3. parse + validate with the provider's adapter (Zod) -> NormalizedEvent
//     4. resolve the demo connection -> owning user; a signed-in caller must own it
//     5. persist the event (unique per user + provider + externalEventId);
//        a repeat delivery is counted as a duplicate and not processed again
//   processEvent
//     6. claim it (atomic status change + lease; stale leases can be taken over)
//     7. run the business handler, mark PROCESSED and write the audit entry
//        in ONE MongoDB transaction (all or nothing)
//     8. on failure record the outcome: business rule -> FAILED,
//        transient -> RETRY_PENDING with backoff (FAILED after max attempts)
//
// Effectively-once side effects come from the unique event index, the
// transactional commit, lease-guarded completion, and natural keys in the
// handlers — not from the event id alone.

import "server-only";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { AdapterError, getAdapter } from "@/lib/integrations/adapters";
import { EVENT_LEASE_MS, MAX_EVENT_ATTEMPTS, nextStatusAfterFailure, retryDelayMs, stableStringify } from "@/lib/integrations/rules";
import { eventDirection, isProviderId, type EventStatus, type NormalizedEvent } from "@/lib/integrations/types";
import type { ISODate } from "@/lib/types";
import { recordAudit } from "../audit";
import { errorCategory, TransientError, UserError } from "../errors";
import { log, logError, newRequestId } from "../log";
import { connectionsCollection, eventsCollection, isDuplicateKey, runInTransaction, type EventAttempt, type IntegrationEventDoc } from "../models";
import { recordRejection, type RejectionReason } from "../ratelimit";
import { handlerFor } from "./handlers";
import { verifyDelivery } from "./signature";

export const MAX_BODY_BYTES = 16 * 1024;

export interface Delivery {
  provider: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  source: "SIMULATOR" | "WEBHOOK";
  /** Set when a signed-in user triggered the delivery; the event must belong to them. */
  sessionUserId?: string;
  today: ISODate;
  requestId?: string;
}

export type DeliveryResult =
  | { kind: "rejected"; httpStatus: number; reason: RejectionReason; message: string; issues?: string[] }
  | { kind: "accepted"; httpStatus: number; duplicate: boolean; event: IntegrationEventDoc };

class LeaseLostError extends Error {}

/**
 * Fingerprint of an event's financial content. Delivery metadata (timestamps,
 * demo switches) is left out: a provider retrying the same event may stamp
 * it again, but the same id with a different amount, party or status is a
 * conflict, never a duplicate.
 */
function hashPayload(n: NormalizedEvent): string {
  const { provider, externalEventId, eventType, accountRef, amountPaise, data } = n;
  return createHash("sha256").update(stableStringify({ provider, externalEventId, eventType, accountRef, amountPaise, data })).digest("hex");
}

async function reject(d: Delivery, httpStatus: number, reason: RejectionReason, message: string, userId: string | null, issues?: string[]): Promise<DeliveryResult> {
  await recordRejection({ userId, reason, route: `integrations.${d.source.toLowerCase()}`, provider: isProviderId(d.provider) ? d.provider : null });
  log("warn", "integration.rejected", { requestId: d.requestId, provider: d.provider, reason, userId, source: d.source });
  return { kind: "rejected", httpStatus, reason, message, issues };
}

export async function receiveDelivery(d: Delivery): Promise<DeliveryResult> {
  const requestId = d.requestId ?? newRequestId();
  d = { ...d, requestId };
  if (Buffer.byteLength(d.body, "utf8") > MAX_BODY_BYTES) return reject(d, 413, "TOO_LARGE", "Payload too large.", d.sessionUserId ?? null);
  if (!isProviderId(d.provider)) return reject(d, 404, "UNKNOWN_PROVIDER", "Unknown provider.", d.sessionUserId ?? null);

  const sig = verifyDelivery(d.body, d.timestamp, d.signature);
  if (sig === "invalid_signature") return reject(d, 401, "INVALID_SIGNATURE", "Signature verification failed.", d.sessionUserId ?? null);
  if (sig === "stale_timestamp") return reject(d, 401, "STALE_TIMESTAMP", "Delivery timestamp is outside the allowed window (possible replay).", d.sessionUserId ?? null);

  let raw: unknown;
  try {
    raw = JSON.parse(d.body);
  } catch {
    return reject(d, 400, "INVALID_PAYLOAD", "Body is not valid JSON.", d.sessionUserId ?? null);
  }
  let normalized: NormalizedEvent;
  try {
    normalized = getAdapter(d.provider).normalize(raw);
  } catch (e) {
    if (e instanceof AdapterError) return reject(d, 422, "INVALID_PAYLOAD", e.message, d.sessionUserId ?? null, e.issues);
    throw e;
  }

  const connection = await connectionsCollection().findOne({ provider: d.provider, accountRef: normalized.accountRef, status: "CONNECTED" });
  if (!connection) return reject(d, 404, "UNKNOWN_ACCOUNT", "No connected demo account matches this delivery.", d.sessionUserId ?? null);
  if (d.sessionUserId && connection.userId !== d.sessionUserId) return reject(d, 403, "FORBIDDEN", "This delivery belongs to a different account.", d.sessionUserId);
  const userId = connection.userId;

  const payloadHash = hashPayload(normalized);
  const now = new Date();
  const doc: IntegrationEventDoc = {
    _id: new ObjectId(),
    userId,
    provider: d.provider,
    connectionId: connection._id,
    externalEventId: normalized.externalEventId,
    eventType: normalized.eventType,
    direction: eventDirection(normalized.eventType),
    source: d.source,
    normalizedPayload: normalized as unknown as Record<string, unknown>,
    rawBody: d.body,
    payloadHash,
    amountPaise: normalized.amountPaise,
    status: "RECEIVED",
    attemptCount: 0,
    maxAttempts: MAX_EVENT_ATTEMPTS,
    lastError: null,
    outcome: null,
    linked: null,
    paymentStatus: null,
    attempts: [],
    duplicateCount: 0,
    lastDuplicateAt: null,
    requestId,
    receivedAt: now,
    processingStartedAt: null,
    leaseUntil: null,
    processedAt: null,
    nextRetryAt: null,
    durationMs: null,
  };

  try {
    await eventsCollection().insertOne(doc);
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    // Same event delivered again: never processed twice.
    const existing = await eventsCollection().findOne({ userId, provider: d.provider, externalEventId: normalized.externalEventId });
    if (!existing) throw e;
    if (existing.payloadHash !== payloadHash) {
      return reject(d, 409, "PAYLOAD_CONFLICT", "An event with this id was already received with different contents.", userId);
    }
    const updated = await eventsCollection().findOneAndUpdate(
      { _id: existing._id, userId },
      { $inc: { duplicateCount: 1 }, $set: { lastDuplicateAt: new Date() } },
      { returnDocument: "after" },
    );
    await recordAudit({ userId, action: "event.duplicate_blocked", entity: { kind: "integrationEvent", id: existing._id.toHexString() }, summary: `Repeat delivery of ${existing.externalEventId} ignored (status ${existing.status}).`, requestId, eventId: existing._id });
    log("info", "integration.duplicate", { requestId, eventId: existing._id.toHexString(), provider: d.provider, userId, status: existing.status });
    return { kind: "accepted", httpStatus: 200, duplicate: true, event: updated ?? existing };
  }
  log("info", "integration.received", { requestId, eventId: doc._id.toHexString(), provider: d.provider, eventType: doc.eventType, userId, source: d.source });
  await recordAudit({ userId, action: "event.received", entity: { kind: "integrationEvent", id: doc._id.toHexString() }, summary: `${doc.eventType} ${doc.externalEventId} received.`, requestId, eventId: doc._id });

  const processed = await processEvent(userId, doc._id, { manual: false, today: d.today, requestId });
  const status = processed?.status ?? "RECEIVED";
  return { kind: "accepted", httpStatus: status === "PROCESSED" || status === "FAILED" ? 200 : 202, duplicate: false, event: processed ?? doc };
}

/**
 * Claim and process one event. Safe to call concurrently and repeatedly:
 * only one caller can hold the lease, and completion is guarded by it.
 * `manual` allows retrying a FAILED event (user-initiated retry).
 */
export async function processEvent(
  userId: string,
  eventId: ObjectId,
  opts: { manual: boolean; today: ISODate; requestId?: string },
): Promise<IntegrationEventDoc | null> {
  const col = eventsCollection();
  const now = new Date();
  const claimable: Record<string, unknown>[] = [
    { status: "RECEIVED" },
    opts.manual ? { status: "RETRY_PENDING" } : { status: "RETRY_PENDING", nextRetryAt: { $lte: now } },
    { status: "PROCESSING", leaseUntil: { $lt: now } }, // previous worker died
  ];
  if (opts.manual) claimable.push({ status: "FAILED" });
  const leaseUntil = new Date(now.getTime() + EVENT_LEASE_MS);
  const claimed = await col.findOneAndUpdate(
    { _id: eventId, userId, $or: claimable },
    { $set: { status: "PROCESSING", processingStartedAt: now, leaseUntil, nextRetryAt: null }, $inc: { attemptCount: 1 } },
    { returnDocument: "after" },
  );
  if (!claimed) return col.findOne({ _id: eventId, userId });

  const normalized = claimed.normalizedPayload as unknown as NormalizedEvent;
  const started = performance.now();
  const attemptNo = claimed.attemptCount;
  const logFields = { requestId: opts.requestId, eventId: eventId.toHexString(), provider: claimed.provider, eventType: claimed.eventType, userId, attempt: attemptNo };

  if (normalized.demo?.simulateCrash && attemptNo === 1) {
    // Demo: stop here as if the process died. The lease expires and recovery takes over.
    log("warn", "integration.simulated_crash", logFields);
    return col.findOne({ _id: eventId, userId });
  }

  try {
    await runInTransaction(async (session) => {
      const result = await handlerFor(claimed.eventType)({ userId, event: claimed, normalized, today: opts.today, session });
      if ((normalized.demo?.failFirstAttempts ?? 0) >= attemptNo) {
        // Demo: fail AFTER the business writes, so the rollback is real.
        throw new TransientError(`Simulated transient failure on attempt ${attemptNo} (all writes rolled back).`);
      }
      const finishedAt = new Date();
      const durationMs = Math.round(performance.now() - started);
      const attempt: EventAttempt = { n: attemptNo, startedAt: now, finishedAt, durationMs, result: "PROCESSED", error: null };
      const done = await col.updateOne(
        { _id: eventId, userId, status: "PROCESSING", leaseUntil },
        {
          $set: {
            status: "PROCESSED",
            processedAt: finishedAt,
            durationMs,
            outcome: result.outcome,
            linked: result.linked,
            paymentStatus: result.paymentStatus ?? null,
            lastError: null,
            leaseUntil: null,
          },
          $push: { attempts: attempt },
        },
        { session },
      );
      if (done.matchedCount !== 1) throw new LeaseLostError();
      await recordAudit(
        {
          userId,
          action: `event.processed`,
          entity: result.linked ? { kind: result.linked.kind, id: result.linked.id } : { kind: "integrationEvent", id: eventId.toHexString() },
          summary: `${claimed.eventType} ${claimed.externalEventId}: ${result.outcome.message}`,
          requestId: opts.requestId ?? null,
          eventId,
        },
        session,
      );
    });
    log("info", "integration.processed", { ...logFields, outcome: "processed", durationMs: Math.round(performance.now() - started) });
  } catch (e) {
    if (e instanceof LeaseLostError) {
      log("warn", "integration.lease_lost", logFields);
      return col.findOne({ _id: eventId, userId });
    }
    // A UserError is a business-rule rejection (retrying won't help). Anything
    // else — driver/network errors, simulated faults, unexpected bugs — is
    // retried with backoff and ends as FAILED after maxAttempts.
    const kind = e instanceof UserError ? "business" : "transient";
    const next: EventStatus = nextStatusAfterFailure(kind, attemptNo, claimed.maxAttempts);
    const category = errorCategory(e);
    const message = e instanceof UserError || e instanceof TransientError ? e.message : "Unexpected processing error.";
    const finishedAt = new Date();
    const durationMs = Math.round(performance.now() - started);
    const attempt: EventAttempt = { n: attemptNo, startedAt: now, finishedAt, durationMs, result: next === "RETRY_PENDING" ? "RETRY_PENDING" : "FAILED", error: message };
    const nextRetryAt = next === "RETRY_PENDING" ? new Date(finishedAt.getTime() + retryDelayMs(attemptNo)) : null;
    await col.updateOne(
      { _id: eventId, userId, status: "PROCESSING", leaseUntil },
      { $set: { status: next, lastError: { category, message }, nextRetryAt, durationMs, leaseUntil: null }, $push: { attempts: attempt } },
    );
    await recordAudit({
      userId,
      action: next === "RETRY_PENDING" ? "event.retry_scheduled" : "event.failed",
      entity: { kind: "integrationEvent", id: eventId.toHexString() },
      summary: `${claimed.externalEventId} attempt ${attemptNo}: ${message}`,
      requestId: opts.requestId ?? null,
      eventId,
    }).catch(() => {});
    logError("integration.process", e, { ...logFields, status: next, durationMs });
  }
  return col.findOne({ _id: eventId, userId });
}

/**
 * Events stuck in PROCESSING past their lease (the worker crashed or timed
 * out) go back to RETRY_PENDING. Their transaction never committed, so
 * nothing was applied. Scoped to one user unless called by the cron worker.
 */
export async function recoverStuckEvents(userId: string | null, limit = 50): Promise<number> {
  const col = eventsCollection();
  const now = new Date();
  const stuck = await col
    .find({ ...(userId ? { userId } : {}), status: "PROCESSING", leaseUntil: { $lt: now } })
    .limit(limit)
    .toArray();
  let n = 0;
  for (const e of stuck) {
    const attempt: EventAttempt = {
      n: e.attemptCount,
      startedAt: e.processingStartedAt ?? now,
      finishedAt: now,
      durationMs: 0,
      result: "ABANDONED",
      error: "Worker stopped before finishing; lease expired.",
    };
    const res = await col.updateOne(
      { _id: e._id, userId: e.userId, status: "PROCESSING", leaseUntil: e.leaseUntil },
      { $set: { status: "RETRY_PENDING", nextRetryAt: now, leaseUntil: null, lastError: { category: "lease_expired", message: attempt.error! } }, $push: { attempts: attempt } },
    );
    if (res.matchedCount === 1) {
      n++;
      await recordAudit({ userId: e.userId, action: "event.recovered", entity: { kind: "integrationEvent", id: e._id.toHexString() }, summary: `${e.externalEventId} recovered from an abandoned PROCESSING state.`, eventId: e._id });
    }
  }
  if (n) log("warn", "integration.recovered", { count: n, scope: userId ? "user" : "all" });
  return n;
}

/** Process RETRY_PENDING events whose backoff has elapsed. */
export async function processDueRetries(userId: string | null, today: (userId: string) => ISODate, limit = 20): Promise<number> {
  const due = await eventsCollection()
    .find({ ...(userId ? { userId } : {}), status: "RETRY_PENDING", nextRetryAt: { $lte: new Date() } }, { projection: { _id: 1, userId: 1 } })
    .sort({ nextRetryAt: 1 })
    .limit(limit)
    .toArray();
  for (const e of due) await processEvent(e.userId, e._id, { manual: false, today: today(e.userId) });
  return due.length;
}
