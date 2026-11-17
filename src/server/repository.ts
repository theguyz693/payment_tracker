// Data access. The only module that queries the transactions collection.
//
// SECURITY: every function takes the authenticated `userId` as its first
// argument and includes it in every filter. Callers get it from
// requireUser() in src/server/session.ts — never from request input.

import "server-only";
import { ObjectId, type ClientSession, type Filter } from "mongodb";
import { resumeDueDate, settle } from "@/lib/recurrence";
import { CATEGORIES, findCategory, type Category, type ISODate, type Settlement, type Transaction } from "@/lib/types";
import type { TransactionInput } from "@/lib/validation";
import { StaleWriteError, UserError } from "./errors";
import { isDuplicateKey, transactionsCollection, type TransactionDoc, type TransactionSource } from "./models";

export { UserError } from "./errors";

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
    paused: !!doc.pausedAt,
    amountChanges: (doc.amountChanges ?? []).map(({ fromPaise, toPaise, changedOn }) => ({ fromPaise, toPaise, changedOn })),
    loanId: doc.loanId ? doc.loanId.toHexString() : null,
    version: String(doc.updatedAt.getTime()),
    source: doc.source ? toSource(doc.source) : null,
  };
}

function toSource(s: TransactionSource): NonNullable<Transaction["source"]> {
  if (s.kind === "integration") return { kind: "integration", ref: s.eventId.toHexString(), provider: s.provider };
  if (s.kind === "payment_request") return { kind: "payment_request", ref: s.requestId.toHexString() };
  return { kind: "mandate", ref: s.mandateId.toHexString() };
}

