// Savings goals: balances from an entry ledger, projections and status.
//
// The saved balance is ALWAYS the sum of entries (contributions − withdrawals);
// it is never stored or overwritten. Goal money is earmarked from the user's
// own cash, so it is neither income nor spending.

import { addDays, addMonths, diffDays } from "./dates";
import { nextOccurrenceAfter } from "./recurrence";
import type { Frequency, ISODate } from "./types";

export const GOAL_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type GoalPriority = (typeof GOAL_PRIORITIES)[number];

export const GOAL_CATEGORIES = [
  "Emergency fund",
  "Gadgets",
  "Education",
  "Travel",
  "Insurance",
  "Home",
  "Vehicle",
  "Big purchase",
  "Other",
] as const;

export interface GoalEntry {
  id: string;
  type: "CONTRIBUTION" | "WITHDRAWAL";
  amountPaise: number;
  date: ISODate;
  note: string | null;
}

export interface GoalPlan {
  amountPaise: number;
  frequency: Exclude<Frequency, "ONE_TIME">;
  /** First planned contribution date; later ones follow the recurrence rule. */
  anchorDate: ISODate;
}

export interface Goal {
  id: string;
  name: string;
  description: string | null;
  targetPaise: number;
  targetDate: ISODate | null;
  priority: GoalPriority;
  category: string;
  plan: GoalPlan | null;
  entries: GoalEntry[];
  archived: boolean;
}

export type GoalStatus = "COMPLETED" | "OVERDUE" | "ON_TRACK" | "BEHIND" | "NO_DEADLINE";

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  COMPLETED: "Completed",
  OVERDUE: "Past target date",
  ON_TRACK: "On track",
  BEHIND: "Behind",
  NO_DEADLINE: "No deadline",
};

export function savedPaise(entries: GoalEntry[]): number {
  return entries.reduce((a, e) => a + (e.type === "CONTRIBUTION" ? e.amountPaise : -e.amountPaise), 0);
}

/** Whole months from `from` to `to` (at least 1 when to > from). */
export function monthsUntil(from: ISODate, to: ISODate): number {
  if (to <= from) return 0;
  let n = 0;
  while (addMonths(from, n + 1) <= to && n < 1200) n++;
  return Math.max(1, n);
}

/** Saving needed per month (rounded up to the paise) to hit the target on time. */
export function requiredMonthly(remainingPaise: number, today: ISODate, targetDate: ISODate | null): number | null {
  if (remainingPaise <= 0) return 0;
  if (!targetDate || targetDate <= today) return null;
  return Math.ceil(remainingPaise / monthsUntil(today, targetDate));
}

/** Planned contribution dates strictly after `after`, up to `limit` dates. */
function planDatesAfter(plan: GoalPlan, after: ISODate, limit: number): ISODate[] {
  const out: ISODate[] = [];
  let d: ISODate | null = plan.anchorDate > after ? plan.anchorDate : nextOccurrenceAfter(plan.anchorDate, plan.frequency, after);
  while (d && out.length < limit) {
    out.push(d);
    d = nextOccurrenceAfter(plan.anchorDate, plan.frequency, d);
  }
  return out;
}

/** Next planned contribution on or after today. */
export function nextPlannedContribution(plan: GoalPlan | null, today: ISODate): ISODate | null {
  if (!plan) return null;
  if (plan.anchorDate >= today) return plan.anchorDate;
  return nextOccurrenceAfter(plan.anchorDate, plan.frequency, addDays(today, -1));
}

/**
 * When the goal would be reached if the plan continues from today
 * (no interest assumed). Null without a plan, or beyond 50 years.
 */
export function projectedCompletion(saved: number, target: number, plan: GoalPlan | null, today: ISODate): ISODate | null {
  if (saved >= target) return today;
  if (!plan || plan.amountPaise <= 0) return null;
  const needed = Math.ceil((target - saved) / plan.amountPaise);
  if (needed > 50 * 365) return null;
  const dates = planDatesAfter(plan, addDays(today, -1), needed);
  return dates.length === needed ? dates[needed - 1] : null;
}

export interface GoalView extends Goal {
  savedPaise: number;
  remainingPaise: number;
  progress: number; // 0..1
  requiredMonthlyPaise: number | null;
  projectedDate: ISODate | null;
  nextContribution: ISODate | null;
  status: GoalStatus;
  daysLeft: number | null;
}

export function viewGoal(goal: Goal, today: ISODate): GoalView {
  const saved = savedPaise(goal.entries);
  const remaining = Math.max(0, goal.targetPaise - saved);
  const projected = projectedCompletion(saved, goal.targetPaise, goal.plan, today);
  let status: GoalStatus;
  if (saved >= goal.targetPaise) status = "COMPLETED";
  else if (!goal.targetDate) status = "NO_DEADLINE";
  else if (goal.targetDate < today) status = "OVERDUE";
  else status = projected && projected <= goal.targetDate ? "ON_TRACK" : "BEHIND";

  return {
    ...goal,
    savedPaise: saved,
    remainingPaise: remaining,
    progress: goal.targetPaise ? Math.min(1, Math.max(0, saved / goal.targetPaise)) : 0,
    requiredMonthlyPaise: requiredMonthly(remaining, today, goal.targetDate),
    projectedDate: projected,
    nextContribution: status === "COMPLETED" ? null : nextPlannedContribution(goal.plan, today),
    status,
    daysLeft: goal.targetDate ? diffDays(goal.targetDate, today) : null,
  };
}

// ---- Scenario calculator ("if I save ₹X a month…") ----

export interface SavingsProjection {
  months: { month: number; contributedPaise: number; interestPaise: number; balancePaise: number }[];
  contributedPaise: number;
  interestPaise: number;
  balancePaise: number;
}

/**
 * Monthly contributions (made at the start of each month) with optional
 * monthly-compounded interest. Interest is HYPOTHETICAL and rounded to the
 * paise each month (half away from zero).
 */
export function projectSavings(input: {
  startingPaise: number;
  monthlyPaise: number;
  months: number;
  annualRateBps: number;
}): SavingsProjection {
  const r = input.annualRateBps / 10_000 / 12;
  let balance = input.startingPaise;
  let contributed = input.startingPaise;
  let interest = 0;
  const rows: SavingsProjection["months"] = [];
  const months = Math.min(Math.max(0, Math.floor(input.months)), 1200);
  for (let m = 1; m <= months; m++) {
    balance += input.monthlyPaise;
    contributed += input.monthlyPaise;
    const i = Math.round(balance * r);
    balance += i;
    interest += i;
    rows.push({ month: m, contributedPaise: contributed, interestPaise: interest, balancePaise: balance });
  }
  return { months: rows, contributedPaise: contributed, interestPaise: interest, balancePaise: balance };
}
