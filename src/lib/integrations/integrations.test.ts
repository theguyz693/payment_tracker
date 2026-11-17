import { describe, expect, it } from "vitest";
import { AdapterError, getAdapter } from "./adapters";
import { isClaimable, isIdempotencyKey, nextAttempt, nextStatusAfterFailure, retryDelayMs, stableStringify } from "./rules";
import { mandateSchema, tradeSimSchema, upiSimSchema } from "./validation";

const now = "2026-11-17T10:00:00.000Z";

describe("provider adapters normalise to one internal format", () => {
  it("Google Pay Simulator payment", () => {
    const n = getAdapter("gpay_sim").normalize({
      id: "gpay_evt_abc123",
      type: "PAYMENT_SENT",
      account: "acct_gpay_x1y2z3",
      created: now,
      data: { txn_ref: "GPSIM_ref001", amount: { value: "1500.50", currency: "INR" }, counterparty: { name: "Rahul", vpa: "rahul@okdemo" }, note: "Dinner", state: "PENDING" },
    });
    expect(n).toMatchObject({ provider: "gpay_sim", eventType: "payment.debit", amountPaise: 150050, data: { kind: "payment", flow: "debit", status: "PENDING", paymentRef: "GPSIM_ref001" } });
    expect(n.demo).toEqual({ failFirstAttempts: 0, simulateCrash: false });
  });

  it("PhonePe Simulator payment uses integer paise and its own status codes", () => {
    const n = getAdapter("phonepe_sim").normalize({
      eventId: "PPEVT_abcdef",
      eventType: "UPI_CREDIT",
      merchantUserId: "acct_phonepe_abc",
      timestamp: Date.parse(now),
      payload: { transactionId: "PPSIM_123456", amountPaise: 150000, counterpartyName: "Demo Contact", code: "PAYMENT_ERROR" },
    });
    expect(n).toMatchObject({ eventType: "payment.credit", amountPaise: 150000, occurredAt: now, data: { flow: "credit", status: "FAILED" } });
  });

  it("Groww Simulator trade value is computed exactly in paise", () => {
    const n = getAdapter("groww_sim").normalize({
      event_id: "groww_evt_1234",
      event: "ORDER_EXECUTED",
      client_id: "acct_groww_abc",
      executed_at: now,
      order: { order_id: "GRWSIM_0001", instrument: { symbol: "niftybees", name: "Nifty BeES", segment: "ETF" }, transaction_type: "BUY", quantity: "10", average_price: "270.5", charges: "1.25", trade_date: "2026-11-10" },
    });
    expect(n.amountPaise).toBe(2705_00);
    expect(n.data).toMatchObject({ kind: "trade", symbol: "NIFTYBEES", assetType: "ETF", qtyMicro: 10_000_000, price4: 2_705_000, feePaise: 125 });
  });

  it("rejects bad payloads with readable issues", () => {
    const bad = () =>
      getAdapter("gpay_sim").normalize({ id: "x", type: "PAYMENT_SENT", account: "acct_gpay_x1y2z3", created: "yesterday", data: { txn_ref: "GPSIM_ref001", amount: { value: "-1", currency: "USD" }, state: "SUCCESS" } });
    expect(bad).toThrow(AdapterError);
    try {
      bad();
    } catch (e) {
      const issues = (e as AdapterError).issues.join(" | ");
      expect(issues).toMatch(/id/);
      expect(issues).toMatch(/created/);
      expect(issues).toMatch(/currency|amount/);
    }
  });

  it("an autopay update can't be PENDING; SIP dates only for fund purchases", () => {
    expect(() =>
      getAdapter("autopay_sim").normalize({
        event_id: "apupd_x_1",
        type: "MANDATE_DEBIT_UPDATE",
        account: "acct_autopay_1",
        occurred_at: now,
        mandate_ref: "a".repeat(24),
        due_date: "2026-11-10",
        attempt: 1,
        amount: "649.00",
        result: "PENDING",
      }),
    ).toThrow(AdapterError);
    expect(() =>
      getAdapter("groww_sim").normalize({
        event_id: "groww_evt_1234",
        event: "ORDER_EXECUTED",
        client_id: "acct_groww_abc",
        executed_at: now,
        order: { order_id: "GRWSIM_0001", instrument: { symbol: "INFY", name: "Infosys", segment: "EQ" }, transaction_type: "BUY", quantity: "1", average_price: "1800", trade_date: "2026-11-10", sip_date: "2026-11-10" },
      }),
    ).toThrow(AdapterError);
  });

  it("strips prototype tricks and unknown fields", () => {
    const n = getAdapter("requests_sim").normalize(
      JSON.parse('{"id":"req_evt_1234","type":"COLLECT_REQUEST","account":"acct_req_12345","created_at":"2026-11-17T10:00:00.000Z","request":{"ref":"COLLECT_1234","from":{"name":"Rahul"},"amount":"800","message":null},"__proto__":{"admin":true},"userId":"someone-else"}'),
    );
    expect(n).not.toHaveProperty("userId");
    expect((n as unknown as { admin?: boolean }).admin).toBeUndefined();
    expect(n.amountPaise).toBe(800_00);
  });
});

