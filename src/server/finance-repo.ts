// Data access for user settings, savings goals and loans.
//
// SECURITY: every function takes the authenticated `userId` first and
// includes it in every filter (same rule as repository.ts).
// Ledgers (goal entries, prepayments) are append-only arrays updated with a
// single atomic $push guarded by requestId, so a retried submit is a no-op.

import "server-only";
import { ObjectId } from "mongodb";
import type { Goal, GoalPlan, GoalPriority } from "@/lib/goals";
import type { ISODate } from "@/lib/types";
import { goalsCollection, isDuplicateKey, loansCollection, settingsCollection, transactionsCollection, type GoalDoc, type LoanDoc } from "./models";
import { UserError } from "./repository";

function toObjectId(id: string): ObjectId | null {
  return /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null;
}

// ---------------- Settings ----------------

export interface UserSettings {
  cashBalancePaise: number | null;
  cashAsOf: ISODate | null;
}

export async function getSettings(userId: string): Promise<UserSettings> {
  const doc = await settingsCollection().findOne({ userId });
  return { cashBalancePaise: doc?.cashBalancePaise ?? null, cashAsOf: doc?.cashAsOf ?? null };
}

export async function saveSettings(userId: string, s: UserSettings): Promise<void> {
  await settingsCollection().updateOne(
    { userId },
    { $set: { cashBalancePaise: s.cashBalancePaise, cashAsOf: s.cashAsOf, updatedAt: new Date() }, $setOnInsert: { userId } },
    { upsert: true },
  );
}

// ---------------- Goals ----------------

