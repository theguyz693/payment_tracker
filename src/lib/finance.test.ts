import { describe, expect, it } from "vitest";
import { st, tx } from "@/test/fixtures";
import {
  cashFlowByMonth,
  cashFlowTotals,
  obligations,
  plannedExpenses,
  recurringCommitments,
  recurringNext12Months,
  spendingByCategory,
} from "./analytics";
import { divRound, formatScaled, mulDiv, parseDecimal, unitPrice4, valuePaise } from "./decimal";
import { amortise, compareScenarios, computeEmi, outstandingAfter } from "./emi";
import { buildForecast } from "./forecast";
import { monthsUntil, projectSavings, projectedCompletion, requiredMonthly, savedPaise, viewGoal, type Goal } from "./goals";
import { csvField, filterLedger, ledgerCsv, paginate, parseLedgerFilters, settlementsToLedger } from "./ledger";
import { monthsInRange, resolvePeriod } from "./period";
import { computeHolding, HoldingError, nextSipDate, portfolioTotals, sipOccurrences, type InvTxn, type SipPlan } from "./portfolio";
import { annualCost, monthlyCost, occurrencesBetween, resumeDueDate } from "./recurrence";
import { mockReceipt, receiptNumber, receiptText, settlementReceipt } from "./receipt";
import { xirr } from "./xirr";

// ---------- decimal / rounding ----------

describe("decimal", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(-4n, 3n)).toBe(-1n);
  });
  it("parses scaled decimals strictly", () => {
    expect(parseDecimal("12.3456", 4)).toBe(123456);
    expect(parseDecimal("1,234.5", 2)).toBe(123450);
    expect(parseDecimal("1.23456", 4)).toBeNull(); // too many decimals
    expect(parseDecimal("-1", 4)).toBeNull();
    expect(parseDecimal("abc", 4)).toBeNull();
    expect(parseDecimal("0", 6)).toBe(0);
  });
  it("values fractional units without float drift", () => {
    // 12.345678 units at NAV 45.6789 = ₹563.93699… -> 56394 paise
    expect(valuePaise(12_345_678, 456_789)).toBe(56394);
    // 0.1 + 0.2 style trap: 3 units at ₹0.1 = ₹0.30 exactly
    expect(valuePaise(3_000_000, 1_000)).toBe(30);
    // large values stay exact: 1,000,000 units at ₹99,999.9999
    expect(valuePaise(1_000_000_000_000, 999_999_999)).toBe(9_999_999_990_000);
  });
  it("derives a unit price from amount and quantity", () => {
    expect(unitPrice4(500_000, 104_550_000)).toBe(478_240); // ₹5,000 for 104.55 units = ₹47.8240
  });
  it("pro-rates and formats", () => {
    expect(mulDiv(1000, 1, 3)).toBe(333);
    expect(mulDiv(2000, 1, 3)).toBe(667);
    expect(formatScaled(123456, 4)).toBe("12.3456");
    expect(formatScaled(120000, 4, 2)).toBe("12.00");
    expect(formatScaled(-5, 2)).toBe("-0.05");
  });
});

// ---------- recurrence expansion ----------

