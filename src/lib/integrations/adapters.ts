// Provider adapters: one per (simulated) provider, each with its own payload
// shape, all producing the common NormalizedEvent. Provider-specific parsing
// lives here and nowhere else (not in repositories, not in the processor).
//
// The payload shapes are invented for the simulators. They resemble the kind
// of webhook a payments or brokerage platform sends, but they are not any
// real provider's API.

import { z } from "zod";
import { isISODate } from "../dates";
import { parseDecimal } from "../decimal";
import { MAX_AMOUNT_PAISE, parseRupees } from "../money";
import { NO_DEMO, type DemoControls, type EventType, type NormalizedEvent, type PaymentStatus, type ProviderId } from "./types";

export interface ProviderAdapter {
  id: ProviderId;
  /** Validate a raw payload and convert it. Throws AdapterError with readable issues. */
  normalize(raw: unknown): NormalizedEvent;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

// ---- Shared field rules ----

const id = (max = 80) => z.string().trim().min(6).max(max).regex(/^[A-Za-z0-9_\-:.]+$/, "only letters, digits and _-:.");
const name = z.string().trim().min(1).max(80);
const vpa = z
  .string()
  .trim()
  .max(80)
  .regex(/^[\w.\-]{2,}@[A-Za-z][\w]{1,}$/, "must look like name@handle")
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const note = z
  .string()
  .trim()
  .max(140)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));
const isoDate = z.string().refine(isISODate, "must be a YYYY-MM-DD date");
const isoTime = z.string().datetime({ offset: true });
const rupees = z.string().transform((v, ctx) => {
  const p = parseRupees(v);
  if (p === null || p <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a positive amount with at most 2 decimals" });
    return z.NEVER;
  }
  return p;
});
const paise = z.number().int().positive().max(MAX_AMOUNT_PAISE);
const demo = z
  .object({ failFirstAttempts: z.number().int().min(0).max(3).default(0), simulateCrash: z.boolean().default(false) })
  .optional()
  .transform((d): DemoControls => d ?? NO_DEMO);

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown, provider: string): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).slice(0, 10);
    throw new AdapterError(`Invalid ${provider} payload`, issues);
  }
  return r.data;
}

// ---- Google Pay Simulator ----

const GPAY_STATE: Record<string, PaymentStatus> = { SUCCESS: "SUCCESS", FAILURE: "FAILED", PENDING: "PENDING" };

const gpaySchema = z.object({
  id: id(),
  type: z.enum(["PAYMENT_SENT", "PAYMENT_RECEIVED", "PAYMENT_STATUS"]),
  account: id(),
  created: isoTime,
  data: z.object({
    txn_ref: id(),
    amount: z.object({ value: rupees, currency: z.literal("INR") }).optional(),
    counterparty: z.object({ name, vpa }).optional(),
    note,
    category: z.string().max(60).optional(),
    state: z.enum(["SUCCESS", "FAILURE", "PENDING"]),
  }),
  demo,
});

const gpay: ProviderAdapter = {
  id: "gpay_sim",
  normalize(raw) {
    const p = parse(gpaySchema, raw, "Google Pay Simulator");
    const status = GPAY_STATE[p.data.state];
    if (p.type === "PAYMENT_STATUS") {
      return base("gpay_sim", p.id, "payment.status_update", p.account, p.created, null, { kind: "payment_status", paymentRef: p.data.txn_ref, status }, p.demo);
    }
    if (!p.data.amount || !p.data.counterparty) throw new AdapterError("Invalid Google Pay Simulator payload", ["data: amount and counterparty are required"]);
    return base(
      "gpay_sim",
      p.id,
      p.type === "PAYMENT_SENT" ? "payment.debit" : "payment.credit",
      p.account,
      p.created,
      p.data.amount.value,
      {
        kind: "payment",
        flow: p.type === "PAYMENT_SENT" ? "debit" : "credit",
        paymentRef: p.data.txn_ref,
        counterpartyName: p.data.counterparty.name,
        counterpartyVpa: p.data.counterparty.vpa,
        note: p.data.note,
        status,
        categoryHint: p.data.category ?? null,
      },
      p.demo,
    );
  },
};

