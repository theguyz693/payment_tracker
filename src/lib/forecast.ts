// Financial calendar events and cash-flow forecast.
//
// Everything here is SCHEDULED or EXPECTED — never actual. Rules:
// - Expected receivables count as "expected in", and a second, cautious
//   projection leaves them out entirely (money owed may arrive late or never).
// - Overdue payables are assumed due today; overdue receivables are excluded.
// - Planned goal contributions are money set aside, not spent: they're shown
//   separately and don't change the projected cash balance.
// - A projected balance is only produced when a starting balance is supplied.

import { addDays, monthKey } from "./dates";
import { isActiveOpen, upcomingOccurrences } from "./analytics";
import { nextOccurrenceAfter } from "./recurrence";
import type { GoalPlan } from "./goals";
import { sipOccurrences, type InvTxn, type SipPlan } from "./portfolio";
import type { ISODate, Transaction } from "./types";

export type EventKind = "BILL" | "EMI" | "RECEIVABLE" | "SIP" | "GOAL_CONTRIBUTION" | "GOAL_DEADLINE";

export const EVENT_LABEL: Record<EventKind, string> = {
  BILL: "Bill",
  EMI: "EMI",
  RECEIVABLE: "Expected in",
  SIP: "SIP",
  GOAL_CONTRIBUTION: "Savings",
  GOAL_DEADLINE: "Goal deadline",
};

export interface CalendarEvent {
  id: string;
  date: ISODate;
  kind: EventKind;
  title: string;
  amountPaise: number;
  /** in = cash expected in, out = cash going out, save = set aside, none = marker only */
  flow: "in" | "out" | "save" | "none";
  overdue: boolean;
  href: string;
}

export interface SipSource {
  holdingId: string;
  name: string;
  plan: SipPlan | null;
  txns: InvTxn[];
}

export interface GoalSource {
  id: string;
  name: string;
  plan: GoalPlan | null;
  targetDate: ISODate | null;
  completed: boolean;
  remainingPaise: number;
}

function planDates(plan: GoalPlan, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let d: ISODate | null = plan.anchorDate >= from ? plan.anchorDate : nextOccurrenceAfter(plan.anchorDate, plan.frequency, addDays(from, -1));
  while (d && d <= to && out.length < 1000) {
    out.push(d);
    d = nextOccurrenceAfter(plan.anchorDate, plan.frequency, d);
  }
  return out;
}

