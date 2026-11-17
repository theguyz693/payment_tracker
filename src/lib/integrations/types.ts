// Common internal format for events from external financial providers.
//
// Every provider adapter (see ./adapters.ts) turns its own payload shape into
// a NormalizedEvent. The event processor only ever sees this format, so a
// future real provider plugs in by adding an adapter, not by changing the
// processor. Pure module: no database or Node-only imports.
//
// All providers in this version are SIMULATED. Nothing here talks to Google
// Pay, PhonePe, Groww, NPCI, a bank or a broker.

export const PROVIDER_IDS = ["gpay_sim", "phonepe_sim", "groww_sim", "autopay_sim", "requests_sim"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const EVENT_TYPES = [
  "payment.debit",
  "payment.credit",
  "payment.status_update",
  "payment_request.created",
  "mandate.debit_attempt",
  "mandate.attempt_update",
  "investment.trade",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ["RECEIVED", "PROCESSING", "PROCESSED", "FAILED", "RETRY_PENDING", "DUPLICATE"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type PaymentStatus = "SUCCESS" | "PENDING" | "FAILED";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: "UPI" | "INVESTMENT" | "AUTOPAY" | "REQUESTS";
  description: string;
  eventTypes: EventType[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gpay_sim: {
    id: "gpay_sim",
    name: "Google Pay Simulator",
    kind: "UPI",
    description: "Simulated UPI payments sent and received. Not connected to Google Pay.",
    eventTypes: ["payment.debit", "payment.credit", "payment.status_update"],
  },
  phonepe_sim: {
    id: "phonepe_sim",
    name: "PhonePe Simulator",
    kind: "UPI",
    description: "Simulated UPI payments sent and received. Not connected to PhonePe.",
    eventTypes: ["payment.debit", "payment.credit", "payment.status_update"],
  },
  groww_sim: {
    id: "groww_sim",
    name: "Groww Simulator",
    kind: "INVESTMENT",
    description: "Simulated executed orders (stocks, ETFs, mutual funds). Not connected to Groww.",
    eventTypes: ["investment.trade"],
  },
  autopay_sim: {
    id: "autopay_sim",
    name: "Autopay Simulator",
    kind: "AUTOPAY",
    description: "Simulated recurring debit mandates and debit attempts.",
    eventTypes: ["mandate.debit_attempt", "mandate.attempt_update"],
  },
  requests_sim: {
    id: "requests_sim",
    name: "Payment Request Simulator",
    kind: "REQUESTS",
    description: "Simulated collect requests from demo contacts.",
    eventTypes: ["payment_request.created"],
  },
};

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
}

/** Demo-only switches carried in simulated payloads (used to show failure handling). */
export interface DemoControls {
  /** The first N processing attempts fail with a transient error (after the business writes, so they roll back). */
  failFirstAttempts: number;
  /** Processing stops mid-way without recording an outcome, as if the server crashed. */
  simulateCrash: boolean;
}

export type EventData =
  | {
      kind: "payment";
      /** debit = money out of the user's account, credit = money in. */
      flow: "debit" | "credit";
      paymentRef: string;
      counterpartyName: string;
      counterpartyVpa: string | null;
      note: string | null;
      status: PaymentStatus;
      categoryHint: string | null;
    }
  | { kind: "payment_status"; paymentRef: string; status: PaymentStatus }
  | { kind: "payment_request"; requestRef: string; contactName: string; contactVpa: string | null; message: string | null }
  | {
      kind: "mandate_attempt";
      mandateRef: string;
      dueDate: string;
      attemptNo: number;
      status: PaymentStatus;
      failureReason: string | null;
      /** For attempt updates: resolves an earlier PENDING attempt. */
      update: boolean;
    }
  | {
      kind: "trade";
      orderId: string;
      symbol: string;
      name: string;
      assetType: "MF" | "STOCK" | "ETF";
      side: "BUY" | "SELL";
      qtyMicro: number;
      price4: number;
      feePaise: number;
      tradeDate: string;
      sipFor: string | null;
    };

export interface NormalizedEvent {
  provider: ProviderId;
  externalEventId: string;
  eventType: EventType;
  accountRef: string;
  occurredAt: string;
  /** Money moved or requested, in paise. Null when the event carries no amount. */
  amountPaise: number | null;
  data: EventData;
  demo: DemoControls;
}

export const NO_DEMO: DemoControls = { failFirstAttempts: 0, simulateCrash: false };

export function eventDirection(type: EventType): "INBOUND" | "OUTBOUND" {
  return type === "payment.debit" || type === "mandate.debit_attempt" ? "OUTBOUND" : "INBOUND";
}

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  "payment.debit": "UPI payment sent",
  "payment.credit": "UPI payment received",
  "payment.status_update": "Payment status update",
  "payment_request.created": "Payment request",
  "mandate.debit_attempt": "Autopay debit attempt",
  "mandate.attempt_update": "Autopay attempt update",
  "investment.trade": "Investment trade",
};

export const STATUS_LABEL: Record<EventStatus, string> = {
  RECEIVED: "Received",
  PROCESSING: "Processing",
  PROCESSED: "Processed",
  FAILED: "Failed",
  RETRY_PENDING: "Retry pending",
  DUPLICATE: "Duplicate",
};