describe("occurrencesBetween", () => {
  const monthly = { frequency: "MONTHLY" as const, anchorDate: "2026-01-31", dueDate: "2026-10-31", endDate: null };
  it("starts at the current due date and keeps month-end anchoring", () => {
    expect(occurrencesBetween(monthly, "2026-10-01", "2027-03-31")).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });
  it("never repeats settled occurrences (starts at dueDate, not anchor)", () => {
    expect(occurrencesBetween(monthly, "2026-01-01", "2026-11-30")).toEqual(["2026-10-31", "2026-11-30"]);
  });
  it("includes an overdue occurrence when the range covers it", () => {
    const overdue = { ...monthly, dueDate: "2026-09-30" };
    expect(occurrencesBetween(overdue, "2026-09-01", "2026-10-31")).toEqual(["2026-09-30", "2026-10-31"]);
  });
  it("skips forward to the range start", () => {
    expect(occurrencesBetween(monthly, "2027-01-15", "2027-02-28")).toEqual(["2027-01-31", "2027-02-28"]);
  });
  it("respects the end date and one-time items", () => {
    expect(occurrencesBetween({ ...monthly, endDate: "2026-11-30" }, "2026-10-01", "2027-12-31")).toEqual(["2026-10-31", "2026-11-30"]);
    const once = { frequency: "ONE_TIME" as const, anchorDate: "2026-11-05", dueDate: "2026-11-05", endDate: null };
    expect(occurrencesBetween(once, "2026-11-01", "2026-11-30")).toEqual(["2026-11-05"]);
    expect(occurrencesBetween(once, "2026-12-01", "2026-12-31")).toEqual([]);
  });
  it("estimates annual and monthly costs", () => {
    expect(annualCost(100_00, "WEEKLY")).toBe(5200_00);
    expect(monthlyCost(100_00, "WEEKLY")).toBe(43333);
    expect(monthlyCost(1200_00, "YEARLY")).toBe(100_00);
    expect(annualCost(500_00, "ONE_TIME")).toBe(0);
  });
  it("resumes a paused item at the next occurrence, skipping missed ones", () => {
    const paused = { frequency: "MONTHLY" as const, anchorDate: "2026-01-05", dueDate: "2026-07-05", endDate: null };
    expect(resumeDueDate(paused, "2026-10-20")).toBe("2026-11-05");
    expect(resumeDueDate(paused, "2026-10-05")).toBe("2026-10-05");
    expect(resumeDueDate({ ...paused, dueDate: "2026-11-05" }, "2026-10-20")).toBe("2026-11-05");
    expect(resumeDueDate({ ...paused, endDate: "2026-09-30" }, "2026-10-20")).toBeNull();
  });
});

// ---------- periods ----------