function toGoal(d: GoalDoc): Goal {
  return {
    id: d._id.toHexString(),
    name: d.name,
    description: d.description,
    targetPaise: d.targetPaise,
    targetDate: d.targetDate,
    priority: d.priority,
    category: d.category,
    plan: d.plan,
    entries: d.entries
      .map((e) => ({ id: e._id.toHexString(), type: e.type, amountPaise: e.amountPaise, date: e.date, note: e.note }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    archived: d.archivedAt !== null,
  };
}

export async function listGoals(userId: string, opts: { includeArchived?: boolean } = {}): Promise<Goal[]> {
  const filter = opts.includeArchived ? { userId } : { userId, archivedAt: null };
  const docs = await goalsCollection().find(filter).sort({ targetDate: 1, _id: 1 }).toArray();
  return docs.map(toGoal);
}

export async function getGoal(userId: string, id: string): Promise<Goal | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const doc = await goalsCollection().findOne({ _id, userId });
  return doc ? toGoal(doc) : null;
}

export interface GoalInput {
  name: string;
  description: string | null;
  targetPaise: number;
  targetDate: ISODate | null;
  priority: GoalPriority;
  category: string;
  plan: GoalPlan | null;
  /** Amount already saved when the goal is created (recorded as the first entry). */
  initialPaise: number;
  today: ISODate;
}

export async function createGoal(userId: string, input: GoalInput, requestId: string): Promise<string> {
  const now = new Date();
  const doc: Omit<GoalDoc, "_id"> = {
    userId,
    name: input.name,
    description: input.description,
    targetPaise: input.targetPaise,
    targetDate: input.targetDate,
    priority: input.priority,
    category: input.category,
    plan: input.plan,
    entries:
      input.initialPaise > 0
        ? [
            {
              _id: new ObjectId(),
              type: "CONTRIBUTION",
              amountPaise: input.initialPaise,
              date: input.today,
              note: "Already saved when the goal was created",
              requestId: `${requestId}-initial`,
              createdAt: now,
            },
          ]
        : [],
    archivedAt: null,
    requestId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const res = await goalsCollection().insertOne(doc as GoalDoc);
    return res.insertedId.toHexString();
  } catch (e) {
    if (isDuplicateKey(e)) {
      const existing = await goalsCollection().findOne({ userId, requestId });
      if (existing) return existing._id.toHexString();
    }
    throw e;
  }
}

export async function updateGoal(userId: string, id: string, input: Omit<GoalInput, "initialPaise" | "today">): Promise<void> {
  const _id = toObjectId(id);
  if (!_id) throw new UserError("This goal no longer exists.");
  const res = await goalsCollection().updateOne(
    { _id, userId },
    {
      $set: {
        name: input.name,
        description: input.description,
        targetPaise: input.targetPaise,
        targetDate: input.targetDate,
        priority: input.priority,
        category: input.category,
        plan: input.plan,
        updatedAt: new Date(),
      },
    },
  );
  if (res.matchedCount !== 1) throw new UserError("This goal no longer exists.");
}

/**
 * Append a contribution or withdrawal. A withdrawal can't exceed the saved
 * balance: the update's filter re-checks the balance atomically ($expr), so
 * two concurrent withdrawals can't overdraw the goal.
 */
export async function addGoalEntry(
  userId: string,
  goalId: string,
  entry: { type: "CONTRIBUTION" | "WITHDRAWAL"; amountPaise: number; date: ISODate; note: string | null },
  requestId: string,
): Promise<"added" | "duplicate"> {
  const _id = toObjectId(goalId);
  const goal = _id ? await goalsCollection().findOne({ _id, userId, archivedAt: null }) : null;
  if (!_id || !goal) throw new UserError("This goal no longer exists.");
  if (goal.entries.some((e) => e.requestId === requestId)) return "duplicate";

  const balanceExpr = {
    $sum: {
      $map: {
        input: "$entries",
        as: "e",
        in: { $cond: [{ $eq: ["$$e.type", "CONTRIBUTION"] }, "$$e.amountPaise", { $multiply: ["$$e.amountPaise", -1] }] },
      },
    },
  };
  const filter: Record<string, unknown> = { _id, userId, archivedAt: null, "entries.requestId": { $ne: requestId } };
  if (entry.type === "WITHDRAWAL") filter.$expr = { $gte: [balanceExpr, entry.amountPaise] };

  const res = await goalsCollection().updateOne(filter, {
    $push: { entries: { _id: new ObjectId(), ...entry, requestId, createdAt: new Date() } },
    $set: { updatedAt: new Date() },
  });
  if (res.modifiedCount === 1) return "added";
  const again = await goalsCollection().findOne({ _id, userId });
  if (again?.entries.some((e) => e.requestId === requestId)) return "duplicate";
  if (entry.type === "WITHDRAWAL") throw new UserError("You can't withdraw more than this goal holds.");
  throw new UserError("This goal no longer exists.");
}

export async function setGoalArchived(userId: string, id: string, archived: boolean): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await goalsCollection().updateOne({ _id, userId }, { $set: { archivedAt: archived ? new Date() : null, updatedAt: new Date() } });
  return res.matchedCount === 1;
}

// ---------------- Loans ----------------

export interface Loan {
  id: string;
  name: string;
  lender: string | null;
  principalPaise: number;
  annualRateBps: number;
  tenureMonths: number;
  firstEmiDate: ISODate;
  emiPaise: number;
  paidBeforeTracking: number;
  prepayments: { id: string; date: ISODate; amountPaise: number }[];
  transactionId: string | null;
  archived: boolean;
}