// ---- PhonePe Simulator ----

const PHONEPE_CODE: Record<string, PaymentStatus> = { PAYMENT_SUCCESS: "SUCCESS", PAYMENT_ERROR: "FAILED", PAYMENT_PENDING: "PENDING" };

const phonepeSchema = z.object({
  eventId: id(),
  eventType: z.enum(["UPI_DEBIT", "UPI_CREDIT", "UPI_STATUS"]),
  merchantUserId: id(),
  timestamp: z.number().int().positive(),
  payload: z.object({
    transactionId: id(),
    amountPaise: paise.optional(),
    counterpartyName: name.optional(),
    counterpartyVpa: vpa,
    remarks: note,
    category: z.string().max(60).optional(),
    code: z.enum(["PAYMENT_SUCCESS", "PAYMENT_ERROR", "PAYMENT_PENDING"]),
  }),
  demo,
});

const phonepe: ProviderAdapter = {
  id: "phonepe_sim",
  normalize(raw) {
    const p = parse(phonepeSchema, raw, "PhonePe Simulator");
    const at = new Date(p.timestamp).toISOString();
    const status = PHONEPE_CODE[p.payload.code];
    if (p.eventType === "UPI_STATUS") {
      return base("phonepe_sim", p.eventId, "payment.status_update", p.merchantUserId, at, null, { kind: "payment_status", paymentRef: p.payload.transactionId, status }, p.demo);
    }
    if (!p.payload.amountPaise || !p.payload.counterpartyName) throw new AdapterError("Invalid PhonePe Simulator payload", ["payload: amountPaise and counterpartyName are required"]);
    const debit = p.eventType === "UPI_DEBIT";
    return base(
      "phonepe_sim",
      p.eventId,
      debit ? "payment.debit" : "payment.credit",
      p.merchantUserId,
      at,
      p.payload.amountPaise,
      {
        kind: "payment",
        flow: debit ? "debit" : "credit",
        paymentRef: p.payload.transactionId,
        counterpartyName: p.payload.counterpartyName,
        counterpartyVpa: p.payload.counterpartyVpa,
        note: p.payload.remarks,
        status,
        categoryHint: p.payload.category ?? null,
      },
      p.demo,
    );
  },
};

// ---- Groww Simulator ----

const SEGMENT: Record<string, "MF" | "STOCK" | "ETF"> = { MF: "MF", EQ: "STOCK", ETF: "ETF" };

const growwSchema = z.object({
  event_id: id(),
  event: z.literal("ORDER_EXECUTED"),
  client_id: id(),
  executed_at: isoTime,
  order: z.object({
    order_id: id(),
    instrument: z.object({
      symbol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.&\-_]+$/),
      name: name,
      segment: z.enum(["EQ", "MF", "ETF"]),
    }),
    transaction_type: z.enum(["BUY", "SELL"]),
    quantity: z.string(),
    average_price: z.string(),
    charges: z.string().default("0"),
    trade_date: isoDate,
    sip_date: isoDate.nullable().optional(),
  }),
  demo,
});

