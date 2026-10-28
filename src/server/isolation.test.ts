// User isolation: every repository read/write must be scoped to the caller's
// userId. Runs every repository function against a recording fake collection
// and checks each filter (and each inserted document) carries that userId —
// so an id belonging to another user can never match.

import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "user-A";
const calls: { collection: string; op: string; arg: Record<string, unknown> }[] = [];
let findOneResult: (collection: string) => unknown = () => null;

function fake(collection: string) {
  const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => [] };
  return {
    find: (f: Record<string, unknown>) => (calls.push({ collection, op: "find", arg: f }), cursor),
    findOne: async (f: Record<string, unknown>) => (calls.push({ collection, op: "findOne", arg: f }), findOneResult(collection)),
    insertOne: async (d: Record<string, unknown>) => (calls.push({ collection, op: "insertOne", arg: d }), { insertedId: new ObjectId() }),
    updateOne: async (f: Record<string, unknown>) => (calls.push({ collection, op: "updateOne", arg: f }), { matchedCount: 1, modifiedCount: 1 }),
    updateMany: async (f: Record<string, unknown>) => (calls.push({ collection, op: "updateMany", arg: f }), { matchedCount: 0, modifiedCount: 0 }),
    deleteOne: async (f: Record<string, unknown>) => (calls.push({ collection, op: "deleteOne", arg: f }), { deletedCount: 1 }),
  };
}

vi.mock("./models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./models")>();
  return {
    ...actual,
    transactionsCollection: () => fake("transactions"),
    goalsCollection: () => fake("goals"),
    loansCollection: () => fake("loans"),
    holdingsCollection: () => fake("holdings"),
    invTxnsCollection: () => fake("investmentTxns"),
    settingsCollection: () => fake("userSettings"),
  };
});

const repo = await import("./repository");
const fin = await import("./finance-repo");
const inv = await import("./investments-repo");

const OTHER_ID = new ObjectId().toHexString(); // e.g. another user's document id
const today = "2026-10-28";

function expectScoped() {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.arg.userId, `${c.collection}.${c.op} must filter on userId`).toBe(USER);
  }
}

beforeEach(() => {
  calls.length = 0;
  findOneResult = () => null;
});

describe("user isolation", () => {
  it("transactions repository", async () => {
    await repo.loadUserData(USER);
    await repo.getTransaction(USER, OTHER_ID);
    await repo.getHistory(USER, OTHER_ID);
    await repo.getSettlement(USER, OTHER_ID);
    await repo.settleTransaction(USER, OTHER_ID, today, today);
    await repo.archiveTransaction(USER, OTHER_ID);
    await repo.restoreTransaction(USER, OTHER_ID);
    await repo.pauseTransaction(USER, OTHER_ID);
    await expect(repo.resumeTransaction(USER, OTHER_ID, today)).rejects.toThrow(repo.UserError);
    await expect(
      repo.updateTransaction(
        USER,
        OTHER_ID,
        {
          direction: "PAY",
          title: "x",
          amount: 100,
          categoryId: "PAY:Rent",
          frequency: "ONE_TIME",
          dueDate: today,
          startDate: today,
          endDate: null,
          counterparty: null,
          notes: null,
        },
        today,
      ),
    ).rejects.toThrow(repo.UserError);
    expectScoped();
  });

  it("creates are stamped with the caller's userId", async () => {
    await repo.createTransaction(
      USER,
      {
        direction: "PAY",
        title: "x",
        amount: 100,
        categoryId: "PAY:Rent",
        frequency: "ONE_TIME",
        dueDate: today,
        startDate: today,
        endDate: null,
        counterparty: null,
        notes: null,
      },
      { requestId: "req-12345678" },
    );
    await fin.createGoal(
      USER,
      { name: "g", description: null, targetPaise: 100, targetDate: null, priority: "LOW", category: "Other", plan: null, initialPaise: 0, today },
      "req-12345678",
    );
    await fin.createLoan(
      USER,
      { name: "l", lender: null, principalPaise: 100, annualRateBps: 0, tenureMonths: 1, firstEmiDate: today, emiPaise: 100, paidBeforeTracking: 0 },
      "req-12345678",
    );
    await inv.createHolding(
      USER,
      { type: "STOCK", name: "s", symbol: null, provider: null, providerKey: null, sip: null, gold: null, notes: null },
      "req-12345678",
    );
    expectScoped();
  });

  it("goals, loans and settings", async () => {
    await fin.getSettings(USER);
    await fin.saveSettings(USER, { cashBalancePaise: 1, cashAsOf: today });
    await fin.listGoals(USER);
    await fin.getGoal(USER, OTHER_ID);
    await expect(fin.updateGoal(USER, "bad", { name: "", description: null, targetPaise: 1, targetDate: null, priority: "LOW", category: "", plan: null })).rejects.toThrow();
    await expect(fin.addGoalEntry(USER, OTHER_ID, { type: "CONTRIBUTION", amountPaise: 1, date: today, note: null }, "req-12345678")).rejects.toThrow(
      repo.UserError,
    );
    await fin.setGoalArchived(USER, OTHER_ID, true);
    await fin.listLoans(USER);
    await fin.getLoan(USER, OTHER_ID);
    await expect(fin.linkLoanTransaction(USER, OTHER_ID, OTHER_ID)).rejects.toThrow(repo.UserError);
    await fin.archiveLoan(USER, OTHER_ID);
    expectScoped();
  });

  it("investments", async () => {
    await inv.listHoldings(USER);
    await inv.getHolding(USER, OTHER_ID);
    await inv.listInvTxns(USER, OTHER_ID);
    await inv.setSipStatus(USER, OTHER_ID, "PAUSED");
    await inv.setManualPrice(USER, OTHER_ID, 100, today);
    await inv.setHoldingArchived(USER, OTHER_ID, true);
    await expect(
      inv.addInvTxn(USER, OTHER_ID, { type: "BUY", date: today, qtyMicro: 1, price4: 1, amountPaise: 1, feePaise: 0, sipFor: null, note: null }, "req-12345678"),
    ).rejects.toThrow(repo.UserError);
    await inv.deleteInvTxn(USER, OTHER_ID);
    expectScoped();
  });

  it("ignores malformed ids instead of querying with them", async () => {
    expect(await repo.getTransaction(USER, "{$ne:null}")).toBeNull();
    expect(await fin.getGoal(USER, "../../etc")).toBeNull();
    expect(await inv.getHolding(USER, "")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("a duplicate goal entry (same requestId) is not appended twice", async () => {
    findOneResult = (c) =>
      c === "goals"
        ? { _id: new ObjectId(OTHER_ID), userId: USER, archivedAt: null, entries: [{ requestId: "req-12345678", type: "CONTRIBUTION", amountPaise: 1 }] }
        : null;
    const r = await fin.addGoalEntry(USER, OTHER_ID, { type: "CONTRIBUTION", amountPaise: 1, date: today, note: null }, "req-12345678");
    expect(r).toBe("duplicate");
    expect(calls.filter((c) => c.op === "updateOne")).toHaveLength(0);
  });
});