describe("reliability rules", () => {
  it("stable fingerprints ignore key order", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("idempotency keys are short and safe", () => {
    expect(isIdempotencyKey("3f1c2b9e-1111-4a2b-9c3d-aaaaaaaaaaaa")).toBe(true);
    expect(isIdempotencyKey("short")).toBe(false);
    expect(isIdempotencyKey("bad key with spaces")).toBe(false);
    expect(isIdempotencyKey({ $ne: null })).toBe(false);
  });

  it("backoff grows exponentially and is capped", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000, 120_000]);
    expect(retryDelayMs(20)).toBe(15 * 60_000);
  });

  it("business failures never retry automatically; transient ones do until the limit", () => {
    expect(nextStatusAfterFailure("business", 1)).toBe("FAILED");
    expect(nextStatusAfterFailure("transient", 1)).toBe("RETRY_PENDING");
    expect(nextStatusAfterFailure("transient", 5)).toBe("FAILED");
    expect(isClaimable("FAILED", { manual: false })).toBe(false);
    expect(isClaimable("FAILED", { manual: true })).toBe(true);
    expect(isClaimable("PROCESSED", { manual: true })).toBe(false);
  });

  it("autopay attempts: none after success or while pending, at most three", () => {
    expect(nextAttempt([])).toEqual({ ok: true, attemptNo: 1 });
    expect(nextAttempt([{ attemptNo: 1, status: "FAILED" }])).toEqual({ ok: true, attemptNo: 2 });
    expect(nextAttempt([{ attemptNo: 1, status: "PENDING" }])).toEqual({ ok: false, reason: "pending" });
    expect(nextAttempt([{ attemptNo: 1, status: "SUCCESS" }])).toEqual({ ok: false, reason: "already_paid" });
    expect(
      nextAttempt([
        { attemptNo: 1, status: "FAILED" },
        { attemptNo: 2, status: "FAILED" },
        { attemptNo: 3, status: "FAILED" },
      ]),
    ).toEqual({ ok: false, reason: "exhausted" });
  });
});

describe("hub form validation", () => {
  it("UPI simulator: amounts, demo UPI ids and outcomes", () => {
    const ok = upiSimSchema.safeParse({ provider: "gpay_sim", flow: "debit", name: "Rahul", vpa: "rahul@okdemo", amount: "1,500.50", outcome: "SUCCESS" });
    expect(ok.success && ok.data.amount).toBe(150050);
    expect(upiSimSchema.safeParse({ provider: "paytm", flow: "debit", name: "R", amount: "10", outcome: "SUCCESS" }).success).toBe(false);
    expect(upiSimSchema.safeParse({ provider: "gpay_sim", flow: "debit", name: "R", vpa: "not a vpa", amount: "10", outcome: "SUCCESS" }).success).toBe(false);
    expect(upiSimSchema.safeParse({ provider: "gpay_sim", flow: "debit", name: "R", amount: "0", outcome: "SUCCESS" }).success).toBe(false);
  });

  it("mandates must repeat and end after they start", () => {
    const base = { name: "Netflix", payeeName: "N", provider: "autopay_sim", amount: "649", frequency: "MONTHLY", startDate: "2026-11-10", categoryId: "PAY:Subscription" };
    expect(mandateSchema.safeParse(base).success).toBe(true);
    expect(mandateSchema.safeParse({ ...base, frequency: "ONE_TIME" }).success).toBe(false);
    expect(mandateSchema.safeParse({ ...base, endDate: "2026-01-01" }).success).toBe(false);
  });

  it("trade simulator: decimal limits", () => {
    const base = { symbol: "INFY", name: "Infosys", segment: "EQ", side: "BUY", quantity: "1.123456", price: "1800.1234", tradeDate: "2026-11-10" };
    expect(tradeSimSchema.safeParse(base).success).toBe(true);
    expect(tradeSimSchema.safeParse({ ...base, quantity: "1.1234567" }).success).toBe(false);
    expect(tradeSimSchema.safeParse({ ...base, price: "-1" }).success).toBe(false);
  });
});
