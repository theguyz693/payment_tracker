// MongoDB collections and document shapes.
//
// Collections
// - user, session, account, verification, rateLimit
//     Owned by Better Auth (see src/server/auth.ts). Password hashes live in
//     `account` and are never read by app code.
// - transactions
//     One document per item (one-time or recurring), always owned by a user.
//     `history` holds each paid/received occurrence, embedded so that marking
//     an item paid is a single atomic update (no multi-document transaction).
// - userSettings     one per user: starting cash balance for forecasts/net worth
// - goals            savings goals with an embedded entry ledger
// - loans            loan terms + embedded prepayments; EMI payments live on the
//                    linked recurring transaction (no duplicate obligations)
// - holdings         investments (MF/SIP, stock, ETF, gold, other)
// - investmentTxns   buys/sells/dividends per holding (one document each)
// - prices           cached market prices (shared, not user data)
// - priceHistory     one price per instrument per day (shared)
//
// Reliability / integrations (see docs/INTEGRATIONS.md)
// - idempotencyKeys      one record per (user, operation, client key); TTL
// - integrationEvents    every delivery from a (simulated) provider, unique
//                        per (user, provider, externalEventId)
// - integrationConnections  demo provider "accounts" (no real credentials)
// - paymentRequests      incoming collect requests (accept / reject)
// - mandates, mandateAttempts  simulated autopay; successes settle the
//                        mandate's linked recurring transaction
// - auditLog             append-only record of financial side effects
// - apiRateLimits        fixed-window counters (TTL)
// - gatekeeperRejections rejected requests, for monitoring (TTL)
//
// Every user-owned document carries `userId`, and every query filters on it.
// Creates carry a client-generated `requestId`; a unique index on
// (userId, requestId) turns a double-submit into a no-op.
//
// Categories are the fixed defaults in src/lib/types.ts, referenced by id
// ("PAY:Rent"). A per-user `categories` collection can be added later.

import "server-only";
import type { ClientSession, Collection, ObjectId } from "mongodb";
import type { GoalPlan, GoalPriority } from "@/lib/goals";
import type { AssetType, GoldDetails, InvTxnType, SipPlan } from "@/lib/portfolio";
import type { Direction, Frequency, ISODate, StoredStatus } from "@/lib/types";
import type { EventStatus, EventType, ProviderId } from "@/lib/integrations/types";
import { getDb, getMongoClient } from "./mongo";

export interface HistoryEntry {
  /** Stable id. Older entries get one from the backfill in repository.ts. */
  entryId?: ObjectId;
  dueDate: ISODate; // which occurrence was settled
  settledOn: ISODate; // date the money moved
  amountPaise: number;
  createdAt: Date;
}

export interface AmountChangeDoc {
  fromPaise: number;
  toPaise: number;
  changedOn: ISODate;
  at: Date;
}

export interface TransactionDoc {
  _id: ObjectId;
  userId: string; // Better Auth user id — every query filters on this
  title: string;
  amountPaise: number; // integer paise (₹1 = 100)
  direction: Direction;
  frequency: Frequency;
  categoryId: string;
  counterparty: string | null;
  notes: string | null;
  startDate: ISODate;
  anchorDate: ISODate; // first due date; recurrence is computed from it
  dueDate: ISODate; // next unsettled occurrence
  endDate: ISODate | null;
  status: StoredStatus; // OVERDUE is derived from dueDate, never stored
  archivedAt: Date | null; // soft delete
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
  // Added for the Command Centre; optional so older documents stay valid.
  pausedAt?: Date | null;
  amountChanges?: AmountChangeDoc[];
  loanId?: ObjectId | null;
  requestId?: string;
  /** Where the item came from when it wasn't typed in by the user. */
  source?: TransactionSource | null;
}

export type TransactionSource =
  | { kind: "integration"; provider: ProviderId; eventId: ObjectId }
  | { kind: "payment_request"; requestId: ObjectId }
  | { kind: "mandate"; mandateId: ObjectId };

export interface UserSettingsDoc {
  _id: ObjectId;
  userId: string;
  /** Cash the user had on `cashAsOf` (all accounts combined). */
  cashBalancePaise: number | null;
  cashAsOf: ISODate | null;
  updatedAt: Date;
}

export interface GoalEntryDoc {
  _id: ObjectId;
  type: "CONTRIBUTION" | "WITHDRAWAL";
  amountPaise: number;
  date: ISODate;
  note: string | null;
  requestId: string;
  createdAt: Date;
}

