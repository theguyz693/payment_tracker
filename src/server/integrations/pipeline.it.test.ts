// Real-MongoDB integration tests for the event pipeline, the simulated
// providers and the GateKeeper checks on deliveries.

import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  attemptsCollection,
  auditCollection,
  connectionsCollection,
  eventsCollection,
  invTxnsCollection,
  paymentRequestsCollection,
  rejectionsCollection,
  transactionsCollection,
} from "../models";
import { createMandate, decidePaymentRequest, setConnection, setMandateStatus } from "./operations";
import { processDueRetries, processEvent, receiveDelivery, recoverStuckEvents } from "./pipeline";
import { buildMandateDebit, buildRequest, buildTrade, buildUpi, buildUpiStatus, deliver, deliverBody } from "./simulator";
import { signDelivery } from "./signature";
import type { ProviderId } from "@/lib/integrations/types";

const today = "2026-11-17";
const newUser = () => `it-user-${new ObjectId().toHexString()}`;
const ctx = (userId: string) => ({ userId, today, requestId: `req-${new ObjectId().toHexString()}` });

async function connect(userId: string, provider: ProviderId) {
  await setConnection(userId, provider, true);
  return (await connectionsCollection().findOne({ userId, provider }))!.accountRef;
}

const upi = (status: "SUCCESS" | "PENDING" | "FAILED" = "SUCCESS", flow: "debit" | "credit" = "debit") => ({
  flow,
  name: "Rahul",
  vpa: "rahul@okdemo",
  amountPaise: 1500_00,
  note: "Dinner",
  category: null,
  status,
});

function accepted(r: Awaited<ReturnType<typeof receiveDelivery>>) {
  if (r.kind !== "accepted") throw new Error(`expected accepted, got ${r.reason}: ${r.message} ${r.issues?.join("; ") ?? ""}`);
  return r;
}

describe("ingestion and deduplication", () => {
  it("a successful simulated UPI payment creates one settled PAY transaction", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const r = accepted(await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi()), ctx(u)));
    expect(r.event.status).toBe("PROCESSED");
    expect(r.event.paymentStatus).toBe("SUCCESS");
    const tx = await transactionsCollection().findOne({ userId: u });
    expect(tx).toMatchObject({ direction: "PAY", status: "PAID", amountPaise: 1500_00, frequency: "ONE_TIME" });
    expect(tx!.history).toHaveLength(1);
    expect(tx!.source).toMatchObject({ kind: "integration", provider: "gpay_sim" });
  });

  it("an incoming PhonePe payment creates a RECEIVE transaction", async () => {
    const u = newUser();
    const acct = await connect(u, "phonepe_sim");
    accepted(await deliver("phonepe_sim", buildUpi("phonepe_sim", acct, upi("SUCCESS", "credit")), ctx(u)));
    expect(await transactionsCollection().findOne({ userId: u })).toMatchObject({ direction: "RECEIVE", status: "RECEIVED" });
  });

  it("a FAILED payment is processed but records no transaction", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const r = accepted(await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi("FAILED")), ctx(u)));
    expect(r.event.status).toBe("PROCESSED");
    expect(r.event.outcome?.code).toBe("payment_failed");
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0);
  });

  it("re-delivering the same event is blocked as a duplicate (no second transaction)", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const body = JSON.stringify(buildUpi("gpay_sim", acct, upi()));
    accepted(await deliverBody("gpay_sim", body, ctx(u)));
    const again = accepted(await deliverBody("gpay_sim", body, ctx(u)));
    expect(again.duplicate).toBe(true);
    expect(again.event.duplicateCount).toBe(1);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
    expect(await eventsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("concurrent deliveries of one event process it exactly once", async () => {
    const u = newUser();
    const acct = await connect(u, "phonepe_sim");
    const body = JSON.stringify(buildUpi("phonepe_sim", acct, upi()));
    const results = await Promise.all(Array.from({ length: 6 }, () => deliverBody("phonepe_sim", body, ctx(u))));
    expect(results.every((r) => r.kind === "accepted")).toBe(true);
    expect(results.filter((r) => r.kind === "accepted" && !r.duplicate)).toHaveLength(1);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
    expect((await eventsCollection().findOne({ userId: u }))!.duplicateCount).toBe(5);
  });

  it("same event id with different contents is rejected as a conflict", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const p = buildUpi("gpay_sim", acct, upi());
    accepted(await deliver("gpay_sim", p, ctx(u)));
    const tampered = { ...p, data: { ...p.data, amount: { value: "9999.00", currency: "INR" } } };
    const r = await deliver("gpay_sim", tampered, ctx(u));
    expect(r).toMatchObject({ kind: "rejected", reason: "PAYLOAD_CONFLICT", httpStatus: 409 });
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });
});