function toSettlements(doc: TransactionDoc): Settlement[] {
  const category = findCategory(doc.categoryId) ?? OTHER[doc.direction];
  return doc.history.map((h, i) => ({
    id: h.entryId ? h.entryId.toHexString() : `${doc._id.toHexString()}-${i}`,
    transactionId: doc._id.toHexString(),
    title: doc.title,
    direction: doc.direction,
    categoryId: category.id,
    categoryName: category.name,
    counterparty: doc.counterparty,
    notes: doc.notes,
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
  let docs = await transactionsCollection().find(filter).sort({ dueDate: 1, _id: 1 }).toArray();
  if (docs.some((d) => d.history.some((h) => !h.entryId))) {
    await backfillEntryIds(userId, docs);
    docs = await transactionsCollection().find(filter).sort({ dueDate: 1, _id: 1 }).toArray();
  }
  return {
    transactions: docs.map(toTransaction),
    settlements: docs
      .filter((d) => d.archivedAt === null)
      .flatMap(toSettlements)
      .sort((a, b) => b.settledOn.localeCompare(a.settledOn)),
  };
}

/**
 * Migration: give every history entry a stable `entryId`.
 * Each entry is updated by position, guarded so it only applies if that slot
 * still holds the same entry and has no id yet. Safe to run concurrently or
 * repeatedly, and it never rewrites the array.
 */
async function backfillEntryIds(userId: string, docs: TransactionDoc[]): Promise<void> {
  const col = transactionsCollection();
  for (const doc of docs) {
    for (let i = 0; i < doc.history.length; i++) {
      const h = doc.history[i];
      if (h.entryId) continue;
      await col.updateOne(
        {
          _id: doc._id,
          userId,
          [`history.${i}.entryId`]: { $exists: false },
          [`history.${i}.dueDate`]: h.dueDate,
          [`history.${i}.settledOn`]: h.settledOn,
        },
        { $set: { [`history.${i}.entryId`]: new ObjectId() } },
      );
    }
  }
}

/** One settlement (for receipts), looked up by its stable entry id. */
export async function getSettlement(userId: string, entryId: string): Promise<Settlement | null> {
  const _id = toObjectId(entryId);
  if (!_id) return null;
  const doc = await transactionsCollection().findOne({ userId, "history.entryId": _id });
  if (!doc) return null;
  return toSettlements(doc).find((s) => s.id === entryId) ?? null;
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
    .map((h, i) => ({
      id: h.entryId ? h.entryId.toHexString() : `idx-${i}`,
      /** Receipts need the stable id; older entries get one on the next overview load. */
      entryId: h.entryId ? h.entryId.toHexString() : null,
      amountPaise: h.amountPaise,
      dueDate: h.dueDate,
      settledOn: h.settledOn,
    }))
    .sort((a, b) => b.settledOn.localeCompare(a.settledOn));
}

// ---- Writes ----

function assertCategoryMatches(input: TransactionInput) {
  const category = findCategory(input.categoryId);
  if (!category || category.direction !== input.direction) {
    throw new UserError("Pick a category that matches pay / receive.");
  }
}

export interface WriteOpts {
  /** MongoDB session when the write is part of a multi-document transaction. */
  session?: ClientSession;
}

export async function createTransaction(
  userId: string,
  input: TransactionInput,
  opts: { requestId?: string; loanId?: ObjectId; source?: TransactionSource } & WriteOpts = {},
): Promise<string> {
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
    pausedAt: null,
    amountChanges: [],
    loanId: opts.loanId ?? null,
    source: opts.source ?? null,
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
  };
  return insertOnce(userId, doc, opts);
}

/**
 * Insert a transaction once per requestId. Inside a MongoDB transaction a
 * duplicate-key error would abort the whole transaction, so check first
 * (a concurrent insert then surfaces as a write conflict, which retries).
 */
async function insertOnce(userId: string, doc: Omit<TransactionDoc, "_id">, opts: { requestId?: string } & WriteOpts): Promise<string> {
  const { session } = opts;
  if (session && opts.requestId) {
    const existing = await transactionsCollection().findOne({ userId, requestId: opts.requestId }, { session, projection: { _id: 1 } });
    if (existing) return existing._id.toHexString();
  }
  try {
    const res = await transactionsCollection().insertOne(doc as TransactionDoc, { session });
    return res.insertedId.toHexString();
  } catch (e) {
    // Same form submitted twice: return the item the first submit created.
    if (!session && opts.requestId && isDuplicateKey(e)) {
      const existing = await transactionsCollection().findOne({ userId, requestId: opts.requestId });
      if (existing) return existing._id.toHexString();
    }
    throw e;
  }
}

/**
 * Record a one-time payment that has already happened (status PAID/RECEIVED,
 * with its settlement in history) in a single insert. Used by integration
 * events and accepted payment requests: the money moved at the provider.
 */
export async function recordSettledTransaction(
  userId: string,
  input: Omit<TransactionInput, "frequency" | "startDate" | "endDate">,
  opts: { requestId: string; settledOn: ISODate; source: TransactionSource } & WriteOpts,
): Promise<string> {
  assertCategoryMatches({ ...input, frequency: "ONE_TIME", startDate: input.dueDate, endDate: null });
  const now = new Date();
  const doc: Omit<TransactionDoc, "_id"> = {
    userId,
    title: input.title,
    amountPaise: input.amount,
    direction: input.direction,
    frequency: "ONE_TIME",
    categoryId: input.categoryId,
    counterparty: input.counterparty,
    notes: input.notes,
    startDate: input.dueDate,
    anchorDate: input.dueDate,
    dueDate: input.dueDate,
    endDate: null,
    status: input.direction === "PAY" ? "PAID" : "RECEIVED",
    archivedAt: null,
    history: [{ entryId: new ObjectId(), dueDate: input.dueDate, settledOn: opts.settledOn, amountPaise: input.amount, createdAt: now }],
    createdAt: now,
    updatedAt: now,
    pausedAt: null,
    amountChanges: [],
    loanId: null,
    source: opts.source,
    requestId: opts.requestId,
  };
  return insertOnce(userId, doc, opts);
}

export async function updateTransaction(
  userId: string,
  id: string,
  input: TransactionInput,
  today: ISODate,
  opts: { expectedVersion?: string } = {},
): Promise<void> {
  const _id = toObjectId(id);
  const existing = _id ? await transactionsCollection().findOne({ _id, userId }) : null;
  if (!_id || !existing) throw new UserError("This item no longer exists.");
  // Optimistic concurrency: the form carries the version it was opened with.
  if (opts.expectedVersion && opts.expectedVersion !== String(existing.updatedAt.getTime())) throw staleEdit();
  assertCategoryMatches(input);
  const recurring = input.frequency !== "ONE_TIME";

  // Re-anchor the schedule only when the user actually changed it.
  const scheduleChanged = existing.dueDate !== input.dueDate || existing.frequency !== input.frequency;
  // Keep PAID/RECEIVED consistent if the direction is flipped on a settled item.
  const status = existing.status === "PENDING" ? "PENDING" : input.direction === "PAY" ? "PAID" : "RECEIVED";

  // The write only applies if nothing changed since the read above, so a
  // settlement that happens in between can never be undone by this edit.
  const res = await transactionsCollection().updateOne(
    { _id, userId, updatedAt: existing.updatedAt, dueDate: existing.dueDate, status: existing.status },
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
      // Price-change history: record every amount edit.
      ...(existing.amountPaise !== input.amount
        ? {
            $push: {
              amountChanges: { fromPaise: existing.amountPaise, toPaise: input.amount, changedOn: today, at: new Date() },
            },
          }
        : {}),
    },
  );
  if (res.matchedCount !== 1) throw staleEdit();
}

function staleEdit() {
  return new StaleWriteError("This item changed since you opened it (it may have been marked paid). Reload to see the latest version, then edit again.");
}

/** What happened when settling an occurrence. */
export type SettleOutcome = "settled" | "already_settled" | "not_found" | "archived" | "paused" | "changed";

/**
 * Mark the current occurrence as paid/received: append to history and, for
 * recurring items, move to the next occurrence — in ONE atomic update.
 * The filter on `dueDate` makes a double-click (or two devices) a no-op, and
 * the result says which of those happened.
 */
export async function settleOccurrence(
  userId: string,
  id: string,
  expectedDueDate: ISODate,
  settledOn: ISODate,
  opts: WriteOpts = {},
): Promise<{ outcome: SettleOutcome; tx: Transaction | null }> {
  const { session } = opts;
  const _id = toObjectId(id);
  if (!_id) return { outcome: "not_found", tx: null };
  const col = transactionsCollection();
  const item = await col.findOne({ _id, userId }, { session });
  if (!item) return { outcome: "not_found", tx: null };

  let modified = false;
  if (item.status === "PENDING" && item.archivedAt === null && !item.pausedAt && item.dueDate === expectedDueDate) {
    const result = settle(item);
    const res = await col.updateOne(
      // `pausedAt: null` also matches documents created before pausing existed.
      { _id, userId, status: "PENDING", archivedAt: null, pausedAt: null, dueDate: expectedDueDate, amountPaise: item.amountPaise },
      {
        $set: { dueDate: result.dueDate, status: result.status, updatedAt: new Date() },
        $push: {
          history: {
            entryId: new ObjectId(),
            dueDate: result.settledDueDate,
            settledOn,
            amountPaise: item.amountPaise,
            createdAt: new Date(),
          },
        },
      },
      { session },
    );
    modified = res.modifiedCount === 1;
  }
  const updated = await col.findOne({ _id, userId }, { session });
  if (!updated) return { outcome: "not_found", tx: null };
  const tx = toTransaction(updated);
  if (modified) return { outcome: "settled", tx };
  if (updated.history.some((h) => h.dueDate === expectedDueDate)) return { outcome: "already_settled", tx };
  if (updated.archivedAt !== null) return { outcome: "archived", tx };
  if (updated.pausedAt) return { outcome: "paused", tx };
  return { outcome: "changed", tx };
}

/** Compatibility wrapper: the item after settling (or after the no-op), null if it isn't the caller's. */
export async function settleTransaction(userId: string, id: string, expectedDueDate: ISODate, settledOn: ISODate): Promise<Transaction | null> {
  return (await settleOccurrence(userId, id, expectedDueDate, settledOn)).tx;
}

/** Soft delete: the document and its history stay in the database. */
export async function archiveTransaction(userId: string, id: string, opts: WriteOpts = {}): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await transactionsCollection().updateOne({ _id, userId }, { $set: { archivedAt: new Date(), updatedAt: new Date() } }, { session: opts.session });
  return res.matchedCount === 1;
}