export interface GoalDoc {
  _id: ObjectId;
  userId: string;
  name: string;
  description: string | null;
  targetPaise: number;
  targetDate: ISODate | null;
  priority: GoalPriority;
  category: string;
  plan: GoalPlan | null;
  entries: GoalEntryDoc[];
  archivedAt: Date | null;
  requestId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrepaymentDoc {
  _id: ObjectId;
  date: ISODate;
  amountPaise: number;
  requestId: string;
  createdAt: Date;
}

export interface LoanDoc {
  _id: ObjectId;
  userId: string;
  name: string;
  lender: string | null;
  principalPaise: number;
  annualRateBps: number;
  tenureMonths: number;
  firstEmiDate: ISODate;
  emiPaise: number;
  /** EMIs paid before the loan was added here (not in any history). */
  paidBeforeTracking: number;
  prepayments: PrepaymentDoc[];
  /** Recurring PAY item that tracks the EMI payments. */
  transactionId: ObjectId | null;
  archivedAt: Date | null;
  requestId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PriceProvider = "AMFI" | "ALPHAVANTAGE";

export interface HoldingDoc {
  _id: ObjectId;
  userId: string;
  type: AssetType;
  name: string;
  symbol: string | null;
  provider: PriceProvider | null;
  providerKey: string | null; // AMFI scheme code or exchange symbol
  sip: SipPlan | null;
  gold: GoldDetails | null;
  manualPrice: { price4: number; asOf: ISODate; setAt: Date } | null;
  notes: string | null;
  archivedAt: Date | null;
  requestId?: string;
  /** Bumped by every trade write; serialises concurrent sells (see investments-repo). */
  txnSeq?: number;
  /** "groww_sim:NIFTYBEES" for holdings created by an import. */
  importKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvTxnDoc {
  _id: ObjectId;
  userId: string;
  holdingId: ObjectId;
  type: InvTxnType;
  date: ISODate;
  qtyMicro: number | null;
  price4: number | null;
  amountPaise: number;
  feePaise: number;
  sipFor: ISODate | null;
  note: string | null;
  requestId: string;
  createdAt: Date;
}

export interface PriceDoc {
  _id: string; // `${provider}:${key}`
  price4: number;
  asOf: ISODate;
  source: string;
  fetchedAt: Date;
}

export interface PriceHistoryDoc {
  _id: ObjectId;
  key: string;
  date: ISODate;
  price4: number;
}

// ---- Reliability and integrations ----

export type IdempotencyStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface IdempotencyKeyDoc {
  _id: ObjectId;
  userId: string;
  scope: string;
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  lockedUntil: Date;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export interface EventAttempt {
  n: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  result: "PROCESSED" | "FAILED" | "RETRY_PENDING" | "ABANDONED";
  error: string | null;
}

export interface IntegrationEventDoc {
  _id: ObjectId;
  userId: string;
  provider: ProviderId;
  connectionId: ObjectId;
  externalEventId: string;
  eventType: EventType;
  direction: "INBOUND" | "OUTBOUND";
  source: "SIMULATOR" | "WEBHOOK";
  /** Validated, normalised payload (amounts in paise; no secrets). */
  normalizedPayload: Record<string, unknown>;
  /** The delivered body, kept so a delivery can be replayed (simulated data only, capped). */
  rawBody: string;
  payloadHash: string;
  amountPaise: number | null;
  status: EventStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError: { category: string; message: string } | null;
  outcome: { code: string; message: string } | null;
  linked: { kind: "transaction" | "holding" | "paymentRequest" | "mandateAttempt"; id: string } | null;
  /** Payment status for payment events (SUCCESS / PENDING / FAILED), kept current by status updates. */
  paymentStatus: "SUCCESS" | "PENDING" | "FAILED" | null;
  attempts: EventAttempt[];
  duplicateCount: number;
  lastDuplicateAt: Date | null;
  requestId: string;
  receivedAt: Date;
  processingStartedAt: Date | null;
  leaseUntil: Date | null;
  processedAt: Date | null;
  nextRetryAt: Date | null;
  durationMs: number | null;
}

export interface IntegrationConnectionDoc {
  _id: ObjectId;
  userId: string;
  provider: ProviderId;
  /** Random demo account reference the simulated provider puts in its payloads. */
  accountRef: string;
  status: "CONNECTED" | "DISCONNECTED";
  connectedAt: Date;
  updatedAt: Date;
}

export type PaymentRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED";

export interface PaymentRequestDoc {
  _id: ObjectId;
  userId: string;
  provider: ProviderId;
  externalRequestId: string;
  eventId: ObjectId;
  contactName: string;
  contactVpa: string | null;
  amountPaise: number;
  message: string | null;
  status: PaymentRequestStatus;
  transactionId: ObjectId | null;
  history: { status: PaymentRequestStatus; at: Date; requestId: string | null }[];
  createdAt: Date;
  decidedAt: Date | null;
}

export type MandateStatus = "ACTIVE" | "PAUSED" | "CANCELLED";

export interface MandateDoc {
  _id: ObjectId;
  userId: string;
  name: string;
  provider: ProviderId;
  payeeName: string;
  amountPaise: number;
  frequency: Exclude<Frequency, "ONE_TIME">;
  startDate: ISODate;
  endDate: ISODate | null;
  status: MandateStatus;
  /** Recurring PAY item whose occurrences successful debits settle (the single payment ledger). */
  transactionId: ObjectId;
  requestId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AttemptStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface MandateAttemptDoc {
  _id: ObjectId;
  userId: string;
  mandateId: ObjectId;
  dueDate: ISODate;
  attemptNo: number;
  status: AttemptStatus;
  eventId: ObjectId;
  failureReason: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface AuditDoc {
  _id: ObjectId;
  userId: string;
  at: Date;
  action: string;
  entity: { kind: string; id: string };
  requestId: string | null;
  eventId: ObjectId | null;
  summary: string;
}

export interface RateLimitDoc {
  _id: string;
  bucket: string;
  count: number;
  windowStart: Date;
  expiresAt: Date;
}

export interface RejectionDoc {
  _id: ObjectId;
  userId: string | null;
  reason: string;
  route: string;
  provider: string | null;
  at: Date;
  expiresAt: Date;
}

export function idempotencyCollection(): Collection<IdempotencyKeyDoc> {
  return getDb().collection<IdempotencyKeyDoc>("idempotencyKeys");
}
export function eventsCollection(): Collection<IntegrationEventDoc> {
  return getDb().collection<IntegrationEventDoc>("integrationEvents");
}
export function connectionsCollection(): Collection<IntegrationConnectionDoc> {
  return getDb().collection<IntegrationConnectionDoc>("integrationConnections");
}
export function paymentRequestsCollection(): Collection<PaymentRequestDoc> {
  return getDb().collection<PaymentRequestDoc>("paymentRequests");
}
export function mandatesCollection(): Collection<MandateDoc> {
  return getDb().collection<MandateDoc>("mandates");
}
export function attemptsCollection(): Collection<MandateAttemptDoc> {
  return getDb().collection<MandateAttemptDoc>("mandateAttempts");
}
export function auditCollection(): Collection<AuditDoc> {
  return getDb().collection<AuditDoc>("auditLog");
}
export function rateLimitsCollection(): Collection<RateLimitDoc> {
  return getDb().collection<RateLimitDoc>("apiRateLimits");
}
export function rejectionsCollection(): Collection<RejectionDoc> {
  return getDb().collection<RejectionDoc>("gatekeeperRejections");
}

/** Atlas (a replica set) supports multi-document transactions; a local standalone mongod does not. */
export function transactionsSupported(): boolean {
  return process.env.MONGODB_TRANSACTIONS !== "false";
}

/**
 * Run `fn` in a MongoDB multi-document transaction. The driver retries the
 * whole callback on transient errors (e.g. a write conflict with a concurrent
 * request), so `fn` must only have database side effects, all using `session`.
 * Without transaction support `fn` runs once with no session.
 */
export async function runInTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!transactionsSupported()) return fn(undefined);
  const session = getMongoClient().startSession();
  try {
    let out: T | undefined;
    await session.withTransaction(
      async () => {
        out = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" },
    );
    return out as T;
  } finally {
    await session.endSession();
  }
}

export function transactionsCollection(): Collection<TransactionDoc> {
  return getDb().collection<TransactionDoc>("transactions");
}
export function settingsCollection(): Collection<UserSettingsDoc> {
  return getDb().collection<UserSettingsDoc>("userSettings");
}
export function goalsCollection(): Collection<GoalDoc> {
  return getDb().collection<GoalDoc>("goals");
}
export function loansCollection(): Collection<LoanDoc> {
  return getDb().collection<LoanDoc>("loans");
}
export function holdingsCollection(): Collection<HoldingDoc> {
  return getDb().collection<HoldingDoc>("holdings");
}
export function invTxnsCollection(): Collection<InvTxnDoc> {
  return getDb().collection<InvTxnDoc>("investmentTxns");
}
export function pricesCollection(): Collection<PriceDoc> {
  return getDb().collection<PriceDoc>("prices");
}
export function priceHistoryCollection(): Collection<PriceHistoryDoc> {
  return getDb().collection<PriceHistoryDoc>("priceHistory");
}

/** Unique (userId, requestId) for documents created with a requestId. */
const requestIdIndex = [
  { userId: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: "string" } } },
] as const;

let indexesReady: Promise<void> | null = null;

/** Create indexes once per server process. Safe to call on every request. */
export function ensureIndexes(): Promise<void> {
  indexesReady ??= (async () => {
    const db = getDb();
    const tasks: Promise<unknown>[] = [
      transactionsCollection().createIndex({ userId: 1, dueDate: 1 }),
      transactionsCollection().createIndex({ userId: 1, archivedAt: 1 }),
      transactionsCollection().createIndex(...requestIdIndex),
      settingsCollection().createIndex({ userId: 1 }, { unique: true }),
      goalsCollection().createIndex({ userId: 1, archivedAt: 1 }),
      goalsCollection().createIndex(...requestIdIndex),
      loansCollection().createIndex({ userId: 1, archivedAt: 1 }),
      loansCollection().createIndex(...requestIdIndex),
      holdingsCollection().createIndex({ userId: 1, archivedAt: 1 }),
      holdingsCollection().createIndex(...requestIdIndex),
      invTxnsCollection().createIndex({ userId: 1, holdingId: 1, date: 1 }),
      invTxnsCollection().createIndex({ userId: 1, requestId: 1 }, { unique: true }),
      // One recorded instalment per SIP date per holding.
      invTxnsCollection().createIndex(
        { userId: 1, holdingId: 1, sipFor: 1 },
        { unique: true, partialFilterExpression: { sipFor: { $type: "string" } } },
      ),
      priceHistoryCollection().createIndex({ key: 1, date: 1 }, { unique: true }),
      // Reliability / integrations
      idempotencyCollection().createIndex({ userId: 1, scope: 1, key: 1 }, { unique: true }),
      idempotencyCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      eventsCollection().createIndex({ userId: 1, provider: 1, externalEventId: 1 }, { unique: true }),
      eventsCollection().createIndex({ userId: 1, receivedAt: -1 }),
      eventsCollection().createIndex({ userId: 1, status: 1, nextRetryAt: 1 }),
      eventsCollection().createIndex({ status: 1, leaseUntil: 1 }),
      connectionsCollection().createIndex({ userId: 1, provider: 1 }, { unique: true }),
      connectionsCollection().createIndex({ accountRef: 1 }, { unique: true }),
      paymentRequestsCollection().createIndex({ userId: 1, provider: 1, externalRequestId: 1 }, { unique: true }),
      paymentRequestsCollection().createIndex({ userId: 1, status: 1, createdAt: -1 }),
      mandatesCollection().createIndex({ userId: 1, status: 1 }),
      mandatesCollection().createIndex(...requestIdIndex),
      attemptsCollection().createIndex({ userId: 1, mandateId: 1, dueDate: 1, attemptNo: 1 }, { unique: true }),
      // At most one successful debit per mandate occurrence.
      attemptsCollection().createIndex(
        { userId: 1, mandateId: 1, dueDate: 1 },
        { unique: true, partialFilterExpression: { status: "SUCCESS" }, name: "one_success_per_due_date" },
      ),
      auditCollection().createIndex({ userId: 1, at: -1 }),
      rateLimitsCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      rejectionsCollection().createIndex({ userId: 1, at: -1 }),
      rejectionsCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      holdingsCollection().createIndex(
        { userId: 1, importKey: 1 },
        { unique: true, partialFilterExpression: { importKey: { $type: "string" } } },
      ),
      db.collection("user").createIndex({ email: 1 }, { unique: true }),
      db.collection("session").createIndex({ token: 1 }, { unique: true }),
      db.collection("session").createIndex({ userId: 1 }),
      db.collection("account").createIndex({ userId: 1 }),
      db.collection("verification").createIndex({ identifier: 1 }),
      db.collection("rateLimit").createIndex({ key: 1 }),
    ];
    const results = await Promise.allSettled(tasks);
    for (const r of results) if (r.status === "rejected") console.warn("[mongo] index creation failed:", r.reason);
  })().catch((e) => {
    indexesReady = null; // retry on next request
    console.error("[mongo] could not create indexes", e);
  });
  return indexesReady;
}

/** True for a duplicate-key error (a repeated requestId). */
export function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}