describe("periods", () => {
  const today = "2026-10-28";
  it("resolves presets", () => {
    expect(resolvePeriod({}, today)).toMatchObject({ key: "this_month", start: "2026-10-01", end: "2026-10-31" });
    expect(resolvePeriod({ period: "last_month" }, today)).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
    expect(resolvePeriod({ period: "last_3_months" }, today)).toMatchObject({ start: "2026-08-01", end: "2026-10-31" });
    expect(resolvePeriod({ period: "this_year" }, today)).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
    expect(resolvePeriod({ period: "last_month" }, "2026-01-15")).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
  });
  it("validates custom ranges and falls back to this month", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-02-01", to: "2026-03-15" }, today)).toMatchObject({
      key: "custom",
      start: "2026-02-01",
      end: "2026-03-15",
    });
    expect(resolvePeriod({ period: "custom", from: "2026-03-15", to: "2026-02-01" }, today).key).toBe("this_month");
    expect(resolvePeriod({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, today).key).toBe("this_month");
    expect(resolvePeriod({ period: "evil" }, today).key).toBe("this_month");
  });
  it("lists months in a range", () => {
    expect(monthsInRange("2026-11-15", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

// ---------- dashboard totals & cash flow ----------

describe("cash flow and obligations", () => {
  const today = "2026-10-28";
  const settlements = [
    st({ direction: "RECEIVE", amountPaise: 50_000_00, settledOn: "2026-10-01", categoryId: "RECEIVE:Salary", categoryName: "Salary" }),
    st({ direction: "PAY", amountPaise: 15_000_00, settledOn: "2026-10-05" }),
    st({ direction: "PAY", amountPaise: 2_000_00, settledOn: "2026-10-10", categoryId: "PAY:Food", categoryName: "Food" }),
    st({ direction: "PAY", amountPaise: 15_000_00, settledOn: "2026-09-05" }),
  ];
  const flows = [{ date: "2026-10-07", kind: "INVEST" as const, amountPaise: 5_000_00 }];

  it("separates spending from investing and never counts receivables as income", () => {
    const t = cashFlowTotals(settlements, flows, "2026-10-01", "2026-10-31");
    expect(t.incoming.totalPaise).toBe(50_000_00);
    expect(t.outgoing.totalPaise).toBe(17_000_00); // spending only
    expect(t.investedPaise).toBe(5_000_00);
    expect(t.netPaise).toBe(28_000_00);
  });
  it("buckets by month", () => {
    const rows = cashFlowByMonth(settlements, flows, "2026-09-01", "2026-10-31");
    expect(rows.map((r) => [r.month, r.incomingPaise, r.outgoingPaise])).toEqual([
      ["2026-09", 0, 15_000_00],
      ["2026-10", 50_000_00, 17_000_00],
    ]);
  });
  it("breaks spending down by category", () => {
    const cats = spendingByCategory(settlements, "2026-10-01", "2026-10-31");
    expect(cats.map((c) => [c.name, c.totalPaise])).toEqual([
      ["Rent", 15_000_00],
      ["Food", 2_000_00],
    ]);
    expect(cats[0].share).toBeCloseTo(15 / 17);
  });

  const items = [
    tx({ title: "Rent", frequency: "MONTHLY", anchorDate: "2026-01-05", dueDate: "2026-11-05", amountPaise: 15_000_00 }),
    tx({ title: "Late bill", dueDate: "2026-10-20", amountPaise: 1_000_00 }),
    tx({ title: "Phone", frequency: "WEEKLY", anchorDate: "2026-10-29", dueDate: "2026-10-29", amountPaise: 100_00 }),
    tx({ title: "Owed by Ravi", direction: "RECEIVE", dueDate: "2026-10-01", amountPaise: 3_000_00 }),
    tx({ title: "Client", direction: "RECEIVE", dueDate: "2026-10-30", amountPaise: 20_000_00 }),
    tx({ title: "Paused gym", frequency: "MONTHLY", dueDate: "2026-10-29", amountPaise: 2_000_00, paused: true }),
    tx({ title: "Done", status: "PAID", dueDate: "2026-10-01" }),
    tx({ title: "Archived", archived: true, dueDate: "2026-10-29" }),
  ];

  it("computes outstanding and due-soon totals, ignoring paused/settled/archived", () => {
    const o = obligations(items, today);
    expect(o.owedByMe.totalPaise).toBe(15_000_00 + 1_000_00 + 100_00);
    expect(o.owedToMe.totalPaise).toBe(23_000_00);
    expect(o.overduePay.totalPaise).toBe(1_000_00);
    expect(o.overdueReceive.totalPaise).toBe(3_000_00);
    // week: Oct 28..Nov 3 -> phone Oct 29 only (weekly next is Nov 5)
    expect(o.weekPay).toEqual({ count: 1, totalPaise: 100_00 });
    expect(o.weekReceive.totalPaise).toBe(20_000_00);
    // month: rest of October -> phone Oct 29
    expect(o.monthPay.totalPaise).toBe(100_00);
  });
  it("plans expenses by expanding recurrences", () => {
    // 30 days from Oct 28 = to Nov 26: rent Nov 5, phone Oct 29, Nov 5, 12, 19, 26
    expect(plannedExpenses(items, today, 30)).toEqual({ count: 6, totalPaise: 15_000_00 + 5 * 100_00 });
  });
  it("lists recurring commitments with paused ones counted separately", () => {
    const r = recurringCommitments(items);
    expect(r.items.map((c) => c.transaction.title)).toEqual(["Rent", "Phone"]);
    expect(r.annualPaise).toBe(15_000_00 * 12 + 100_00 * 52);
    expect(r.pausedCount).toBe(1);
    const next12 = recurringNext12Months(items, today);
    expect(next12).toHaveLength(12);
    expect(next12[0]).toEqual({ month: "2026-10", totalPaise: 100_00 });
    expect(next12[1].totalPaise).toBe(15_000_00 + 4 * 100_00);
  });
});

// ---------- goals ----------

describe("savings goals", () => {
  const today = "2026-10-28";
  const goal = (p: Partial<Goal>): Goal => ({
    id: "g",
    name: "Laptop",
    description: null,
    targetPaise: 1_20_000_00,
    targetDate: "2027-04-28",
    priority: "HIGH",
    category: "Gadgets",
    plan: null,
    entries: [],
    archived: false,
    ...p,
  });

  it("derives the balance from the entry ledger", () => {
    expect(
      savedPaise([
        { id: "1", type: "CONTRIBUTION", amountPaise: 10_000_00, date: today, note: null },
        { id: "2", type: "CONTRIBUTION", amountPaise: 5_000_00, date: today, note: null },
        { id: "3", type: "WITHDRAWAL", amountPaise: 3_000_00, date: today, note: null },
      ]),
    ).toBe(12_000_00);
  });
  it("computes required monthly saving (rounded up)", () => {
    expect(monthsUntil("2026-10-28", "2027-04-28")).toBe(6);
    expect(monthsUntil("2026-10-28", "2026-11-10")).toBe(1);
    expect(requiredMonthly(1_00_000_01, "2026-10-28", "2027-04-28")).toBe(16_666_67);
    expect(requiredMonthly(0, today, "2027-01-01")).toBe(0);
    expect(requiredMonthly(500, today, "2026-10-01")).toBeNull();
  });
  it("projects completion from the plan", () => {
    const plan = { amountPaise: 20_000_00, frequency: "MONTHLY" as const, anchorDate: "2026-11-01" };
    expect(projectedCompletion(0, 1_20_000_00, plan, today)).toBe("2027-04-01");
    expect(projectedCompletion(1_20_000_00, 1_20_000_00, plan, today)).toBe(today);
    expect(projectedCompletion(0, 1_00_00, null, today)).toBeNull();
  });
  it("assigns a status", () => {
    const plan = { amountPaise: 20_000_00, frequency: "MONTHLY" as const, anchorDate: "2026-11-01" };
    expect(viewGoal(goal({ plan }), today).status).toBe("ON_TRACK");
    expect(viewGoal(goal({ plan: { ...plan, amountPaise: 10_000_00 } }), today).status).toBe("BEHIND");
    expect(viewGoal(goal({}), today).status).toBe("BEHIND");
    expect(viewGoal(goal({ targetDate: null }), today).status).toBe("NO_DEADLINE");
    expect(viewGoal(goal({ targetDate: "2026-10-01" }), today).status).toBe("OVERDUE");
    const full = goal({ entries: [{ id: "1", type: "CONTRIBUTION", amountPaise: 1_30_000_00, date: today, note: null }] });
    const v = viewGoal(full, today);
    expect(v.status).toBe("COMPLETED");
    expect(v.progress).toBe(1);
    expect(v.remainingPaise).toBe(0);
  });
  it("projects hypothetical savings with and without interest", () => {
    const flat = projectSavings({ startingPaise: 0, monthlyPaise: 10_000_00, months: 12, annualRateBps: 0 });
    expect(flat.balancePaise).toBe(1_20_000_00);
    expect(flat.interestPaise).toBe(0);
    const withInterest = projectSavings({ startingPaise: 0, monthlyPaise: 10_000_00, months: 12, annualRateBps: 600 });
    expect(withInterest.contributedPaise).toBe(1_20_000_00);
    expect(withInterest.interestPaise).toBeGreaterThan(3_900_00);
    expect(withInterest.interestPaise).toBeLessThan(4_000_00);
    expect(withInterest.balancePaise).toBe(withInterest.contributedPaise + withInterest.interestPaise);
  });
});

// ---------- EMI ----------

describe("EMI and amortisation", () => {
  it("matches the standard EMI formula", () => {
    expect(computeEmi(10_00_000_00, 850, 240)).toBe(8_678_24); // ₹8,678.2259… rounded up
    expect(computeEmi(1_20_000_00, 0, 12)).toBe(10_000_00);
    expect(computeEmi(0, 850, 12)).toBe(0);
  });
  it("amortises to exactly zero", () => {
    const s = amortise({ principalPaise: 5_00_000_00, annualRateBps: 1050, months: 36, firstEmiDate: "2026-11-05" });
    expect(s.months).toBe(36);
    expect(s.rows[s.rows.length - 1].closingPaise).toBe(0);
    expect(s.rows.reduce((a, r) => a + r.principalPaise, 0)).toBe(5_00_000_00);
    expect(s.totalPaidPaise).toBe(5_00_000_00 + s.totalInterestPaise);
    expect(s.rows[1].date).toBe("2026-12-05");
    expect(s.payoffDate).toBe("2029-10-05");
  });
  it("prepayment shortens tenure and saves interest", () => {
    const base = amortise({ principalPaise: 10_00_000_00, annualRateBps: 900, months: 120, firstEmiDate: "2026-11-01" });
    const pre = amortise({
      principalPaise: 10_00_000_00,
      annualRateBps: 900,
      months: 120,
      firstEmiDate: "2026-11-01",
      prepayments: [{ afterInstalment: 12, amountPaise: 2_00_000_00 }],
    });
    expect(pre.months).toBeLessThan(base.months);
    expect(pre.totalInterestPaise).toBeLessThan(base.totalInterestPaise);
    expect(pre.rows[pre.rows.length - 1].closingPaise).toBe(0);
    const reduceEmi = amortise({
      principalPaise: 10_00_000_00,
      annualRateBps: 900,
      months: 120,
      firstEmiDate: "2026-11-01",
      prepayments: [{ afterInstalment: 12, amountPaise: 2_00_000_00 }],
      mode: "reduce_emi",
    });
    expect(reduceEmi.months).toBe(120);
    expect(reduceEmi.rows[12].emiPaise).toBeLessThan(reduceEmi.rows[0].emiPaise);
  });
  it("caps a prepayment at the outstanding balance", () => {
    const s = amortise({
      principalPaise: 1_00_000_00,
      annualRateBps: 1200,
      months: 12,
      firstEmiDate: "2026-11-01",
      prepayments: [{ afterInstalment: 1, amountPaise: 10_00_000_00 }],
    });
    expect(s.months).toBe(1);
    expect(s.rows[0].closingPaise).toBe(0);
  });
  it("stops when the EMI can't cover interest", () => {
    const s = amortise({ principalPaise: 10_00_000_00, annualRateBps: 1200, months: 12, firstEmiDate: "2026-11-01", emiPaise: 5_000_00 });
    expect(s.payoffDate).toBeNull();
  });
  it("reports outstanding principal and compares scenarios", () => {
    const s = amortise({ principalPaise: 1_20_000_00, annualRateBps: 0, months: 12, firstEmiDate: "2026-11-01" });
    expect(outstandingAfter(s, 0)).toBe(1_20_000_00);
    expect(outstandingAfter(s, 3)).toBe(90_000_00);
    expect(outstandingAfter(s, 99)).toBe(0);
    const [a, b] = compareScenarios(10_00_000_00, "2026-11-01", [
      { label: "A", annualRateBps: 900, months: 120, prepaymentPaise: 0, afterInstalment: 0 },
      { label: "B", annualRateBps: 850, months: 120, prepaymentPaise: 0, afterInstalment: 0 },
    ]);
    expect(b.totalInterestPaise).toBeLessThan(a.totalInterestPaise);
  });
});

// ---------- investments ----------

describe("portfolio", () => {
  const t = (p: Partial<InvTxn>): InvTxn => ({
    id: Math.random().toString(36).slice(2),
    holdingId: "h",
    type: "BUY",
    date: "2025-01-01",
    qtyMicro: null,
    price4: null,
    amountPaise: 0,
    feePaise: 0,
    sipFor: null,
    note: null,
    ...p,
  });

  it("computes FIFO cost basis with partial sales and fees", () => {
    const txns = [
      t({ date: "2025-01-01", qtyMicro: 10_000_000, price4: 1_000_000, amountPaise: 1_000_00, feePaise: 10_00 }), // 10 @ ₹100 + ₹10
      t({ date: "2025-02-01", qtyMicro: 10_000_000, price4: 1_200_000, amountPaise: 1_200_00, feePaise: 0 }), // 10 @ ₹120
      t({ type: "SELL", date: "2025-03-01", qtyMicro: 15_000_000, price4: 1_300_000, amountPaise: 1_950_00, feePaise: 5_00 }), // 15 @ ₹130 − ₹5
    ];
    const s = computeHolding(txns, 1_500_000); // now ₹150
    // sold: lot1 (cost 1010) + half of lot2 (600) = 1610; net proceeds 1945 -> realised 335
    expect(s.realisedPaise).toBe(335_00);
    expect(s.qtyMicro).toBe(5_000_000);
    expect(s.costBasisPaise).toBe(600_00);
    expect(s.valuePaise).toBe(750_00);
    expect(s.unrealisedPaise).toBe(150_00);
    expect(s.contributedPaise).toBe(2_210_00);
    expect(s.totalGainPaise).toBe(485_00);
    expect(s.avgCost4).toBe(1_200_000);
  });
  it("rejects selling more than held and selling amount-only holdings", () => {
    expect(() =>
      computeHolding([t({ qtyMicro: 1_000_000, amountPaise: 100_00 }), t({ type: "SELL", date: "2025-02-01", qtyMicro: 2_000_000, amountPaise: 300_00 })], null),
    ).toThrow(HoldingError);
    expect(() => computeHolding([t({ amountPaise: 100_00 }), t({ type: "SELL", date: "2025-02-01", qtyMicro: 1, amountPaise: 1 })], null)).toThrow(
      HoldingError,
    );
  });
  it("leaves value unknown without a price or quantities", () => {
    const amountOnly = computeHolding([t({ amountPaise: 5_000_00 })], 1_000_000);
    expect(amountOnly.qtyMicro).toBeNull();
    expect(amountOnly.valuePaise).toBeNull();
    expect(amountOnly.contributedPaise).toBe(5_000_00);
    expect(computeHolding([t({ qtyMicro: 1_000_000, amountPaise: 100_00 })], null).valuePaise).toBeNull();
  });
  it("values gold by purity and sell spread", () => {
    // 10 g of 22K, 24K price ₹7,000/g, 3% sell spread -> 70,000 × 22/24 × 0.97 = ₹62,241.67
    const s = computeHolding([t({ qtyMicro: 10_000_000, amountPaise: 60_000_00, feePaise: 3_000_00 })], 70_000_000, {
      karat: 22,
      sellSpreadBps: 300,
    });
    expect(s.valuePaise).toBe(62_241_67);
    expect(s.unrealisedPaise).toBe(62_241_67 - 63_000_00);
  });
  it("aggregates a portfolio and computes allocation and XIRR", () => {
    const a = computeHolding([t({ date: "2025-01-01", qtyMicro: 10_000_000, amountPaise: 1_000_00 })], 1_100_000);
    const b = computeHolding([t({ date: "2025-01-01", qtyMicro: 1_000_000, amountPaise: 1_000_00 })], 11_000_000);
    const p = portfolioTotals(
      [
        { type: "MF", stats: a },
        { type: "STOCK", stats: b },
      ],
      "2026-01-01",
    );
    expect(p.valuePaise).toBe(2_200_00);
    expect(p.absoluteReturn).toBeCloseTo(0.1);
    expect(p.xirr).toBeCloseTo(0.1, 2); // 10% over exactly 365 days
    expect(p.allocation.map((x) => x.share)).toEqual([0.5, 0.5]);
    const withUnvalued = portfolioTotals([{ type: "MF", stats: a }, { type: "GOLD", stats: computeHolding([t({ amountPaise: 100_00 })], null) }], "2026-01-01");
    expect(withUnvalued.unvaluedCount).toBe(1);
    expect(withUnvalued.xirr).toBeNull();
    expect(withUnvalued.absoluteReturn).toBeNull();
  });
  it("schedules SIPs without counting them as invested", () => {
    const plan: SipPlan = { amountPaise: 5_000_00, frequency: "MONTHLY", anchorDate: "2026-01-10", endDate: null, status: "ACTIVE" };
    const recorded = [t({ amountPaise: 5_000_00, sipFor: "2026-11-10", date: "2026-11-10" })];
    expect(nextSipDate(plan, [], "2026-10-28")).toBe("2026-11-10");
    expect(nextSipDate(plan, recorded, "2026-10-28")).toBe("2026-12-10");
    expect(nextSipDate({ ...plan, status: "PAUSED" }, [], "2026-10-28")).toBeNull();
    expect(nextSipDate({ ...plan, endDate: "2026-11-01" }, [], "2026-10-28")).toBeNull();
    expect(sipOccurrences(plan, recorded, "2026-10-28", "2027-01-31")).toEqual(["2026-12-10", "2027-01-10"]);
    expect(computeHolding([], null).contributedPaise).toBe(0);
  });
});

describe("xirr", () => {
  it("solves simple and irregular flows", () => {
    expect(xirr([{ date: "2025-01-01", amountPaise: -100_00 }, { date: "2026-01-01", amountPaise: 110_00 }])).toBeCloseTo(0.1, 4);
    expect(xirr([{ date: "2025-01-01", amountPaise: -100_00 }, { date: "2026-01-01", amountPaise: 80_00 }])).toBeCloseTo(-0.2, 4);
    const r = xirr([
      { date: "2025-01-01", amountPaise: -10_000_00 },
      { date: "2025-07-01", amountPaise: -10_000_00 },
      { date: "2026-01-01", amountPaise: 21_500_00 },
    ]);
    expect(r).toBeGreaterThan(0.09);
    expect(r).toBeLessThan(0.11);
  });
  it("returns null when undefined", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amountPaise: -100 }])).toBeNull();
    expect(xirr([{ date: "2025-01-01", amountPaise: -100 }, { date: "2025-01-01", amountPaise: 110 }])).toBeNull();
  });
});

