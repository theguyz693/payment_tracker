// Fixed-rate EMI and amortisation maths (illustrative, not a lender's schedule).
//
// Assumptions, shown in the UI:
// - Fixed annual rate, monthly reducing balance, interest = balance × rate/12.
// - Interest is rounded to the paise (half away from zero) each month; the EMI
//   is rounded up to the paise.
// - The final instalment is adjusted so the balance reaches exactly zero.
// - Prepayments are applied right after that month's EMI and, by default,
//   shorten the tenure (EMI unchanged). "reduce_emi" keeps the tenure instead.

import { addMonths } from "./dates";
import type { ISODate } from "./types";

/** Monthly EMI in paise for a principal, annual rate (bps) and tenure (months). */
export function computeEmi(principalPaise: number, annualRateBps: number, months: number): number {
  if (principalPaise <= 0 || months <= 0) return 0;
  const r = annualRateBps / 10_000 / 12;
  if (r === 0) return Math.ceil(principalPaise / months);
  const f = Math.pow(1 + r, months);
  // Rounded UP so the loan always closes within the tenure (the last EMI absorbs the difference).
  return Math.ceil((principalPaise * r * f) / (f - 1) - 1e-9);
}

export interface Prepayment {
  /** Instalment number (1-based) after which the prepayment is made. */
  afterInstalment: number;
  amountPaise: number;
}

export interface AmortisationRow {
  n: number;
  date: ISODate;
  openingPaise: number;
  emiPaise: number;
  interestPaise: number;
  principalPaise: number;
  prepaymentPaise: number;
  closingPaise: number;
}

export interface Schedule {
  rows: AmortisationRow[];
  emiPaise: number; // initial EMI
  totalInterestPaise: number;
  totalPaidPaise: number; // principal + interest (+ prepayments)
  months: number;
  payoffDate: ISODate | null;
}

export function amortise(input: {
  principalPaise: number;
  annualRateBps: number;
  months: number;
  firstEmiDate: ISODate;
  /** Lender's EMI if known; otherwise computed. */
  emiPaise?: number;
  prepayments?: Prepayment[];
  mode?: "reduce_tenure" | "reduce_emi";
}): Schedule {
  const r = input.annualRateBps / 10_000 / 12;
  const initialEmi = input.emiPaise ?? computeEmi(input.principalPaise, input.annualRateBps, input.months);
  const prepay = new Map<number, number>();
  for (const p of input.prepayments ?? []) prepay.set(p.afterInstalment, (prepay.get(p.afterInstalment) ?? 0) + p.amountPaise);

  const rows: AmortisationRow[] = [];
  let balance = input.principalPaise;
  let emi = initialEmi;
  // Hard stop guards against an EMI that never covers the interest.
  const maxMonths = Math.max(input.months, 1) * 3 + 12;
  for (let n = 1; balance > 0 && n <= maxMonths; n++) {
    const interest = Math.round(balance * r);
    if (emi <= interest && r > 0) break; // negative amortisation: schedule can't complete
    let principal = emi - interest;
    let pay = emi;
    if (principal >= balance) {
      principal = balance;
      pay = balance + interest;
    }
    let closing = balance - principal;
    const extra = Math.min(prepay.get(n) ?? 0, closing);
    closing -= extra;
    rows.push({
      n,
      date: addMonths(input.firstEmiDate, n - 1),
      openingPaise: balance,
      emiPaise: pay,
      interestPaise: interest,
      principalPaise: principal,
      prepaymentPaise: extra,
      closingPaise: closing,
    });
    balance = closing;
    if (extra > 0 && input.mode === "reduce_emi" && balance > 0) {
      emi = computeEmi(balance, input.annualRateBps, Math.max(1, input.months - n));
    }
  }
  const totalInterest = rows.reduce((a, x) => a + x.interestPaise, 0);
  const totalPaid = rows.reduce((a, x) => a + x.emiPaise + x.prepaymentPaise, 0);
  return {
    rows,
    emiPaise: initialEmi,
    totalInterestPaise: totalInterest,
    totalPaidPaise: totalPaid,
    months: rows.length,
    payoffDate: balance === 0 && rows.length ? rows[rows.length - 1].date : null,
  };
}

/** Outstanding principal after `paidInstalments` EMIs (null if beyond the schedule). */
export function outstandingAfter(schedule: Schedule, paidInstalments: number): number {
  if (paidInstalments <= 0) return schedule.rows[0]?.openingPaise ?? 0;
  const row = schedule.rows[Math.min(paidInstalments, schedule.rows.length) - 1];
  return row ? row.closingPaise : 0;
}

export interface Scenario {
  label: string;
  annualRateBps: number;
  months: number;
  prepaymentPaise: number;
  afterInstalment: number;
}

export interface ScenarioResult extends Scenario {
  emiPaise: number;
  totalInterestPaise: number;
  totalPaidPaise: number;
  actualMonths: number;
}

/** Compare alternative rates / tenures / one-off prepayments for the same principal. */
export function compareScenarios(principalPaise: number, firstEmiDate: ISODate, scenarios: Scenario[]): ScenarioResult[] {
  return scenarios.map((s) => {
    const sch = amortise({
      principalPaise,
      annualRateBps: s.annualRateBps,
      months: s.months,
      firstEmiDate,
      prepayments: s.prepaymentPaise > 0 ? [{ afterInstalment: s.afterInstalment, amountPaise: s.prepaymentPaise }] : [],
    });
    return {
      ...s,
      emiPaise: sch.emiPaise,
      totalInterestPaise: sch.totalInterestPaise,
      totalPaidPaise: sch.totalPaidPaise,
      actualMonths: sch.months,
    };
  });
}