function toLoan(d: LoanDoc): Loan {
  return {
    id: d._id.toHexString(),
    name: d.name,
    lender: d.lender,
    principalPaise: d.principalPaise,
    annualRateBps: d.annualRateBps,
    tenureMonths: d.tenureMonths,
    firstEmiDate: d.firstEmiDate,
    emiPaise: d.emiPaise,
    paidBeforeTracking: d.paidBeforeTracking,
    prepayments: d.prepayments
      .map((p) => ({ id: p._id.toHexString(), date: p.date, amountPaise: p.amountPaise }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    transactionId: d.transactionId ? d.transactionId.toHexString() : null,
    archived: d.archivedAt !== null,
  };
}

export async function listLoans(userId: string): Promise<Loan[]> {
  const docs = await loansCollection().find({ userId, archivedAt: null }).sort({ firstEmiDate: 1 }).toArray();
  return docs.map(toLoan);
}

export async function getLoan(userId: string, id: string): Promise<Loan | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const doc = await loansCollection().findOne({ _id, userId });
  return doc ? toLoan(doc) : null;
}

export interface LoanInput {
  name: string;
  lender: string | null;
  principalPaise: number;
  annualRateBps: number;
  tenureMonths: number;
  firstEmiDate: ISODate;
  emiPaise: number;
  paidBeforeTracking: number;
}

export async function createLoan(userId: string, input: LoanInput, requestId: string): Promise<{ id: string; created: boolean }> {
  const now = new Date();
  try {
    const res = await loansCollection().insertOne({
      ...input,
      userId,
      prepayments: [],
      transactionId: null,
      archivedAt: null,
      requestId,
      createdAt: now,
      updatedAt: now,
    } as unknown as LoanDoc);
    return { id: res.insertedId.toHexString(), created: true };
  } catch (e) {
    if (isDuplicateKey(e)) {
      const existing = await loansCollection().findOne({ userId, requestId });
      if (existing) return { id: existing._id.toHexString(), created: false };
    }
    throw e;
  }
}

export async function updateLoan(userId: string, id: string, input: LoanInput): Promise<void> {
  const _id = toObjectId(id);
  if (!_id) throw new UserError("This loan no longer exists.");
  const res = await loansCollection().updateOne({ _id, userId }, { $set: { ...input, updatedAt: new Date() } });
  if (res.matchedCount !== 1) throw new UserError("This loan no longer exists.");
}

/**
 * Link a loan to its recurring EMI item (both directions). Refuses an item
 * already linked to another loan, so one EMI can't be counted twice.
 */
export async function linkLoanTransaction(userId: string, loanId: string, transactionId: string): Promise<void> {
  const lid = toObjectId(loanId);
  const tid = toObjectId(transactionId);
  if (!lid || !tid) throw new UserError("That item couldn't be linked.");
  const tx = await transactionsCollection().findOne({ _id: tid, userId, archivedAt: null, direction: "PAY" });
  if (!tx) throw new UserError("Pick an active payment to link.");
  if (tx.loanId && !tx.loanId.equals(lid)) throw new UserError("That payment already tracks another loan.");
  const res = await transactionsCollection().updateOne(
    { _id: tid, userId, $or: [{ loanId: null }, { loanId: lid }] },
    { $set: { loanId: lid, updatedAt: new Date() } },
  );
  if (res.matchedCount !== 1) throw new UserError("That payment already tracks another loan.");
  // Unlink any previously linked item, then point the loan at the new one.
  await transactionsCollection().updateMany({ userId, loanId: lid, _id: { $ne: tid } }, { $set: { loanId: null, updatedAt: new Date() } });
  await loansCollection().updateOne({ _id: lid, userId }, { $set: { transactionId: tid, updatedAt: new Date() } });
}

export async function addPrepayment(
  userId: string,
  loanId: string,
  p: { date: ISODate; amountPaise: number },
  requestId: string,
): Promise<"added" | "duplicate"> {
  const _id = toObjectId(loanId);
  if (!_id) throw new UserError("This loan no longer exists.");
  const res = await loansCollection().updateOne(
    { _id, userId, archivedAt: null, "prepayments.requestId": { $ne: requestId } },
    { $push: { prepayments: { _id: new ObjectId(), ...p, requestId, createdAt: new Date() } }, $set: { updatedAt: new Date() } },
  );
  if (res.modifiedCount === 1) return "added";
  const doc = await loansCollection().findOne({ _id, userId });
  if (doc?.prepayments.some((x) => x.requestId === requestId)) return "duplicate";
  throw new UserError("This loan no longer exists.");
}

/** Archive a loan and detach its EMI item (the item and its history are kept). */
export async function archiveLoan(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await loansCollection().updateOne({ _id, userId }, { $set: { archivedAt: new Date(), updatedAt: new Date() } });
  if (res.matchedCount === 1) await transactionsCollection().updateMany({ userId, loanId: _id }, { $set: { loanId: null, updatedAt: new Date() } });
  return res.matchedCount === 1;
}