// ---------- forecast ----------

describe("forecast", () => {
  const today = "2026-10-28";
  const items = [
    tx({ title: "Rent", frequency: "MONTHLY", anchorDate: "2026-01-01", dueDate: "2026-11-01", amountPaise: 20_000_00 }),
    tx({ title: "Overdue bill", dueDate: "2026-10-20", amountPaise: 1_000_00 }),
    tx({ title: "Salary", direction: "RECEIVE", frequency: "MONTHLY", anchorDate: "2026-01-30", dueDate: "2026-10-30", amountPaise: 50_000_00 }),
    tx({ title: "Old IOU", direction: "RECEIVE", dueDate: "2026-09-01", amountPaise: 5_000_00 }),
  ];
  const sips = [
    {
      holdingId: "h",
      name: "Index fund",
      plan: { amountPaise: 5_000_00, frequency: "MONTHLY" as const, anchorDate: "2026-01-05", endDate: null, status: "ACTIVE" as const },
      txns: [],
    },
  ];
  const goals = [
    {
      id: "g",
      name: "Laptop",
      plan: { amountPaise: 10_000_00, frequency: "MONTHLY" as const, anchorDate: "2026-11-02" },
      targetDate: "2027-03-01",
      completed: false,
      remainingPaise: 50_000_00,
    },
  ];

  it("projects balances only with a starting balance and keeps receivables cautious", () => {
    const f = buildForecast({ transactions: items, sips, goals, today, horizonDays: 30, startingBalancePaise: 10_000_00 });
    // Oct 28: overdue bill paid; Oct 30 salary in; Nov 1 rent; Nov 2 save 10k (not cash); Nov 5 SIP
    expect(f.days[0].outPaise).toBe(1_000_00);
    expect(f.totalInPaise).toBe(50_000_00);
    expect(f.totalOutPaise).toBe(1_000_00 + 20_000_00 + 5_000_00);
    expect(f.totalSavePaise).toBe(10_000_00);
    expect(f.overdueReceivePaise).toBe(5_000_00);
    const last = f.days[f.days.length - 1];
    expect(last.balancePaise).toBe(10_000_00 + 50_000_00 - 26_000_00);
    expect(last.cautiousBalancePaise).toBe(10_000_00 - 26_000_00);
    const nov = f.months.find((m) => m.month === "2026-11")!;
    expect(nov.tight).toBe(true);

    const noBalance = buildForecast({ transactions: items, sips, goals, today, horizonDays: 30, startingBalancePaise: null });
    expect(noBalance.days.every((d) => d.balancePaise === null)).toBe(true);
  });
});