describe("GateKeeper checks on deliveries", () => {
  const signed = (body: string, ts = Math.floor(Date.now() / 1000)) => ({ timestamp: String(ts), signature: signDelivery(body, ts) });

  it("rejects a bad signature, a stale timestamp and an unknown provider", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const body = JSON.stringify(buildUpi("gpay_sim", acct, upi()));
    const bad = await receiveDelivery({ provider: "gpay_sim", body, timestamp: String(Math.floor(Date.now() / 1000)), signature: "0".repeat(64), source: "WEBHOOK", today });
    expect(bad).toMatchObject({ kind: "rejected", reason: "INVALID_SIGNATURE", httpStatus: 401 });
    const old = Math.floor(Date.now() / 1000) - 3600;
    const stale = await receiveDelivery({ provider: "gpay_sim", body, ...signed(body, old), source: "WEBHOOK", today });
    expect(stale).toMatchObject({ kind: "rejected", reason: "STALE_TIMESTAMP" });
    const unknown = await receiveDelivery({ provider: "paytm_real", body, ...signed(body), source: "WEBHOOK", today });
    expect(unknown).toMatchObject({ kind: "rejected", reason: "UNKNOWN_PROVIDER" });
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0);
  });

  it("rejects an invalid payload with readable issues", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const p = buildUpi("gpay_sim", acct, upi());
    const body = JSON.stringify({ ...p, data: { ...p.data, amount: { value: "-5", currency: "USD" } } });
    const r = await receiveDelivery({ provider: "gpay_sim", body, ...signed(body), source: "WEBHOOK", today });
    expect(r).toMatchObject({ kind: "rejected", reason: "INVALID_PAYLOAD", httpStatus: 422 });
    if (r.kind === "rejected") expect(r.issues!.join(" ")).toMatch(/amount/);
  });

  it("a signed-in user can't deliver events into another user's account", async () => {
    const victim = newUser();
    const attacker = newUser();
    const acct = await connect(victim, "gpay_sim");
    const r = await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi()), ctx(attacker));
    expect(r).toMatchObject({ kind: "rejected", reason: "FORBIDDEN", httpStatus: 403 });
    expect(await transactionsCollection().countDocuments({ userId: victim })).toBe(0);
    expect(await rejectionsCollection().countDocuments({ userId: attacker, reason: "FORBIDDEN" })).toBe(1);
  });

  it("an unknown or disconnected demo account is rejected", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    await setConnection(u, "gpay_sim", false);
    const r = await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi()), ctx(u));
    expect(r).toMatchObject({ kind: "rejected", reason: "UNKNOWN_ACCOUNT" });
  });
});

