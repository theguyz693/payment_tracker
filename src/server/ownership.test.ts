// Behavioural ownership tests: real repository code runs against two users'
// records in an in-memory collection. User A must never be able to read,
// change, settle, archive, pause or delete anything belonging to User B.

import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCollection } from "@/test/memory-collection";

const cols = {
  transactions: new MemoryCollection(),
  goals: new MemoryCollection(),
  loans: new MemoryCollection(),
  holdings: new MemoryCollection(),
  investmentTxns: new MemoryCollection(),
  userSettings: new MemoryCollection(),
};

vi.mock("./models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./models")>();
  return {
    ...actual,
    transactionsCollection: () => cols.transactions,
    goalsCollection: () => cols.goals,
    loansCollection: () => cols.loans,
    holdingsCollection: () => cols.holdings,
    invTxnsCollection: () => cols.investmentTxns,
    settingsCollection: () => cols.userSettings,
  };
});

const repo = await import("./repository");
const fin = await import("./finance-repo");
const inv = await import("./investments-repo");
const { deleteAllUserData } = await import("./account");

const A = "user-A";
const B = "user-B";
const today = "2026-10-28";
const txB = new ObjectId();
const goalB = new ObjectId();
const holdingB = new ObjectId();
const invTxnB = new ObjectId();
const entryB = new ObjectId();

