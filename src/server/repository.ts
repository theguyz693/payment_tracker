// Data access. The only module that queries the transactions collection.
//
// SECURITY: every function takes the authenticated `userId` as its first
// argument and includes it in every filter. Callers get it from
// requireUser() in src/server/session.ts — never from request input.

import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { settle } from "@/lib/recurrence";
import { CATEGORIES, findCategory, type Category, type ISODate, type Settlement, type Transaction } from "@/lib/types";
import type { TransactionInput } from "@/lib/validation";
import { transactionsCollection, type TransactionDoc } from "./models";

const OTHER: Record<"PAY" | "RECEIVE", Category> = {
  PAY: findCategory("PAY:Other")!,
  RECEIVE: findCategory("RECEIVE:Other")!,
};

/** Parse a client-supplied id. Invalid ids simply match nothing. */
function toObjectId(id: string): ObjectId | null {
  return /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function toTransaction(doc: TransactionDoc): Transaction {
  const last = doc.history.reduce<ISODate | null>((m, h) => (!m || h.settledOn > m ? h.settledOn : m), null);
  const category = findCategory(doc.categoryId);
  return {
    id: doc._id.toHexString(),
    title: doc.title,
    amountPaise: doc.amountPaise,
    direction: doc.direction,
    frequency: doc.frequency,
    category: category && category.direction === doc.direction ? category : OTHER[doc.direction],
    counterparty: doc.counterparty,
    notes: doc.notes,
    startDate: doc.startDate,
    anchorDate: doc.anchorDate,
    dueDate: doc.dueDate,
    endDate: doc.endDate,
    status: doc.status,
    archived: doc.archivedAt !== null,
    lastSettledOn: last,
  };
}

function toSettlements(doc: TransactionDoc): Settlement[] {
  const category = findCategory(doc.categoryId) ?? OTHER[doc.direction];
  return doc.history.map((h, i) => ({
    id: `${doc._id.toHexString()}-${i}`,
    transactionId: doc._id.toHexString(),
    title: doc.title,
    direction: doc.direction,
    categoryName: category.name,
    amountPaise: h.amountPaise,
    dueDate: h.dueDate,
    settledOn: h.settledOn,
  }));
}

// ---- Reads ----

export function listCategories(): Category[] {
  return CATEGORIES;
}

/**
 * Everything the dashboard/summary need in one query: the user's items and
 * their settlement history (archived items excluded unless asked).
 */
export async function loadUserData(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<{ transactions: Transaction[]; settlements: Settlement[] }> {
  const filter: Filter<TransactionDoc> = opts.includeArchived ? { userId } : { userId, archivedAt: null };
  const docs = await transactionsCollection().find(filter).sort({ dueDate: 1, _id: 1 }).toArray();
  return {
    transactions: docs.map(toTransaction),
    settlements: docs
      .filter((d) => d.archivedAt === null)
      .flatMap(toSettlements)
      .sort((a, b) => b.settledOn.localeCompare(a.settledOn)),
  };
}

export async function getTransaction(userId: string, id: string): Promise<Transaction | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const doc = await transactionsCollection().findOne({ _id, userId });
  return doc ? toTransaction(doc) : null;
}

export async function getHistory(userId: string, id: string) {
  const _id = toObjectId(id);
  if (!_id) return [];
  const doc = await transactionsCollection().findOne({ _id, userId }, { projection: { history: 1 } });
  return (doc?.history ?? [])
    .map((h, i) => ({ id: String(i), amountPaise: h.amountPaise, dueDate: h.dueDate, settledOn: h.settledOn }))
    .sort((a, b) => b.settledOn.localeCompare(a.settledOn));
}

// ---- Writes ----

function assertCategoryMatches(input: TransactionInput) {
  const category = findCategory(input.categoryId);
  if (!category || category.direction !== input.direction) {
    throw new UserError("Pick a category that matches pay / receive.");
  }
}

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}

export async function createTransaction(userId: string, input: TransactionInput): Promise<string> {
  assertCategoryMatches(input);
  const recurring = input.frequency !== "ONE_TIME";
  const now = new Date();
  const doc: Omit<TransactionDoc, "_id"> = {
    userId,
    title: input.title,
    amountPaise: input.amount,
    direction: input.direction,
    frequency: input.frequency,
    categoryId: input.categoryId,
    counterparty: input.counterparty,
    notes: input.notes,
    startDate: recurring ? input.startDate : input.dueDate,
    anchorDate: input.dueDate,
    dueDate: input.dueDate,
    endDate: recurring ? input.endDate : null,
    status: "PENDING",
    archivedAt: null,
    history: [],
    createdAt: now,
    updatedAt: now,
  };
  const res = await transactionsCollection().insertOne(doc as TransactionDoc);
  return res.insertedId.toHexString();
}

export async function updateTransaction(userId: string, id: string, input: TransactionInput): Promise<void> {
  const _id = toObjectId(id);
  const existing = _id ? await transactionsCollection().findOne({ _id, userId }) : null;
  if (!_id || !existing) throw new UserError("This item no longer exists.");
  assertCategoryMatches(input);
  const recurring = input.frequency !== "ONE_TIME";

  // Re-anchor the schedule only when the user actually changed it.
  const scheduleChanged = existing.dueDate !== input.dueDate || existing.frequency !== input.frequency;
  // Keep PAID/RECEIVED consistent if the direction is flipped on a settled item.
  const status = existing.status === "PENDING" ? "PENDING" : input.direction === "PAY" ? "PAID" : "RECEIVED";

  await transactionsCollection().updateOne(
    { _id, userId },
    {
      $set: {
        title: input.title,
        amountPaise: input.amount,
        direction: input.direction,
        frequency: input.frequency,
        categoryId: input.categoryId,
        counterparty: input.counterparty,
        notes: input.notes,
        startDate: recurring ? input.startDate : input.dueDate,
        anchorDate: scheduleChanged ? input.dueDate : existing.anchorDate,
        dueDate: input.dueDate,
        endDate: recurring ? input.endDate : null,
        status,
        updatedAt: new Date(),
      },
    },
  );
}

/**
 * Mark the current occurrence as paid/received: append to history and, for
 * recurring items, move to the next occurrence — in ONE atomic update.
 * The filter on `dueDate` makes a double-click (or two devices) a no-op.
 */
export async function settleTransaction(
  userId: string,
  id: string,
  expectedDueDate: ISODate,
  settledOn: ISODate,
): Promise<Transaction | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const col = transactionsCollection();
  const item = await col.findOne({ _id, userId });
  if (!item) return null;

  if (item.status === "PENDING" && item.archivedAt === null && item.dueDate === expectedDueDate) {
    const result = settle(item);
    await col.updateOne(
      { _id, userId, status: "PENDING", archivedAt: null, dueDate: expectedDueDate },
      {
        $set: { dueDate: result.dueDate, status: result.status, updatedAt: new Date() },
        $push: {
          history: { dueDate: result.settledDueDate, settledOn, amountPaise: item.amountPaise, createdAt: new Date() },
        },
      },
    );
  }
  const updated = await col.findOne({ _id, userId });
  return updated ? toTransaction(updated) : null;
}

/** Soft delete: the document and its history stay in the database. */
export async function archiveTransaction(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await transactionsCollection().updateOne({ _id, userId }, { $set: { archivedAt: new Date(), updatedAt: new Date() } });
  return res.matchedCount === 1;
}

export async function restoreTransaction(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await transactionsCollection().updateOne({ _id, userId }, { $set: { archivedAt: null, updatedAt: new Date() } });
  return res.matchedCount === 1;
}