export function buildEvents(input: {
  transactions: Transaction[];
  sips: SipSource[];
  goals: GoalSource[];
  from: ISODate;
  to: ISODate;
  today: ISODate;
}): CalendarEvent[] {
  const { from, to, today } = input;
  const events: CalendarEvent[] = [];

  // Overdue items stay on their original date when it's in view.
  for (const o of upcomingOccurrences(input.transactions, from, to)) {
    const kind: EventKind = o.direction === "RECEIVE" ? "RECEIVABLE" : o.loanId ? "EMI" : "BILL";
    events.push({
      id: `tx-${o.transactionId}-${o.date}`,
      date: o.date,
      kind,
      title: o.title,
      amountPaise: o.amountPaise,
      flow: o.direction === "RECEIVE" ? "in" : "out",
      overdue: o.date < today,
      href: `/transactions/${o.transactionId}/edit`,
    });
  }
  for (const s of input.sips) {
    for (const date of sipOccurrences(s.plan, s.txns, from > today ? from : today, to)) {
      events.push({
        id: `sip-${s.holdingId}-${date}`,
        date,
        kind: "SIP",
        title: s.name,
        amountPaise: s.plan?.amountPaise ?? 0,
        flow: "out",
        overdue: false,
        href: `/investments/${s.holdingId}`,
      });
    }
  }
  for (const g of input.goals) {
    if (g.completed) continue;
    if (g.plan) {
      for (const date of planDates(g.plan, from > today ? from : today, to)) {
        events.push({
          id: `goal-${g.id}-${date}`,
          date,
          kind: "GOAL_CONTRIBUTION",
          title: g.name,
          amountPaise: g.plan.amountPaise,
          flow: "save",
          overdue: false,
          href: `/goals/${g.id}`,
        });
      }
    }
    if (g.targetDate && g.targetDate >= from && g.targetDate <= to) {
      events.push({
        id: `goal-deadline-${g.id}`,
        date: g.targetDate,
        kind: "GOAL_DEADLINE",
        title: g.name,
        amountPaise: g.remainingPaise,
        flow: "none",
        overdue: g.targetDate < today,
        href: `/goals/${g.id}`,
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || b.amountPaise - a.amountPaise);
}

export interface ForecastDay {
  date: ISODate;
  inPaise: number;
  outPaise: number;
  savePaise: number;
  /** Projected cash including expected receivables (null without a starting balance). */
  balancePaise: number | null;
  /** Projected cash ignoring every receivable. */
  cautiousBalancePaise: number | null;
}

export interface ForecastMonth {
  month: string;
  inPaise: number;
  outPaise: number;
  savePaise: number;
  netPaise: number;
  endBalancePaise: number | null;
  lowestCautiousPaise: number | null;
  tight: boolean;
  reason: string | null;
}

export interface Forecast {
  days: ForecastDay[];
  months: ForecastMonth[];
  totalInPaise: number;
  totalOutPaise: number;
  totalSavePaise: number;
  overdueReceivePaise: number;
  startingBalancePaise: number | null;
}

/**
 * Daily forecast from `today` for `horizonDays` days.
 * `startingBalancePaise` is the user's estimated cash today, or null.
 */
export function buildForecast(input: {
  transactions: Transaction[];
  sips: SipSource[];
  goals: GoalSource[];
  today: ISODate;
  horizonDays: number;
  startingBalancePaise: number | null;
}): Forecast {
  const { today, horizonDays } = input;
  const end = addDays(today, horizonDays - 1);
  const events = buildEvents({ ...input, from: today, to: end });

  // Overdue payables: assume they're paid today.
  const open = input.transactions.filter(isActiveOpen);
  const overduePay = open.filter((t) => t.direction === "PAY" && t.dueDate < today).reduce((a, t) => a + t.amountPaise, 0);
  const overdueReceive = open.filter((t) => t.direction === "RECEIVE" && t.dueDate < today).reduce((a, t) => a + t.amountPaise, 0);

  const byDate = new Map<ISODate, { in: number; out: number; save: number }>();
  for (const e of events) {
    const row = byDate.get(e.date) ?? { in: 0, out: 0, save: 0 };
    if (e.flow === "in") row.in += e.amountPaise;
    if (e.flow === "out") row.out += e.amountPaise;
    if (e.flow === "save") row.save += e.amountPaise;
    byDate.set(e.date, row);
  }

  const days: ForecastDay[] = [];
  let bal = input.startingBalancePaise;
  let cautious = input.startingBalancePaise;
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(today, i);
    const row = byDate.get(date) ?? { in: 0, out: 0, save: 0 };
    const out = row.out + (i === 0 ? overduePay : 0);
    if (bal !== null) bal = bal + row.in - out;
    if (cautious !== null) cautious = cautious - out;
    days.push({ date, inPaise: row.in, outPaise: out, savePaise: row.save, balancePaise: bal, cautiousBalancePaise: cautious });
  }

  const monthMap = new Map<string, ForecastMonth>();
  for (const d of days) {
    const m = monthKey(d.date);
    const row =
      monthMap.get(m) ??
      { month: m, inPaise: 0, outPaise: 0, savePaise: 0, netPaise: 0, endBalancePaise: null, lowestCautiousPaise: null, tight: false, reason: null };
    row.inPaise += d.inPaise;
    row.outPaise += d.outPaise;
    row.savePaise += d.savePaise;
    row.netPaise = row.inPaise - row.outPaise;
    row.endBalancePaise = d.balancePaise;
    if (d.cautiousBalancePaise !== null) {
      row.lowestCautiousPaise =
        row.lowestCautiousPaise === null ? d.cautiousBalancePaise : Math.min(row.lowestCautiousPaise, d.cautiousBalancePaise);
    }
    monthMap.set(m, row);
  }
  const months = [...monthMap.values()].map((m) => {
    let reason: string | null = null;
    if (m.endBalancePaise !== null && m.endBalancePaise < 0) reason = "Projected balance goes negative";
    else if (m.lowestCautiousPaise !== null && m.lowestCautiousPaise < 0) reason = "Negative if expected money arrives late";
    else if (m.outPaise > m.inPaise && m.outPaise > 0) reason = "More going out than expected in";
    return { ...m, tight: reason !== null, reason };
  });

  return {
    days,
    months,
    totalInPaise: days.reduce((a, d) => a + d.inPaise, 0),
    totalOutPaise: days.reduce((a, d) => a + d.outPaise, 0),
    totalSavePaise: days.reduce((a, d) => a + d.savePaise, 0),
    overdueReceivePaise: overdueReceive,
    startingBalancePaise: input.startingBalancePaise,
  };
}