describe("failures, retries and recovery", () => {
  it("a transient failure after the business writes rolls back, then a retry succeeds once", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const r = accepted(await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi(), { failFirstAttempts: 1 }), ctx(u)));
    expect(r.event.status).toBe("RETRY_PENDING");
    expect(r.event.nextRetryAt).toBeTruthy();
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0); // rolled back

    const retried = await processEvent(u, r.event._id, { manual: true, today });
    expect(retried!.status).toBe("PROCESSED");
    expect(retried!.attemptCount).toBe(2);
    expect(retried!.attempts.map((a) => a.result)).toEqual(["RETRY_PENDING", "PROCESSED"]);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
    // Processing it again is a no-op.
    await processEvent(u, r.event._id, { manual: true, today });
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("the retry worker only picks up events whose backoff has elapsed", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const r = accepted(await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi(), { failFirstAttempts: 1 }), ctx(u)));
    expect(await processDueRetries(u, () => today)).toBe(0); // not due yet
    await eventsCollection().updateOne({ _id: r.event._id }, { $set: { nextRetryAt: new Date(Date.now() - 1000) } });
    expect(await processDueRetries(u, () => today)).toBe(1);
    expect((await eventsCollection().findOne({ _id: r.event._id }))!.status).toBe("PROCESSED");
  });

  it("a crash mid-processing leaves the event recoverable, and recovery applies it once", async () => {
    const u = newUser();
    const acct = await connect(u, "phonepe_sim");
    const r = accepted(await deliver("phonepe_sim", buildUpi("phonepe_sim", acct, upi(), { simulateCrash: true }), ctx(u)));
    expect(r.event.status).toBe("PROCESSING");
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0);
    // While the lease is valid nobody else can take it.
    expect((await processEvent(u, r.event._id, { manual: true, today }))!.status).toBe("PROCESSING");
    // Lease expires.
    await eventsCollection().updateOne({ _id: r.event._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
    expect(await recoverStuckEvents(u)).toBe(1);
    expect((await eventsCollection().findOne({ _id: r.event._id }))!.status).toBe("RETRY_PENDING");
    const done = await processEvent(u, r.event._id, { manual: false, today });
    expect(done!.status).toBe("PROCESSED");
    expect(done!.attempts.map((a) => a.result)).toEqual(["ABANDONED", "PROCESSED"]);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("a business-rule failure is FAILED without automatic retries", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const r = accepted(await deliver("gpay_sim", buildUpiStatus("gpay_sim", acct, "GPSIM_does_not_exist", "SUCCESS"), ctx(u)));
    expect(r.event.status).toBe("FAILED");
    expect(r.event.nextRetryAt).toBeNull();
    expect(r.event.lastError?.category).toBe("user_error");
  });

  it("every processed event has an audit entry committed with it", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const r = accepted(await deliver("gpay_sim", buildUpi("gpay_sim", acct, upi()), ctx(u)));
    expect(await auditCollection().countDocuments({ userId: u, eventId: r.event._id, action: "event.processed" })).toBe(1);
  });
});

describe("pending payments and status updates", () => {
  it("PENDING creates an open item; SUCCESS settles it; a repeat update changes nothing", async () => {
    const u = newUser();
    const acct = await connect(u, "gpay_sim");
    const p = buildUpi("gpay_sim", acct, upi("PENDING"));
    const r = accepted(await deliver("gpay_sim", p, ctx(u)));
    expect(await transactionsCollection().findOne({ userId: u })).toMatchObject({ status: "PENDING" });
    accepted(await deliver("gpay_sim", buildUpiStatus("gpay_sim", acct, p.data.txn_ref, "SUCCESS"), ctx(u)));
    const tx = await transactionsCollection().findOne({ userId: u });
    expect(tx).toMatchObject({ status: "PAID" });
    expect(tx!.history).toHaveLength(1);
    expect((await eventsCollection().findOne({ _id: r.event._id }))!.paymentStatus).toBe("SUCCESS");
    const again = accepted(await deliver("gpay_sim", buildUpiStatus("gpay_sim", acct, p.data.txn_ref, "SUCCESS"), ctx(u)));
    expect(again.duplicate).toBe(true);
  });

  it("PENDING then FAILED removes the open item", async () => {
    const u = newUser();
    const acct = await connect(u, "phonepe_sim");
    const p = buildUpi("phonepe_sim", acct, upi("PENDING"));
    accepted(await deliver("phonepe_sim", p, ctx(u)));
    accepted(await deliver("phonepe_sim", buildUpiStatus("phonepe_sim", acct, p.payload.transactionId, "FAILED"), ctx(u)));
    expect((await transactionsCollection().findOne({ userId: u }))!.archivedAt).not.toBeNull();
  });
});

