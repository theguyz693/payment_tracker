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
//
// Categories are the fixed defaults in src/lib/types.ts, referenced by id
// ("PAY:Rent"). A per-user `categories` collection can be added later.

import "server-only";
import type { Collection, ObjectId } from "mongodb";
import type { Direction, Frequency, ISODate, StoredStatus } from "@/lib/types";
import { getDb } from "./mongo";

export interface HistoryEntry {
  dueDate: ISODate; // which occurrence was settled
  settledOn: ISODate; // date the money moved
  amountPaise: number;
  createdAt: Date;
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
}

export function transactionsCollection(): Collection<TransactionDoc> {
  return getDb().collection<TransactionDoc>("transactions");
}

let indexesReady: Promise<void> | null = null;

/** Create indexes once per server process. Safe to call on every request. */
export function ensureIndexes(): Promise<void> {
  indexesReady ??= (async () => {
    const db = getDb();
    const tasks: Promise<unknown>[] = [
      transactionsCollection().createIndex({ userId: 1, dueDate: 1 }),
      transactionsCollection().createIndex({ userId: 1, archivedAt: 1 }),
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
