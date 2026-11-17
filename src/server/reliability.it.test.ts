// Real-MongoDB integration tests for the reliability fixes (phase 1) and the
// idempotency / rate-limit infrastructure. These exercise actual unique
// indexes, atomic conditional updates and multi-document transactions.

import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { TransactionInput } from "@/lib/validation";
import { IdempotencyConflictError, StaleWriteError, UserError } from "./errors";
import { withIdempotency } from "./idempotency";
import { holdingsCollection, idempotencyCollection, invTxnsCollection, loansCollection, transactionsCollection } from "./models";
import { consume, enforce } from "./ratelimit";
import * as repo from "./repository";
import * as inv from "./investments-repo";
import * as fin from "./finance-repo";

const today = "2026-11-17";
const user = () => `it-user-${new ObjectId().toHexString()}`;

const rent: TransactionInput = {
  direction: "PAY",
  title: "Rent",
  amount: 25_000_00,
  categoryId: "PAY:Rent",
  frequency: "MONTHLY",
  dueDate: "2026-12-05",
  startDate: "2026-12-05",
  endDate: null,
  counterparty: null,
  notes: null,
};

describe("idempotent transaction creation", () => {
  it("same key + same payload returns the first result; one document", async () => {
    const u = user();
    const run = () =>
      withIdempotency({ userId: u, scope: "transaction.create", key: "key-same-payload-1", payload: rent }, async (session) => ({
        id: await repo.createTransaction(u, rent, { requestId: "key-same-payload-1", session }),
      }));
    const a = await run();
    const b = await run();
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.result.id).toBe(a.result.id);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("same key + different payload is rejected", async () => {
    const u = user();
    await withIdempotency({ userId: u, scope: "transaction.create", key: "key-diff-payload", payload: rent }, async (session) => ({
      id: await repo.createTransaction(u, rent, { requestId: "key-diff-payload", session }),
    }));
    await expect(
      withIdempotency({ userId: u, scope: "transaction.create", key: "key-diff-payload", payload: { ...rent, amount: 1 } }, async () => ({ id: "x" })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("concurrent submissions with one key create exactly one transaction", async () => {
    const u = user();
    const key = "key-concurrent-123";
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        withIdempotency({ userId: u, scope: "transaction.create", key, payload: rent }, async (session) => ({
          id: await repo.createTransaction(u, rent, { requestId: key, session }),
        })),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ result: { id: string } }>).value.result.id);
    expect(ok.length).toBeGreaterThan(0);
    expect(new Set(ok).size).toBe(1);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("a failed attempt commits nothing and can be retried with the same key", async () => {
    const u = user();
    const key = "key-retry-after-timeout";
    await expect(
      withIdempotency({ userId: u, scope: "transaction.create", key, payload: rent }, async (session) => {
        await repo.createTransaction(u, rent, { requestId: key, session });
        throw new Error("simulated timeout after the insert");
      }),
    ).rejects.toThrow("simulated timeout");
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(0); // rolled back
    expect((await idempotencyCollection().findOne({ userId: u, key }))?.status).toBe("FAILED");

    const retry = await withIdempotency({ userId: u, scope: "transaction.create", key, payload: rent }, async (session) => ({
      id: await repo.createTransaction(u, rent, { requestId: key, session }),
    }));
    expect(retry.replayed).toBe(false);
    expect(await transactionsCollection().countDocuments({ userId: u })).toBe(1);
  });

  it("an abandoned claim (expired lease) is taken over", async () => {
    const u = user();
    const key = "key-abandoned-lease";
    const { requestHash } = await import("./idempotency");
    await idempotencyCollection().insertOne({
      _id: new ObjectId(),
      userId: u,
      scope: "transaction.create",
      key,
      requestHash: requestHash(rent),
      status: "IN_PROGRESS",
      result: null,
      error: null,
      attempts: 1,
      lockedUntil: new Date(Date.now() - 1000),
      createdAt: new Date(),
      completedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const r = await withIdempotency({ userId: u, scope: "transaction.create", key, payload: rent }, async (session) => ({
      id: await repo.createTransaction(u, rent, { requestId: key, session }),
    }));
    expect(r.replayed).toBe(false);
    expect((await idempotencyCollection().findOne({ userId: u, key }))?.attempts).toBe(2);
  });

  it("the transactions unique (userId, requestId) index rejects a second insert", async () => {
    const u = user();
    await transactionsCollection().insertOne({ _id: new ObjectId(), userId: u, requestId: "dup-key-index" } as never);
    await expect(transactionsCollection().insertOne({ _id: new ObjectId(), userId: u, requestId: "dup-key-index" } as never)).rejects.toMatchObject({ code: 11000 });
  });
});

describe("recurrence: settle and edit races", () => {
  it("concurrent settles of one occurrence record exactly one history entry", async () => {
    const u = user();
    const id = await repo.createTransaction(u, rent);
    const results = await Promise.all(Array.from({ length: 6 }, () => repo.settleOccurrence(u, id, "2026-12-05", today)));
    expect(results.filter((r) => r.outcome === "settled")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already_settled")).toHaveLength(5);
    const doc = await transactionsCollection().findOne({ userId: u });
    expect(doc!.history).toHaveLength(1);
    expect(doc!.dueDate).toBe("2027-01-05");
  });

  it("a stale edit after settlement is refused and can't reopen the occurrence", async () => {
    const u = user();
    const id = await repo.createTransaction(u, rent);
    const opened = await repo.getTransaction(u, id); // the edit form loads
    await repo.settleOccurrence(u, id, "2026-12-05", today); // settled in another tab
    await expect(repo.updateTransaction(u, id, { ...rent, title: "Rent (edited)" }, today, { expectedVersion: opened!.version })).rejects.toBeInstanceOf(StaleWriteError);
    const doc = await transactionsCollection().findOne({ userId: u });
    expect(doc!.dueDate).toBe("2027-01-05");
    expect(doc!.title).toBe("Rent");
    expect((await repo.settleOccurrence(u, id, "2026-12-05", today)).outcome).toBe("already_settled");
  });

  it("an edit racing a settlement never writes the old due date back", async () => {
    const u = user();
    const id = await repo.createTransaction(u, rent);
    const [edit, settle] = await Promise.allSettled([repo.updateTransaction(u, id, { ...rent, notes: "x" }, today), repo.settleOccurrence(u, id, "2026-12-05", today)]);
    const doc = await transactionsCollection().findOne({ userId: u });
    if (settle.status === "fulfilled" && settle.value.outcome === "settled") {
      expect(doc!.dueDate).toBe("2027-01-05");
      expect(doc!.history).toHaveLength(1);
    }
    if (edit.status === "rejected") expect(edit.reason).toBeInstanceOf(StaleWriteError);
  });

  it("reports archived and paused items instead of claiming success", async () => {
    const u = user();
    const a = await repo.createTransaction(u, rent);
    await repo.archiveTransaction(u, a);
    expect((await repo.settleOccurrence(u, a, "2026-12-05", today)).outcome).toBe("archived");
    const p = await repo.createTransaction(u, rent);
    await repo.pauseTransaction(u, p);
    expect((await repo.settleOccurrence(u, p, "2026-12-05", today)).outcome).toBe("paused");
    expect((await repo.settleOccurrence(u, new ObjectId().toHexString(), "2026-12-05", today)).outcome).toBe("not_found");
  });

  it("pause/resume skips missed occurrences and never duplicates history", async () => {
    const u = user();
    const id = await repo.createTransaction(u, { ...rent, dueDate: "2026-08-05", startDate: "2026-08-05" });
    await repo.pauseTransaction(u, id);
    const due = await repo.resumeTransaction(u, id, today);
    expect(due).toBe("2026-12-05"); // Sep–Nov skipped while paused
    expect((await transactionsCollection().findOne({ userId: u }))!.history).toHaveLength(0);
  });
});

describe("investments: concurrent sells", () => {
  async function holdingWith10Units(u: string) {
    const hid = await inv.createHolding(u, { type: "STOCK", name: "Test Co", symbol: "TST", provider: null, providerKey: null, sip: null, gold: null, notes: null }, `h-${u}`);
    await inv.addInvTxn(u, hid, { type: "BUY", date: "2026-01-02", qtyMicro: 10_000_000, price4: 100_0000, amountPaise: 1000_00, feePaise: 0, sipFor: null, note: null }, `buy-${u}`);
    return hid;
  }
  const sell = (n: number) => ({ type: "SELL" as const, date: "2026-11-01", qtyMicro: n * 1_000_000, price4: 120_0000, amountPaise: n * 120_00, feePaise: 0, sipFor: null, note: null });

  it("two concurrent sells of 7 of 10 units: exactly one succeeds", async () => {
    const u = user();
    const hid = await holdingWith10Units(u);
    const results = await Promise.allSettled([inv.addInvTxn(u, hid, sell(7), "sell-a"), inv.addInvTxn(u, hid, sell(7), "sell-b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(UserError);
    expect(await invTxnsCollection().countDocuments({ userId: u, type: "SELL" })).toBe(1);
    expect((await holdingsCollection().findOne({ userId: u }))!.txnSeq).toBe(2);
  });

  it("many small concurrent sells never oversell (FIFO stays valid)", async () => {
    const u = user();
    const hid = await holdingWith10Units(u);
    await Promise.allSettled(Array.from({ length: 6 }, (_, i) => inv.addInvTxn(u, hid, sell(3), `sell-${i}`)));
    const sold = await invTxnsCollection().find({ userId: u, type: "SELL" }).toArray();
    expect(sold.reduce((a, t) => a + (t.qtyMicro ?? 0), 0)).toBeLessThanOrEqual(10_000_000);
    expect(sold).toHaveLength(3);
  });

  it("a repeated submit is a duplicate, not a second trade", async () => {
    const u = user();
    const hid = await holdingWith10Units(u);
    expect(await inv.addInvTxn(u, hid, sell(1), "same-sell")).toBe("added");
    expect(await inv.addInvTxn(u, hid, sell(1), "same-sell")).toBe("duplicate");
    expect(await invTxnsCollection().countDocuments({ userId: u, type: "SELL" })).toBe(1);
  });
});

describe("loans: loan + EMI item commit together", () => {
  it("a failure after creating the loan rolls everything back", async () => {
    const u = user();
    const { runInTransaction } = await import("./models");
    const input: fin.LoanInput = { name: "Car", lender: null, principalPaise: 5_00_000_00, annualRateBps: 900, tenureMonths: 24, firstEmiDate: "2026-12-01", emiPaise: 23_000_00, paidBeforeTracking: 0 };
    await expect(
      runInTransaction(async (session) => {
        await fin.createLoan(u, input, "loan-req-1", session);
        throw new Error("crash before the EMI item");
      }),
    ).rejects.toThrow("crash");
    expect(await loansCollection().countDocuments({ userId: u })).toBe(0);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit in a window, then refuses", async () => {
    const subject = user();
    const now = Date.UTC(2026, 10, 17, 10, 0, 5);
    const results = await Promise.all(Array.from({ length: 22 }, () => consume("event.retry", subject, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect(results.filter((r) => !r.allowed)).toHaveLength(2);
    // Next window starts fresh.
    expect((await consume("event.retry", subject, now + 60_000)).allowed).toBe(true);
  });

  it("enforce throws a RateLimitError once over the limit", async () => {
    const subject = user();
    for (let i = 0; i < 20; i++) await enforce("event.retry", subject, { userId: subject, route: "test" });
    await expect(enforce("event.retry", subject, { userId: subject, route: "test" })).rejects.toMatchObject({ category: "rate_limited" });
  });
});