describe("payment requests", () => {
  async function incoming(u: string) {
    const acct = await connect(u, "requests_sim");
    const r = accepted(await deliver("requests_sim", buildRequest(acct, { name: "Rahul", vpa: null, amountPaise: 800_00, message: "Dinner split" }), ctx(u)));
    return r.event.linked!.id;
  }

  it("concurrent accepts (different keys) create exactly one payment", async () => {
    const u = newUser();
    const id = await incoming(u);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => decidePaymentRequest(u, id, "ACCEPT", `accept-key-${i}-xxxx`, today)));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
    expect(await paymentRequestsCollection().findOne({ userId: u })).toMatchObject({ status: "ACCEPTED" });
  });

  it("the same accept retried with one key is replayed", async () => {
    const u = newUser();
    const id = await incoming(u);
    const a = await decidePaymentRequest(u, id, "ACCEPT", "accept-same-key-1", today);
    const b = await decidePaymentRequest(u, id, "ACCEPT", "accept-same-key-1", today);
    expect(b.replayed).toBe(true);
    expect(b.result.transactionId).toBe(a.result.transactionId);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("a rejected request creates no transaction and can't be accepted later", async () => {
    const u = newUser();
    const id = await incoming(u);
    await decidePaymentRequest(u, id, "REJECT", "reject-key-12345", today);
    await expect(decidePaymentRequest(u, id, "ACCEPT", "accept-after-reject", today)).rejects.toThrow(/already rejected/);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0);
  });

  it("another user can't decide the request", async () => {
    const u = newUser();
    const id = await incoming(u);
    await expect(decidePaymentRequest(newUser(), id, "ACCEPT", "intruder-key-1234", today)).rejects.toThrow(/no longer exists/);
    expect(await paymentRequestsCollection().findOne({ userId: u })).toMatchObject({ status: "PENDING" });
  });
});

describe("autopay mandates", () => {
  async function mandate(u: string) {
    const acct = await connect(u, "autopay_sim");
    const id = await createMandate(
      u,
      { name: "Netflix", payeeName: "Netflix (demo)", provider: "autopay_sim", amountPaise: 649_00, frequency: "MONTHLY", startDate: "2026-11-10", endDate: null, categoryId: "PAY:Subscription" },
      `mandate-${u}`,
    );
    return { acct, id };
  }
  const debit = (acct: string, id: string, attemptNo: number, result: "SUCCESS" | "FAILED" | "PENDING", update = false) =>
    buildMandateDebit(acct, { mandateId: id, dueDate: "2026-11-10", attemptNo, amountPaise: 649_00, result, update });

  it("a successful debit settles the linked recurring item; a duplicate attempt is blocked", async () => {
    const u = newUser();
    const { acct, id } = await mandate(u);
    accepted(await deliver("autopay_sim", debit(acct, id, 1, "SUCCESS"), ctx(u)));
    const again = accepted(await deliver("autopay_sim", debit(acct, id, 1, "SUCCESS"), ctx(u)));
    expect(again.duplicate).toBe(true);
    const tx = await transactionsCollection().findOne({ userId: u });
    expect(tx!.history).toHaveLength(1);
    expect(tx!.dueDate).toBe("2026-12-10");
    expect(await attemptsCollection().countDocuments({ userId: u, status: "SUCCESS" })).toBe(1);
  });

  it("failed attempts can be retried up to three times; success settles once", async () => {
    const u = newUser();
    const { acct, id } = await mandate(u);
    accepted(await deliver("autopay_sim", debit(acct, id, 1, "FAILED"), ctx(u)));
    accepted(await deliver("autopay_sim", debit(acct, id, 2, "SUCCESS"), ctx(u)));
    // A third attempt for the same (now paid) occurrence is refused.
    const third = accepted(await deliver("autopay_sim", debit(acct, id, 3, "SUCCESS"), ctx(u)));
    expect(third.event.status).toBe("FAILED");
    expect((await transactionsCollection().findOne({ userId: u }))!.history).toHaveLength(1);
  });

  it("a pending attempt blocks new attempts until it resolves", async () => {
    const u = newUser();
    const { acct, id } = await mandate(u);
    accepted(await deliver("autopay_sim", debit(acct, id, 1, "PENDING"), ctx(u)));
    const blocked = accepted(await deliver("autopay_sim", debit(acct, id, 2, "SUCCESS"), ctx(u)));
    expect(blocked.event.status).toBe("FAILED");
    accepted(await deliver("autopay_sim", debit(acct, id, 1, "SUCCESS", true), ctx(u)));
    expect((await transactionsCollection().findOne({ userId: u }))!.history).toHaveLength(1);
    expect(await attemptsCollection().findOne({ userId: u, attemptNo: 1 })).toMatchObject({ status: "SUCCESS" });
  });

  it("concurrent successful attempts settle the occurrence once", async () => {
    const u = newUser();
    const { acct, id } = await mandate(u);
    const results = await Promise.all([deliver("autopay_sim", debit(acct, id, 1, "SUCCESS"), ctx(u)), deliver("autopay_sim", debit(acct, id, 1, "SUCCESS"), ctx(u))]);
    expect(results.filter((r) => r.kind === "accepted" && !r.duplicate)).toHaveLength(1);
    expect((await transactionsCollection().findOne({ userId: u }))!.history).toHaveLength(1);
  });

  it("a paused mandate refuses debits", async () => {
    const u = newUser();
    const { acct, id } = await mandate(u);
    await setMandateStatus(u, id, "PAUSED", today);
    const r = accepted(await deliver("autopay_sim", debit(acct, id, 1, "SUCCESS"), ctx(u)));
    expect(r.event.status).toBe("FAILED");
    expect(r.event.lastError?.message).toMatch(/paused/);
    expect((await transactionsCollection().findOne({ userId: u }))!.history).toHaveLength(0);
  });
});

