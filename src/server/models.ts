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
// Every user-owned document carries `userId`, and every query filters on it.
// Creates carry a client-generated `requestId`; a unique index on
// (userId, requestId) turns a double-submit into a no-op.
//
// Categories are the fixed defaults in src/lib/types.ts, referenced by id
// ("PAY:Rent"). A per-user `categories` collection can be added later.

import "server-only";
import type { Collection, ObjectId } from "mongodb";
import type { GoalPlan, GoalPriority } from "@/lib/goals";
import type { AssetType, GoldDetails, InvTxnType, SipPlan } from "@/lib/portfolio";
import type { Direction, Frequency, ISODate, StoredStatus } from "@/lib/types";
import { getDb } from "./mongo";

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
}

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