function seed() {
  const base = {
    title: "B's rent",
    amountPaise: 25_000_00,
    direction: "PAY",
    frequency: "MONTHLY",
    categoryId: "PAY:Rent",
    counterparty: "Landlord",
    notes: "private",
    startDate: "2026-01-05",
    anchorDate: "2026-01-05",
    dueDate: "2026-11-05",
    endDate: null,
    status: "PENDING",
    archivedAt: null,
    pausedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  cols.transactions.docs = [
    { ...base, _id: txB, userId: B, history: [{ entryId: entryB, dueDate: "2026-10-05", settledOn: "2026-10-04", amountPaise: 25_000_00, createdAt: new Date() }] },
    { ...base, _id: new ObjectId(), userId: A, title: "A's rent", history: [] },
  ];
  cols.goals.docs = [
    { _id: goalB, userId: B, name: "B's goal", description: null, targetPaise: 1000_00, targetDate: null, priority: "LOW", category: "Other", plan: null, entries: [], archivedAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
  cols.holdings.docs = [
    { _id: holdingB, userId: B, type: "STOCK", name: "B's stock", symbol: null, provider: null, providerKey: null, sip: null, gold: null, manualPrice: null, notes: null, archivedAt: null },
  ];
  cols.investmentTxns.docs = [
    { _id: invTxnB, userId: B, holdingId: holdingB, type: "BUY", date: "2026-01-01", qtyMicro: 1_000_000, price4: 1_000_000, amountPaise: 100_00, feePaise: 0, sipFor: null, note: null, requestId: "b-req-0001" },
  ];
  cols.loans.docs = [];
  cols.userSettings.docs = [{ _id: new ObjectId(), userId: B, cashBalancePaise: 5_00_000_00, cashAsOf: today }];
}

const snapshot = () => JSON.stringify(Object.values(cols).map((c) => c.docs.filter((d) => d.userId === B)));

beforeEach(seed);

describe("User A cannot touch User B's records", () => {
  it("can't read them", async () => {
    expect(await repo.getTransaction(A, txB.toHexString())).toBeNull();
    expect(await repo.getHistory(A, txB.toHexString())).toEqual([]);
    expect(await repo.getSettlement(A, entryB.toHexString())).toBeNull();
    expect(await fin.getGoal(A, goalB.toHexString())).toBeNull();
    expect(await inv.getHolding(A, holdingB.toHexString())).toBeNull();
    expect(await inv.listInvTxns(A, holdingB.toHexString())).toEqual([]);
    const mine = await repo.loadUserData(A);
    expect(mine.transactions.map((t) => t.title)).toEqual(["A's rent"]);
    expect(mine.settlements).toEqual([]);
    expect(await fin.getSettings(A)).toEqual({ cashBalancePaise: null, cashAsOf: null });
  });

  it("can't change, settle, archive, pause or delete them", async () => {
    const before = snapshot();
    const id = txB.toHexString();
    const input = {
      direction: "PAY" as const,
      title: "hacked",
      amount: 1,
      categoryId: "PAY:Rent",
      frequency: "ONE_TIME" as const,
      dueDate: today,
      startDate: today,
      endDate: null,
      counterparty: null,
      notes: null,
    };
    await expect(repo.updateTransaction(A, id, input, today)).rejects.toThrow(repo.UserError);
    expect(await repo.settleTransaction(A, id, "2026-11-05", today)).toBeNull();
    expect(await repo.archiveTransaction(A, id)).toBe(false);
    expect(await repo.restoreTransaction(A, id)).toBe(false);
    expect(await repo.pauseTransaction(A, id)).toBe(false);
    await expect(repo.resumeTransaction(A, id, today)).rejects.toThrow(repo.UserError);

    await expect(fin.addGoalEntry(A, goalB.toHexString(), { type: "CONTRIBUTION", amountPaise: 1, date: today, note: null }, "a-req-0001")).rejects.toThrow(repo.UserError);
    await expect(fin.updateGoal(A, goalB.toHexString(), { name: "x", description: null, targetPaise: 1, targetDate: null, priority: "LOW", category: "Other", plan: null })).rejects.toThrow(repo.UserError);
    expect(await fin.setGoalArchived(A, goalB.toHexString(), true)).toBe(false);

    await expect(inv.addInvTxn(A, holdingB.toHexString(), { type: "SELL", date: today, qtyMicro: 1, price4: 1, amountPaise: 1, feePaise: 0, sipFor: null, note: null }, "a-req-0002")).rejects.toThrow(repo.UserError);
    expect(await inv.deleteInvTxn(A, invTxnB.toHexString())).toBe(false);
    expect(await inv.setManualPrice(A, holdingB.toHexString(), 1, today)).toBe(false);
    expect(await inv.setHoldingArchived(A, holdingB.toHexString(), true)).toBe(false);

    expect(snapshot()).toBe(before);
  });

  it("can't link B's payment to a loan", async () => {
    const { id: loanA } = await fin.createLoan(
      A,
      { name: "A loan", lender: null, principalPaise: 100_00, annualRateBps: 0, tenureMonths: 1, firstEmiDate: today, emiPaise: 100_00, paidBeforeTracking: 0 },
      "a-req-0003",
    );
    await expect(fin.linkLoanTransaction(A, loanA, txB.toHexString())).rejects.toThrow(repo.UserError);
    expect(cols.transactions.docs.find((d) => (d._id as ObjectId).equals(txB))?.loanId).toBeUndefined();
  });

  it("deleting A's account data leaves B's untouched", async () => {
    const before = snapshot();
    await deleteAllUserData(A);
    expect(cols.transactions.docs.filter((d) => d.userId === A)).toHaveLength(0);
    expect(snapshot()).toBe(before);
    await expect(deleteAllUserData("")).rejects.toThrow();
  });
});

describe("duplicate processing", () => {
  it("settling the same occurrence twice records it once", async () => {
    const mine = cols.transactions.docs.find((d) => d.userId === A)!;
    const id = (mine._id as ObjectId).toHexString();
    await repo.settleTransaction(A, id, "2026-11-05", today);
    await repo.settleTransaction(A, id, "2026-11-05", today); // double-click / retry
    const after = cols.transactions.docs.find((d) => d.userId === A)!;
    expect((after.history as unknown[]).length).toBe(1);
    expect(after.dueDate).toBe("2026-12-05");
  });

  it("a paused item can't be settled", async () => {
    const mine = cols.transactions.docs.find((d) => d.userId === A)!;
    const id = (mine._id as ObjectId).toHexString();
    expect(await repo.pauseTransaction(A, id)).toBe(true);
    await repo.settleTransaction(A, id, "2026-11-05", today);
    expect((cols.transactions.docs.find((d) => d.userId === A)!.history as unknown[]).length).toBe(0);
  });

  it("a repeated goal contribution (same requestId) is stored once", async () => {
    const goalId = await fin.createGoal(A, { name: "g", description: null, targetPaise: 100_00, targetDate: null, priority: "LOW", category: "Other", plan: null, initialPaise: 0, today }, "a-req-0004");
    const entry = { type: "CONTRIBUTION" as const, amountPaise: 10_00, date: today, note: null };
    expect(await fin.addGoalEntry(A, goalId, entry, "a-req-0005")).toBe("added");
    expect(await fin.addGoalEntry(A, goalId, entry, "a-req-0005")).toBe("duplicate");
    expect((cols.goals.docs.find((d) => d.userId === A)!.entries as unknown[]).length).toBe(1);
  });
});