describe("investment imports", () => {
  const trade = (acct: string, side: "BUY" | "SELL", quantity: string, extra: Partial<Parameters<typeof buildTrade>[1]> = {}) =>
    buildTrade(acct, { symbol: "NIFTYBEES", name: "Nippon Nifty BeES", segment: "ETF", side, quantity, price: "270.5000", charges: "0", tradeDate: "2026-11-10", sipDate: null, ...extra });

  it("imports go to investmentTxns (not transactions) on an import holding", async () => {
    const u = newUser();
    const acct = await connect(u, "groww_sim");
    const r = accepted(await deliver("groww_sim", trade(acct, "BUY", "10"), ctx(u)));
    expect(r.event.status).toBe("PROCESSED");
    expect(r.event.linked?.kind).toBe("holding");
    expect(await invTxnsCollection().countDocuments({ userId: u })).toBe(1);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0);
    expect((await invTxnsCollection().findOne({ userId: u }))!.amountPaise).toBe(2705_00);
  });

  it("an oversell import fails without writing; a duplicate import is blocked", async () => {
    const u = newUser();
    const acct = await connect(u, "groww_sim");
    const buy = trade(acct, "BUY", "5");
    accepted(await deliver("groww_sim", buy, ctx(u)));
    expect(accepted(await deliver("groww_sim", buy, ctx(u))).duplicate).toBe(true);
    const sell = accepted(await deliver("groww_sim", trade(acct, "SELL", "8"), ctx(u)));
    expect(sell.event.status).toBe("FAILED");
    expect(await invTxnsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("concurrent sell imports can't oversell", async () => {
    const u = newUser();
    const acct = await connect(u, "groww_sim");
    accepted(await deliver("groww_sim", trade(acct, "BUY", "10"), ctx(u)));
    const results = await Promise.all([deliver("groww_sim", trade(acct, "SELL", "7"), ctx(u)), deliver("groww_sim", trade(acct, "SELL", "7"), ctx(u))]);
    const statuses = results.map((r) => (r.kind === "accepted" ? r.event.status : r.reason)).sort();
    expect(statuses).toEqual(["FAILED", "PROCESSED"]);
    expect(await invTxnsCollection().countDocuments({ userId: u, type: "SELL" })).toBe(1);
  });

  it("a second import for the same SIP date is recognised", async () => {
    const u = newUser();
    const acct = await connect(u, "groww_sim");
    const sip = (q: string) => buildTrade(acct, { symbol: "PPFAS", name: "Parag Parikh Flexi Cap", segment: "MF", side: "BUY", quantity: q, price: "85.1234", charges: "0", tradeDate: "2026-11-05", sipDate: "2026-11-05" });
    accepted(await deliver("groww_sim", sip("117.45"), ctx(u)));
    const second = accepted(await deliver("groww_sim", sip("117.40"), ctx(u)));
    expect(second.event.outcome?.code).toBe("trade_already_recorded");
    expect(await invTxnsCollection().countDocuments({ userId: u })).toBe(1);
  });
});
