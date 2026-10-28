// XIRR: the annualised money-weighted return of dated cash flows.
// Negative amounts are money put in, positive amounts are money taken out
// (including the current value as a final "as if sold today" flow).

import { diffDays } from "./dates";
import type { ISODate } from "./types";

export interface CashFlow {
  date: ISODate;
  amountPaise: number;
}

function npv(rate: number, flows: CashFlow[], t0: ISODate): number {
  return flows.reduce((acc, f) => acc + f.amountPaise / Math.pow(1 + rate, diffDays(f.date, t0) / 365), 0);
}

function dnpv(rate: number, flows: CashFlow[], t0: ISODate): number {
  return flows.reduce((acc, f) => {
    const t = diffDays(f.date, t0) / 365;
    return acc - (t * f.amountPaise) / Math.pow(1 + rate, t + 1);
  }, 0);
}

/** Annual rate as a ratio (0.12 = 12%), or null when it can't be determined. */
export function xirr(flows: CashFlow[]): number | null {
  const nonZero = flows.filter((f) => f.amountPaise !== 0);
  if (!nonZero.some((f) => f.amountPaise < 0) || !nonZero.some((f) => f.amountPaise > 0)) return null;
  const t0 = nonZero.reduce((m, f) => (f.date < m ? f.date : m), nonZero[0].date);
  if (nonZero.every((f) => f.date === t0)) return null;

  // Newton's method from a sensible guess, then bisection as a fallback.
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate, nonZero, t0);
    const d = dnpv(rate, nonZero, t0);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = rate - v / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }

  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo, nonZero, t0);
  const fHi = npv(hi, nonZero, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, nonZero, t0);
    if (Math.abs(fMid) < 1e-6 || hi - lo < 1e-10) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
