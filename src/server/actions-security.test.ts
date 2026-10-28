// Server actions are public POST endpoints: anyone can call them with any
// arguments. These tests call them directly (as an attacker would) and check:
// - no session -> nothing runs;
// - the user id always comes from the session, never from the request;
// - malformed or oversized input is rejected before the database is touched.

import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER = { id: "user-A", name: "A", email: "a@example.test" };
let signedIn = true;

class RedirectError extends Error {}

vi.mock("./session", () => ({
  requireUser: vi.fn(async () => {
    if (!signedIn) throw new RedirectError("NEXT_REDIRECT /login");
    return SESSION_USER;
  }),
  getSessionUser: vi.fn(async () => (signedIn ? SESSION_USER : null)),
  getToday: vi.fn(async () => "2026-10-28"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const repoCalls: { fn: string; userId: unknown }[] = [];
const record = (fn: string) =>
  vi.fn(async (userId: unknown) => {
    repoCalls.push({ fn, userId });
    return fn === "settleTransaction" ? null : fn === "createTransaction" ? "id" : true;
  });

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return {
    ...actual,
    createTransaction: record("createTransaction"),
    updateTransaction: record("updateTransaction"),
    settleTransaction: record("settleTransaction"),
    archiveTransaction: record("archiveTransaction"),
    restoreTransaction: record("restoreTransaction"),
    pauseTransaction: record("pauseTransaction"),
    resumeTransaction: record("resumeTransaction"),
  };
});
vi.mock("./finance-repo", () => ({
  saveSettings: record("saveSettings"),
  createGoal: record("createGoal"),
  updateGoal: record("updateGoal"),
  addGoalEntry: record("addGoalEntry"),
  setGoalArchived: record("setGoalArchived"),
  createLoan: vi.fn(async (userId: unknown) => (repoCalls.push({ fn: "createLoan", userId }), { id: "l", created: false })),
  updateLoan: record("updateLoan"),
  linkLoanTransaction: record("linkLoanTransaction"),
  addPrepayment: record("addPrepayment"),
  archiveLoan: record("archiveLoan"),
}));
vi.mock("./investments-repo", () => ({
  createHolding: record("createHolding"),
  updateHolding: record("updateHolding"),
  addInvTxn: record("addInvTxn"),
  setManualPrice: record("setManualPrice"),
  setSipStatus: record("setSipStatus"),
  setHoldingArchived: record("setHoldingArchived"),
  deleteInvTxn: record("deleteInvTxn"),
}));

const actions = await import("./actions");
const finActions = await import("./finance-actions");
const invActions = await import("./invest-actions");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const validTx = { direction: "PAY", title: "Rent", amount: "25000", categoryId: "PAY:Rent", frequency: "MONTHLY", dueDate: "2026-11-05" };
const OTHER_ID = "6720a1b2c3d4e5f60718293a";

beforeEach(() => {
  signedIn = true;
  repoCalls.length = 0;
});

describe("unauthenticated callers", () => {
  it("are stopped before any data access", async () => {
    signedIn = false;
    const attempts: Promise<unknown>[] = [
      actions.saveTransaction({}, form(validTx)),
      actions.settleAction(OTHER_ID, "2026-11-05"),
      actions.archiveAction(OTHER_ID),
      actions.restoreAction(OTHER_ID),
      actions.pauseAction(OTHER_ID),
      actions.resumeAction(OTHER_ID),
      finActions.saveSettingsAction({}, form({ cashBalance: "1" })),
      finActions.saveGoalAction({}, form({ name: "x" })),
      finActions.goalEntryAction({}, form({ goalId: OTHER_ID })),
      finActions.archiveGoalAction(OTHER_ID, true),
      finActions.saveLoanAction({}, form({})),
      finActions.prepaymentAction({}, form({})),
      finActions.archiveLoanAction(OTHER_ID),
      invActions.saveHoldingAction({}, form({})),
      invActions.invTxnAction({}, form({})),
      invActions.manualPriceAction({}, form({})),
      invActions.sipStatusAction(OTHER_ID, "PAUSED"),
      invActions.archiveHoldingAction(OTHER_ID),
      invActions.deleteInvTxnAction(OTHER_ID),
      invActions.searchSchemesAction("nifty"),
    ];
    for (const a of attempts) await expect(a).rejects.toBeInstanceOf(RedirectError);
    expect(repoCalls).toEqual([]);
  });
});

describe("the user id comes from the session only", () => {
  it("ignores a forged userId field and passes the session user to the repository", async () => {
    await actions.saveTransaction({}, form({ ...validTx, userId: "user-B", id: OTHER_ID }));
    await actions.archiveAction(OTHER_ID);
    await finActions.goalEntryAction({}, form({ goalId: OTHER_ID, type: "CONTRIBUTION", amount: "10", date: "2026-10-28", userId: "user-B" }));
    await finActions.archiveGoalAction(OTHER_ID, true);
    await invActions.deleteInvTxnAction(OTHER_ID);
    expect(repoCalls.length).toBeGreaterThanOrEqual(5);
    for (const c of repoCalls) expect(c.userId).toBe("user-A");
  });
});

describe("malformed input is rejected before the database", () => {
  it("non-string ids and bad dates", async () => {
    expect(await actions.settleAction({ $ne: null }, "2026-11-05")).toMatchObject({ ok: false });
    expect(await actions.settleAction(OTHER_ID, "2026-02-30")).toMatchObject({ ok: false });
    expect(await actions.settleAction(OTHER_ID, "9999-01-01")).toMatchObject({ ok: false });
    expect(await actions.archiveAction(123)).toEqual({ ok: false });
    expect(await actions.pauseAction(["x"])).toMatchObject({ ok: false });
    expect(await finActions.archiveGoalAction(OTHER_ID, "yes")).toEqual({ ok: false });
    expect(await invActions.sipStatusAction(OTHER_ID, "HACKED")).toEqual({ ok: false });
    expect(await invActions.searchSchemesAction("x".repeat(200))).toEqual([]);
    expect(repoCalls).toEqual([]);
  });

  it("invalid or oversized transaction fields", async () => {
    const bad: Record<string, string>[] = [
      { ...validTx, amount: "0" },
      { ...validTx, amount: "-5" },
      { ...validTx, amount: "1e9" },
      { ...validTx, amount: "99999999999999999999" },
      { ...validTx, amount: "12.345" },
      { ...validTx, title: "" },
      { ...validTx, title: "x".repeat(101) },
      { ...validTx, notes: "x".repeat(1001) },
      { ...validTx, frequency: "HOURLY" },
      { ...validTx, direction: "STEAL" },
      { ...validTx, dueDate: "2026-13-01" },
      { ...validTx, dueDate: "0001-01-01" },
      { ...validTx, endDate: "2026-01-01" }, // before the due date
    ];
    for (const fields of bad) {
      const r = await actions.saveTransaction({}, form(fields));
      expect(r.ok, JSON.stringify(fields)).toBeFalsy();
      expect(r.errors, JSON.stringify(fields)).toBeTruthy();
    }
    expect(repoCalls).toEqual([]);
  });

  it("future-dated goal entries and investment transactions", async () => {
    expect((await finActions.goalEntryAction({}, form({ goalId: OTHER_ID, type: "CONTRIBUTION", amount: "10", date: "2030-01-01" }))).errors?.date).toBeTruthy();
    expect((await invActions.invTxnAction({}, form({ holdingId: OTHER_ID, type: "BUY", amount: "10", date: "2030-01-01" }))).errors?.date).toBeTruthy();
    expect((await invActions.invTxnAction({}, form({ holdingId: OTHER_ID, type: "SELL", amount: "10", date: "2026-10-01" }))).errors).toBeTruthy(); // sale without quantity
    expect((await finActions.saveLoanAction({}, form({ name: "L", principal: "100000", rate: "900", tenure: "12", firstEmiDate: "2026-11-01" }))).errors?.rate).toBeTruthy();
    expect((await finActions.saveLoanAction({}, form({ name: "L", principal: "100000", rate: "9", tenure: "9999", firstEmiDate: "2026-11-01" }))).errors?.tenure).toBeTruthy();
    expect(repoCalls).toEqual([]);
  });
});
