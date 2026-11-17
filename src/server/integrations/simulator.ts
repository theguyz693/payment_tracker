// Builds provider-shaped payloads for the simulators, signs them like a real
// webhook would be signed, and delivers them through the same pipeline as
// the public webhook route. Nothing here contacts an external service.

import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { PaymentStatus, ProviderId } from "@/lib/integrations/types";
import type { ISODate } from "@/lib/types";
import { receiveDelivery, type DeliveryResult } from "./pipeline";
import { signDelivery } from "./signature";

export interface DemoOptions {
  failFirstAttempts?: number;
  simulateCrash?: boolean;
}

const demoBlock = (d?: DemoOptions) =>
  d && (d.failFirstAttempts || d.simulateCrash) ? { demo: { failFirstAttempts: d.failFirstAttempts ?? 0, simulateCrash: d.simulateCrash ?? false } } : {};

/** 150000 paise -> "1500.00" without floating point. */
export function rupeeString(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

const shortId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export function newAccountRef(provider: ProviderId): string {
  return `acct_${provider.replace("_sim", "")}_${randomBytes(9).toString("base64url")}`;
}

// ---- Payload builders (one shape per simulated provider) ----

export interface UpiInput {
  flow: "debit" | "credit";
  name: string;
  vpa: string | null;
  amountPaise: number;
  note: string | null;
  category: string | null;
  status: PaymentStatus;
}

export function buildUpi(provider: "gpay_sim", accountRef: string, u: UpiInput, demo?: DemoOptions): ReturnType<typeof gpayPayment>;
export function buildUpi(provider: "phonepe_sim", accountRef: string, u: UpiInput, demo?: DemoOptions): ReturnType<typeof phonepePayment>;
export function buildUpi(provider: "gpay_sim" | "phonepe_sim", accountRef: string, u: UpiInput, demo?: DemoOptions): ReturnType<typeof gpayPayment> | ReturnType<typeof phonepePayment>;
export function buildUpi(provider: "gpay_sim" | "phonepe_sim", accountRef: string, u: UpiInput, demo?: DemoOptions) {
  return provider === "gpay_sim" ? gpayPayment(accountRef, u, demo) : phonepePayment(accountRef, u, demo);
}

function gpayPayment(accountRef: string, u: UpiInput, demo?: DemoOptions) {
  return {
    id: shortId("gpay_evt"),
    type: u.flow === "debit" ? "PAYMENT_SENT" : "PAYMENT_RECEIVED",
    account: accountRef,
    created: new Date().toISOString(),
    data: {
      txn_ref: shortId("GPSIM"),
      amount: { value: rupeeString(u.amountPaise), currency: "INR" },
      counterparty: { name: u.name, vpa: u.vpa },
      note: u.note,
      ...(u.category ? { category: u.category } : {}),
      state: { SUCCESS: "SUCCESS", FAILED: "FAILURE", PENDING: "PENDING" }[u.status],
    },
    ...demoBlock(demo),
  };
}

function phonepePayment(accountRef: string, u: UpiInput, demo?: DemoOptions) {
  return {
    eventId: shortId("PPEVT"),
    eventType: u.flow === "debit" ? "UPI_DEBIT" : "UPI_CREDIT",
    merchantUserId: accountRef,
    timestamp: Date.now(),
    payload: {
      transactionId: shortId("PPSIM"),
      amountPaise: u.amountPaise,
      counterpartyName: u.name,
      counterpartyVpa: u.vpa,
      remarks: u.note,
      ...(u.category ? { category: u.category } : {}),
      code: { SUCCESS: "PAYMENT_SUCCESS", FAILED: "PAYMENT_ERROR", PENDING: "PAYMENT_PENDING" }[u.status],
    },
    ...demoBlock(demo),
  };
}

export function buildUpiStatus(provider: "gpay_sim" | "phonepe_sim", accountRef: string, paymentRef: string, status: "SUCCESS" | "FAILED") {
  if (provider === "gpay_sim") {
    return {
      id: `gpay_evt_status_${paymentRef}_${status}`.slice(0, 80),
      type: "PAYMENT_STATUS",
      account: accountRef,
      created: new Date().toISOString(),
      data: { txn_ref: paymentRef, state: status === "SUCCESS" ? "SUCCESS" : "FAILURE" },
    };
  }
  return {
    eventId: `PPSTATUS_${paymentRef}_${status}`.slice(0, 80),
    eventType: "UPI_STATUS",
    merchantUserId: accountRef,
    timestamp: Date.now(),
    payload: { transactionId: paymentRef, code: status === "SUCCESS" ? "PAYMENT_SUCCESS" : "PAYMENT_ERROR" },
  };
}

export function buildRequest(accountRef: string, r: { name: string; vpa: string | null; amountPaise: number; message: string | null }, demo?: DemoOptions) {
  return {
    id: shortId("req_evt"),
    type: "COLLECT_REQUEST",
    account: accountRef,
    created_at: new Date().toISOString(),
    request: { ref: shortId("COLLECT"), from: { name: r.name, vpa: r.vpa }, amount: rupeeString(r.amountPaise), message: r.message },
    ...demoBlock(demo),
  };
}

/**
 * Debit attempts get deterministic event ids (mandate + due date + attempt
 * number), so triggering the same attempt twice is a duplicate delivery.
 */
export function buildMandateDebit(
  accountRef: string,
  m: { mandateId: string; dueDate: ISODate; attemptNo: number; amountPaise: number; result: PaymentStatus; failureReason?: string | null; update?: boolean },
  demo?: DemoOptions,
) {
  const base = `${m.mandateId}_${m.dueDate.replaceAll("-", "")}_${m.attemptNo}`;
  return {
    event_id: m.update ? `apupd_${base}_${m.result}` : `apdebit_${base}`,
    type: m.update ? "MANDATE_DEBIT_UPDATE" : "MANDATE_DEBIT",
    account: accountRef,
    occurred_at: new Date().toISOString(),
    mandate_ref: m.mandateId,
    due_date: m.dueDate,
    attempt: m.attemptNo,
    amount: rupeeString(m.amountPaise),
    result: m.result,
    failure_reason: m.result === "FAILED" ? (m.failureReason ?? "Insufficient balance (simulated)") : null,
    ...demoBlock(demo),
  };
}

export interface TradeInput {
  symbol: string;
  name: string;
  segment: "EQ" | "MF" | "ETF";
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  charges: string;
  tradeDate: ISODate;
  sipDate: ISODate | null;
}

export function buildTrade(accountRef: string, t: TradeInput, demo?: DemoOptions) {
  return {
    event_id: shortId("groww_evt"),
    event: "ORDER_EXECUTED",
    client_id: accountRef,
    executed_at: new Date().toISOString(),
    order: {
      order_id: shortId("GRWSIM"),
      instrument: { symbol: t.symbol, name: t.name, segment: t.segment },
      transaction_type: t.side,
      quantity: t.quantity,
      average_price: t.price,
      charges: t.charges || "0",
      trade_date: t.tradeDate,
      sip_date: t.sipDate,
    },
    ...demoBlock(demo),
  };
}

/** Sign and deliver a payload through the common pipeline, as the signed-in user. */
export async function deliver(provider: ProviderId, payload: unknown, ctx: { userId: string; today: ISODate; requestId: string }): Promise<DeliveryResult> {
  return deliverBody(provider, JSON.stringify(payload), ctx);
}

/** Re-deliver an exact body (used to demonstrate duplicate detection). */
export async function deliverBody(provider: ProviderId, body: string, ctx: { userId: string; today: ISODate; requestId: string }): Promise<DeliveryResult> {
  const timestamp = Math.floor(Date.now() / 1000);
  return receiveDelivery({
    provider,
    body,
    timestamp: String(timestamp),
    signature: signDelivery(body, timestamp),
    source: "SIMULATOR",
    sessionUserId: ctx.userId,
    today: ctx.today,
    requestId: ctx.requestId,
  });
}