const groww: ProviderAdapter = {
  id: "groww_sim",
  normalize(raw) {
    const p = parse(growwSchema, raw, "Groww Simulator");
    const o = p.order;
    const qtyMicro = parseDecimal(o.quantity, 6);
    const price4 = parseDecimal(o.average_price, 4);
    const feePaise = parseRupees(o.charges);
    const issues: string[] = [];
    if (!qtyMicro) issues.push("order.quantity: must be a positive number with at most 6 decimals");
    if (!price4) issues.push("order.average_price: must be a positive number with at most 4 decimals");
    if (feePaise === null) issues.push("order.charges: must be an amount with at most 2 decimals");
    if (o.sip_date && (o.transaction_type !== "BUY" || o.instrument.segment !== "MF")) issues.push("order.sip_date: only for mutual fund purchases");
    if (issues.length) throw new AdapterError("Invalid Groww Simulator payload", issues);
    // Gross value in paise, rounded half up (price4 is 1/10,000 ₹, qty is 1e-6 units).
    const amountPaise = Number((BigInt(qtyMicro!) * BigInt(price4!) + 5_000_000n) / 10_000_000n);
    if (amountPaise <= 0 || amountPaise > MAX_AMOUNT_PAISE) throw new AdapterError("Invalid Groww Simulator payload", ["order: value is out of range"]);
    return base(
      "groww_sim",
      p.event_id,
      "investment.trade",
      p.client_id,
      p.executed_at,
      amountPaise,
      {
        kind: "trade",
        orderId: o.order_id,
        symbol: o.instrument.symbol.toUpperCase(),
        name: o.instrument.name,
        assetType: SEGMENT[o.instrument.segment],
        side: o.transaction_type,
        qtyMicro: qtyMicro!,
        price4: price4!,
        feePaise: feePaise!,
        tradeDate: o.trade_date,
        sipFor: o.sip_date ?? null,
      },
      p.demo,
    );
  },
};

// ---- Autopay Simulator ----

const autopaySchema = z.object({
  event_id: id(),
  type: z.enum(["MANDATE_DEBIT", "MANDATE_DEBIT_UPDATE"]),
  account: id(),
  occurred_at: isoTime,
  mandate_ref: z.string().regex(/^[a-f\d]{24}$/i, "must be a mandate id"),
  due_date: isoDate,
  attempt: z.number().int().min(1).max(10),
  amount: rupees,
  result: z.enum(["SUCCESS", "FAILED", "PENDING"]),
  failure_reason: z.string().trim().max(120).nullable().optional(),
  demo,
});

const autopay: ProviderAdapter = {
  id: "autopay_sim",
  normalize(raw) {
    const p = parse(autopaySchema, raw, "Autopay Simulator");
    const update = p.type === "MANDATE_DEBIT_UPDATE";
    if (update && p.result === "PENDING") throw new AdapterError("Invalid Autopay Simulator payload", ["result: an update must be SUCCESS or FAILED"]);
    return base(
      "autopay_sim",
      p.event_id,
      update ? "mandate.attempt_update" : "mandate.debit_attempt",
      p.account,
      p.occurred_at,
      p.amount,
      {
        kind: "mandate_attempt",
        mandateRef: p.mandate_ref.toLowerCase(),
        dueDate: p.due_date,
        attemptNo: p.attempt,
        status: p.result,
        failureReason: p.result === "FAILED" ? (p.failure_reason ?? "Debit declined") : null,
        update,
      },
      p.demo,
    );
  },
};

// ---- Payment Request Simulator ----

const requestsSchema = z.object({
  id: id(),
  type: z.literal("COLLECT_REQUEST"),
  account: id(),
  created_at: isoTime,
  request: z.object({ ref: id(), from: z.object({ name, vpa }), amount: rupees, message: note }),
  demo,
});

const requests: ProviderAdapter = {
  id: "requests_sim",
  normalize(raw) {
    const p = parse(requestsSchema, raw, "Payment Request Simulator");
    return base(
      "requests_sim",
      p.id,
      "payment_request.created",
      p.account,
      p.created_at,
      p.request.amount,
      { kind: "payment_request", requestRef: p.request.ref, contactName: p.request.from.name, contactVpa: p.request.from.vpa, message: p.request.message },
      p.demo,
    );
  },
};

function base(
  provider: ProviderId,
  externalEventId: string,
  eventType: EventType,
  accountRef: string,
  occurredAt: string,
  amountPaise: number | null,
  data: NormalizedEvent["data"],
  demo: DemoControls,
): NormalizedEvent {
  return { provider, externalEventId, eventType, accountRef, occurredAt, amountPaise, data, demo };
}

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  gpay_sim: gpay,
  phonepe_sim: phonepe,
  groww_sim: groww,
  autopay_sim: autopay,
  requests_sim: requests,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return ADAPTERS[provider];
}
