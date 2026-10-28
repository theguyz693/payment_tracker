import { describe, expect, it } from "vitest";
import { addMonths, today } from "./dates";
import { describeRecurrence, nextOccurrenceAfter, settle } from "./recurrence";
import { effectiveStatus } from "./status";
import { dashboardSummary, monthlySummary } from "./summary";
import { st, tx } from "@/test/fixtures";

describe("addMonths", () => {
  it("clamps to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
});

describe("nextOccurrenceAfter", () => {
  it("monthly rent due on the 5th moves Oct 5 -> Nov 5", () => {
    expect(nextOccurrenceAfter("2026-10-05", "MONTHLY", "2026-10-05")).toBe("2026-11-05");
  });
  it("keeps the 31st after passing through February", () => {
    expect(nextOccurrenceAfter("2026-01-31", "MONTHLY", "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrenceAfter("2026-01-31", "MONTHLY", "2026-02-28")).toBe("2026-03-31");
  });
  it("handles every frequency", () => {
    expect(nextOccurrenceAfter("2026-10-06", "DAILY", "2026-10-06")).toBe("2026-10-07");
    expect(nextOccurrenceAfter("2026-10-06", "WEEKLY", "2026-10-06")).toBe("2026-10-13");
    expect(nextOccurrenceAfter("2026-10-06", "QUARTERLY", "2026-10-06")).toBe("2027-01-06");
    expect(nextOccurrenceAfter("2024-02-29", "YEARLY", "2024-02-29")).toBe("2025-02-28");
    expect(nextOccurrenceAfter("2024-02-29", "YEARLY", "2027-03-01")).toBe("2028-02-29");
    expect(nextOccurrenceAfter("2026-10-06", "ONE_TIME", "2026-10-06")).toBeNull();
  });
  it("is exact far from the anchor", () => {
    expect(nextOccurrenceAfter("2020-01-31", "MONTHLY", "2026-10-15")).toBe("2026-10-31");
    expect(nextOccurrenceAfter("2020-01-01", "DAILY", "2026-10-15")).toBe("2026-10-16");
  });
});

describe("settle", () => {
  const base = { anchorDate: "2026-10-05", dueDate: "2026-10-05", endDate: null };
  it("advances a recurring PAY item and keeps it pending", () => {
    expect(settle({ ...base, direction: "PAY", frequency: "MONTHLY" })).toEqual({
      settledDueDate: "2026-10-05",
      dueDate: "2026-11-05",
      status: "PENDING",
      completed: false,
    });
  });
  it("closes a one-time item with the right status per direction", () => {
    expect(settle({ ...base, direction: "PAY", frequency: "ONE_TIME" }).status).toBe("PAID");
    expect(settle({ ...base, direction: "RECEIVE", frequency: "ONE_TIME" }).status).toBe("RECEIVED");
  });
  it("completes a recurring item when the next occurrence passes the end date", () => {
    const r = settle({ ...base, endDate: "2026-11-01", direction: "RECEIVE", frequency: "MONTHLY" });
    expect(r).toMatchObject({ status: "RECEIVED", completed: true, dueDate: "2026-10-05" });
  });
});

describe("describeRecurrence", () => {
  it("reads naturally", () => {
    expect(describeRecurrence("MONTHLY", "2026-10-05")).toBe("Repeats every month on the 5th");
    expect(describeRecurrence("WEEKLY", "2026-10-06")).toBe("Repeats every Tuesday");
  });
});

// ---- Status & summaries ----

describe("effectiveStatus", () => {
  it("derives OVERDUE from the date", () => {
    expect(effectiveStatus({ status: "PENDING", dueDate: "2026-10-05" }, "2026-10-06")).toBe("OVERDUE");
    expect(effectiveStatus({ status: "PENDING", dueDate: "2026-10-06" }, "2026-10-06")).toBe("PENDING");
    expect(effectiveStatus({ status: "PAID", dueDate: "2026-10-01" }, "2026-10-06")).toBe("PAID");
  });
});

describe("dashboardSummary", () => {
  const today = "2026-10-06";
  const items = [
    tx({ amountPaise: 1000_00, dueDate: "2026-10-06" }), // today
    tx({ amountPaise: 200_00, dueDate: "2026-10-12" }), // this week (last day)
    tx({ amountPaise: 300_00, dueDate: "2026-10-13" }), // next week
    tx({ amountPaise: 400_00, dueDate: "2026-10-01" }), // overdue
    tx({ amountPaise: 999_00, dueDate: "2026-10-01", archived: true }), // ignored
    tx({ amountPaise: 5000_00, dueDate: "2026-10-20", direction: "RECEIVE" }),
    tx({ amountPaise: 700_00, dueDate: "2026-10-02", direction: "RECEIVE" }), // overdue receivable
    tx({ amountPaise: 50_00, dueDate: "2026-10-02", status: "PAID" }), // closed
  ];
  const settlements = [
    st({ amountPaise: 250_00, settledOn: "2026-10-02" }),
    st({ amountPaise: 9000_00, settledOn: "2026-10-01", direction: "RECEIVE" }),
    st({ amountPaise: 77_00, settledOn: "2026-09-30" }), // last month
  ];
  const s = dashboardSummary(items, settlements, today);

  it("buckets payables by date", () => {
    expect(s.dueToday.totalPaise).toBe(1000_00);
    expect(s.dueThisWeek.totalPaise).toBe(1200_00);
    expect(s.upcoming.totalPaise).toBe(500_00);
    expect(s.overduePay.totalPaise).toBe(400_00);
  });
  it("keeps receivables separate", () => {
    expect(s.toReceive.totalPaise).toBe(5700_00);
    expect(s.overdueReceive.totalPaise).toBe(700_00);
  });
  it("uses settlements for this month's money movement", () => {
    expect(s.paidThisMonth.totalPaise).toBe(250_00);
    expect(s.receivedThisMonth.totalPaise).toBe(9000_00);
    expect(s.netCashFlow).toBe(8750_00);
    // paid 250 + still due in October (1000 + 200 + 300 + 400)
    expect(s.expensesThisMonth.totalPaise).toBe(2150_00);
  });
});

describe("monthlySummary", () => {
  it("breaks expenses down by category", () => {
    const m = monthlySummary(
      [],
      [
        st({ amountPaise: 300_00, categoryName: "Rent" }),
        st({ amountPaise: 100_00, categoryName: "Food" }),
        st({ amountPaise: 1_00, categoryName: "Food", settledOn: "2026-11-01" }),
      ],
      "2026-10",
      "2026-10-06",
    );
    expect(m.paid.totalPaise).toBe(400_00);
    expect(m.categories).toEqual([
      { name: "Rent", totalPaise: 300_00, share: 0.75 },
      { name: "Food", totalPaise: 100_00, share: 0.25 },
    ]);
  });
});

describe("today(timeZone)", () => {
  it("uses the user's timezone, not the server's", () => {
    const instant = new Date("2026-10-06T20:00:00Z"); // 01:30 on Oct 7 in India
    expect(today("Asia/Kolkata", instant)).toBe("2026-10-07");
    expect(today("UTC", instant)).toBe("2026-10-06");
    expect(today("America/New_York", instant)).toBe("2026-10-06");
  });
});
