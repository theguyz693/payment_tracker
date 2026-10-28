import { describe, expect, it } from "vitest";
import { st } from "@/test/fixtures";
import { cashTrend, categoryTrend, previousPeriod } from "./analytics";
import { instalmentsOnOrBefore, loanStatus } from "./emi";

describe("loan status", () => {
  const loan = {
    principalPaise: 1_20_000_00,
    annualRateBps: 0,
    tenureMonths: 12,
    firstEmiDate: "2026-01-05",
    emiPaise: 10_000_00,
    paidBeforeTracking: 2,
    prepayments: [] as { date: string; amountPaise: number }[],
  };
  it("counts EMIs paid before and during tracking", () => {
    const s = loanStatus(loan, 3);
    expect(s.paidInstalments).toBe(5);
    expect(s.outstandingPaise).toBe(70_000_00);
    expect(s.nextEmiDate).toBe("2026-06-05");
    expect(s.remainingInstalments).toBe(7);
  });
  it("applies a prepayment after the last EMI on or before its date", () => {
    expect(instalmentsOnOrBefore("2026-01-05", "2026-01-04")).toBe(0);
    expect(instalmentsOnOrBefore("2026-01-05", "2026-03-05")).toBe(3);
    const s = loanStatus({ ...loan, prepayments: [{ date: "2026-03-10", amountPaise: 30_000_00 }] }, 3);
    expect(s.schedule.rows[2].prepaymentPaise).toBe(30_000_00);
    expect(s.schedule.months).toBe(9);
    expect(s.outstandingPaise).toBe(40_000_00);
  });
  it("never reports more paid than scheduled", () => {
    expect(loanStatus(loan, 50).paidInstalments).toBe(12);
    expect(loanStatus(loan, 50).nextEmiDate).toBeNull();
  });
  it("reports interest saved by prepaying", () => {
    const withRate = { ...loan, annualRateBps: 1200, emiPaise: 10_661_88, paidBeforeTracking: 0 };
    const s = loanStatus({ ...withRate, prepayments: [{ date: "2026-02-05", amountPaise: 50_000_00 }] }, 0);
    expect(s.interestSavedPaise).toBeGreaterThan(0);
    expect(s.schedule.totalInterestPaise).toBeLessThan(s.baseline.totalInterestPaise);
  });
});

describe("analytics helpers", () => {
  it("finds the previous same-length period", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ start: "2026-08-31", end: "2026-09-30" });
    expect(previousPeriod("2026-03-01", "2026-03-01")).toEqual({ start: "2026-02-28", end: "2026-02-28" });
  });
  it("builds category trends with an 'everything else' bucket", () => {
    const s = [
      st({ settledOn: "2026-09-05", amountPaise: 100_00, categoryId: "PAY:Rent", categoryName: "Rent" }),
      st({ settledOn: "2026-10-05", amountPaise: 300_00, categoryId: "PAY:Rent", categoryName: "Rent" }),
      st({ settledOn: "2026-10-06", amountPaise: 50_00, categoryId: "PAY:Food", categoryName: "Food" }),
    ];
    const t = categoryTrend(s, "2026-09-01", "2026-10-31", 1);
    expect(t.categories).toEqual([{ id: "PAY:Rent", name: "Rent" }]);
    expect(t.rows).toEqual([
      { month: "2026-09", values: [100_00], otherPaise: 0 },
      { month: "2026-10", values: [300_00], otherPaise: 50_00 },
    ]);
  });
  it("tracks cash from the balance date only, with month-end points", () => {
    const s = [
      st({ direction: "RECEIVE", settledOn: "2026-09-01", amountPaise: 999_00 }), // before balance date: ignored
      st({ direction: "RECEIVE", settledOn: "2026-09-20", amountPaise: 500_00 }),
      st({ settledOn: "2026-10-03", amountPaise: 200_00 }),
    ];
    const flows = [{ date: "2026-10-10", kind: "INVEST" as const, amountPaise: 100_00 }];
    expect(cashTrend(1_000_00, "2026-09-10", s, flows, "2026-10-28")).toEqual([
      { date: "2026-09-10", value: 1_000_00 },
      { date: "2026-09-30", value: 1_500_00 },
      { date: "2026-10-28", value: 1_200_00 },
    ]);
  });
});