// ---------- ledger / CSV ----------

describe("ledger and CSV", () => {
  const entries = settlementsToLedger([
    st({ id: "a", title: "Rent", amountPaise: 15_000_00, settledOn: "2026-10-05", counterparty: "Landlord" }),
    st({ id: "b", title: "Salary", direction: "RECEIVE", amountPaise: 50_000_00, settledOn: "2026-10-01", categoryName: "Salary" }),
    st({ id: "c", title: "Coffee", amountPaise: 200_00, settledOn: "2026-09-12", notes: "with Anu" }),
  ]);
  it("filters, searches and sorts", () => {
    expect(filterLedger(entries, parseLedgerFilters({})).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(filterLedger(entries, parseLedgerFilters({ q: "landlord" })).map((e) => e.id)).toEqual(["a"]);
    expect(filterLedger(entries, parseLedgerFilters({ q: "anu" })).map((e) => e.id)).toEqual(["c"]);
    expect(filterLedger(entries, parseLedgerFilters({ type: "RECEIPT" })).map((e) => e.id)).toEqual(["b"]);
    expect(filterLedger(entries, parseLedgerFilters({ min: "1000", sort: "amount_asc" })).map((e) => e.id)).toEqual(["a", "b"]);
    expect(filterLedger(entries, parseLedgerFilters({ from: "2026-10-01", to: "2026-10-31" })).map((e) => e.id)).toEqual(["a", "b"]);
    expect(parseLedgerFilters({ type: "HACK", page: "-3", min: "abc" })).toMatchObject({ type: undefined, page: 1, min: undefined });
  });
  it("paginates", () => {
    const p = paginate([1, 2, 3, 4, 5], 3, 2);
    expect(p).toEqual({ items: [5], page: 3, pages: 3, total: 5 });
    expect(paginate([], 4, 2)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
  it("escapes CSV and blocks formula injection", () => {
    expect(csvField('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-5)).toBe("-5");
    const csv = ledgerCsv(entries.slice(0, 1));
    expect(csv.split("\r\n")[1]).toBe("2026-10-05,Payment,Rent,Rent,15000.00,out,Landlord,,");
  });
});

// ---------- receipts ----------

describe("receipts", () => {
  it("builds stable receipt numbers and readable text", () => {
    expect(receiptNumber("6720a1b2c3d4e5f60718293a", "2026-10-28")).toBe("PT-20261028-18293A");
    const r = settlementReceipt({
      id: "6720a1b2c3d4e5f60718293a",
      title: "Home Rent",
      direction: "PAY",
      categoryName: "Rent",
      counterparty: "Landlord",
      amountPaise: 25_000_00,
      dueDate: "2026-10-05",
      settledOn: "2026-10-04",
    });
    expect(r.status).toBe("PAID");
    expect(r.amount).toBe("₹25,000");
    const text = receiptText(r);
    expect(text).toContain("PT-20261004-18293A");
    expect(text.replace(/\s+/g, " ")).toContain("Not a bank, payment or tax receipt.");
    expect(text.split("\n").every((l) => l.length <= 32)).toBe(true);
  });
  it("labels mock receipts and totals items", () => {
    const m = mockReceipt({
      title: "Chai run",
      merchant: "Corner stall",
      date: "2026-10-28",
      seed: "abc123def",
      items: [
        { name: "Masala chai", qty: 3, unitPaise: 20_00 },
        { name: "", qty: 1, unitPaise: 999_00 },
        { name: "Samosa", qty: 2, unitPaise: 15_50 },
      ],
    });
    expect(m.kind).toBe("mock");
    expect(m.amountPaise).toBe(91_00);
    expect(m.items).toHaveLength(2);
    expect(m.number.startsWith("SAMPLE-")).toBe(true);
    expect(receiptText(m)).toContain("SAMPLE — NOT A RECEIPT.");
  });
});