export async function restoreTransaction(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await transactionsCollection().updateOne({ _id, userId }, { $set: { archivedAt: null, updatedAt: new Date() } });
  return res.matchedCount === 1;
}

/** Pause a recurring item: no upcoming occurrences, never overdue, can't be settled. */
export async function pauseTransaction(userId: string, id: string, opts: WriteOpts = {}): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await transactionsCollection().updateOne(
    { _id, userId, archivedAt: null, status: "PENDING", frequency: { $ne: "ONE_TIME" }, pausedAt: null },
    { $set: { pausedAt: new Date(), updatedAt: new Date() } },
    { session: opts.session },
  );
  return res.matchedCount === 1;
}

/** Resume a paused item at its next occurrence on/after today (missed ones are skipped, not owed). */
export async function resumeTransaction(userId: string, id: string, today: ISODate, opts: WriteOpts = {}): Promise<ISODate> {
  const { session } = opts;
  const _id = toObjectId(id);
  const item = _id ? await transactionsCollection().findOne({ _id, userId, archivedAt: null }, { session }) : null;
  if (!_id || !item) throw new UserError("This item no longer exists.");
  if (!item.pausedAt) return item.dueDate;
  const due = resumeDueDate(item, today);
  if (!due) throw new UserError("This item has no occurrences left before its end date. Edit the end date to resume it.");
  const res = await transactionsCollection().updateOne(
    { _id, userId, pausedAt: item.pausedAt },
    { $set: { pausedAt: null, dueDate: due, updatedAt: new Date() } },
    { session },
  );
  if (res.matchedCount !== 1) throw new StaleWriteError("This item changed while resuming. Reload and try again.");
  return due;
}

/** One raw item (for processors that need its current due date). */
export async function getTransactionDoc(userId: string, id: ObjectId, opts: WriteOpts = {}): Promise<TransactionDoc | null> {
  return transactionsCollection().findOne({ _id: id, userId }, { session: opts.session });
}
