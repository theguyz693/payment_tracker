// Investment holdings: FIFO cost basis, realised/unrealised gains, valuation.
//
// Definitions:
// - Contributed:  money put in (BUY amount + fees). Scheduled SIPs are NOT
//   contributions until an actual BUY is recorded.
// - Cost basis:   cost (incl. fees) of the units still held, FIFO.
// - Realised:     net sale proceeds − cost of the units sold (FIFO).
// - Unrealised:   current value − cost basis (only when a price is known).
// - Absolute return = (realised + unrealised + dividends) / contributed.
//   It is NOT annualised; XIRR (money-weighted) is the annualised figure.

import { addDays, monthKey } from "./dates";
import { mulDiv, valuePaise } from "./decimal";
import { nextOccurrenceAfter } from "./recurrence";
import type { Frequency, ISODate } from "./types";
import { xirr, type CashFlow } from "./xirr";

export const ASSET_TYPES = ["MF", "STOCK", "ETF", "GOLD", "OTHER"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_LABEL: Record<AssetType, string> = {
  MF: "Mutual fund",
  STOCK: "Stock",
  ETF: "ETF",
  GOLD: "Gold",
  OTHER: "Other",
};

export type InvTxnType = "BUY" | "SELL" | "DIVIDEND";

export interface InvTxn {
  id: string;
  holdingId: string;
  type: InvTxnType;
  date: ISODate;
  /** Units/shares/grams in micro-units; null when unknown (amount-only MF entries). */
  qtyMicro: number | null;
  /** Price per unit in 1/10,000 ₹; null when unknown. */
  price4: number | null;
  /** BUY: gross cost. SELL: gross proceeds. DIVIDEND: amount received. Excludes fees. */
  amountPaise: number;
  feePaise: number;
  /** For SIP instalments: the scheduled date this BUY fulfils. */
  sipFor: ISODate | null;
  note: string | null;
}

export type SipStatus = "ACTIVE" | "PAUSED" | "STOPPED";

export interface SipPlan {
  amountPaise: number;
  frequency: Exclude<Frequency, "ONE_TIME">;
  anchorDate: ISODate;
  endDate: ISODate | null;
  status: SipStatus;
}

export interface GoldDetails {
  karat: number; // 24, 22, 18 …
  /** Expected discount when selling, in bps of the market value (buy/sell spread, deductions). */
  sellSpreadBps: number;
}

export interface Lot {
  date: ISODate;
  qtyMicro: number;
  costPaise: number;
}

export interface HoldingStats {
  /** Null when some purchases have no quantity recorded. */
  qtyMicro: number | null;
  lots: Lot[];
  contributedPaise: number;
  proceedsPaise: number; // net of fees
  dividendsPaise: number;
  costBasisPaise: number;
  realisedPaise: number;
  /** Average cost per unit (1/10,000 ₹), incl. fees. */
  avgCost4: number | null;
  valuePaise: number | null;
  unrealisedPaise: number | null;
  totalGainPaise: number | null;
  absoluteReturn: number | null;
  /** Cash flows for XIRR (negative = invested). */
  flows: CashFlow[];
}

export class HoldingError extends Error {}

function sortTxns(txns: InvTxn[]): InvTxn[] {
  // Same-day: buys before sells so a same-day round trip works.
  const order: Record<InvTxnType, number> = { BUY: 0, DIVIDEND: 1, SELL: 2 };
  return [...txns].sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type] || a.id.localeCompare(b.id));
}

/**
 * Replay a holding's transactions (FIFO).
 * `price4` is the valuation price per unit (per gram of 24K for gold).
 */
export function computeHolding(txns: InvTxn[], price4: number | null, gold?: GoldDetails): HoldingStats {
  const lots: Lot[] = [];
  let qtyKnown = true;
  let contributed = 0;
  let proceeds = 0;
  let dividends = 0;
  let realised = 0;
  const flows: CashFlow[] = [];

  for (const t of sortTxns(txns)) {
    if (t.type === "BUY") {
      const cost = t.amountPaise + t.feePaise;
      contributed += cost;
      flows.push({ date: t.date, amountPaise: -cost });
      if (t.qtyMicro === null) qtyKnown = false;
      else lots.push({ date: t.date, qtyMicro: t.qtyMicro, costPaise: cost });
    } else if (t.type === "DIVIDEND") {
      dividends += t.amountPaise;
      flows.push({ date: t.date, amountPaise: t.amountPaise });
    } else {
      if (!qtyKnown || t.qtyMicro === null) throw new HoldingError("Record units for every purchase before recording a sale.");
      const net = t.amountPaise - t.feePaise;
      proceeds += net;
      flows.push({ date: t.date, amountPaise: net });
      let toSell = t.qtyMicro;
      let costSold = 0;
      while (toSell > 0) {
        const lot = lots[0];
        if (!lot) throw new HoldingError("You can't sell more units than you hold.");
        const take = Math.min(lot.qtyMicro, toSell);
        const portion = take === lot.qtyMicro ? lot.costPaise : mulDiv(lot.costPaise, take, lot.qtyMicro);
        costSold += portion;
        lot.qtyMicro -= take;
        lot.costPaise -= portion;
        toSell -= take;
        if (lot.qtyMicro === 0) lots.shift();
      }
      realised += net - costSold;
    }
  }

  const qty = qtyKnown ? lots.reduce((a, l) => a + l.qtyMicro, 0) : null;
  // Without quantities there can be no sales (see above), so everything bought is still held.
  const costBasisPaise = qtyKnown ? lots.reduce((a, l) => a + l.costPaise, 0) : contributed;
  let value: number | null = null;
  if (qty !== null && price4 !== null) {
    value = valuePaise(qty, price4);
    if (gold) value = mulDiv(value, gold.karat * (10_000 - gold.sellSpreadBps), 24 * 10_000);
  }
  const unrealised = value !== null ? value - costBasisPaise : null;
  const totalGain = unrealised !== null ? unrealised + realised + dividends : null;

  return {
    qtyMicro: qty,
    lots,
    contributedPaise: contributed,
    proceedsPaise: proceeds,
    dividendsPaise: dividends,
    costBasisPaise,
    realisedPaise: realised,
    avgCost4: qty ? mulDiv(costBasisPaise, 1_000_000 * 10_000, qty * 100) : null,
    valuePaise: value,
    unrealisedPaise: unrealised,
    totalGainPaise: totalGain,
    absoluteReturn: totalGain !== null && contributed > 0 ? totalGain / contributed : null,
    flows,
  };
}

/** Annualised return (XIRR) including the current value as a final inflow on `today`. */
export function holdingXirr(stats: Pick<HoldingStats, "flows" | "valuePaise" | "qtyMicro">, today: ISODate): number | null {
  if (stats.qtyMicro !== null && stats.qtyMicro > 0 && stats.valuePaise === null) return null;
  const flows = [...stats.flows];
  if (stats.valuePaise) flows.push({ date: today, amountPaise: stats.valuePaise });
  return xirr(flows);
}

/** XIRR is only shown once the first investment is at least a year old. */
export function xirrMeaningful(flows: CashFlow[], today: ISODate): boolean {
  const first = flows.reduce<ISODate | null>((m, f) => (!m || f.date < m ? f.date : m), null);
  return !!first && first <= addDays(today, -365);
}

/** Next SIP instalment that hasn't been recorded yet (on or after today). */
export function nextSipDate(plan: SipPlan | null, txns: InvTxn[], today: ISODate): ISODate | null {
  if (!plan || plan.status !== "ACTIVE") return null;
  const recorded = new Set(txns.map((t) => t.sipFor).filter(Boolean));
  let d: ISODate | null = plan.anchorDate >= today ? plan.anchorDate : nextOccurrenceAfter(plan.anchorDate, plan.frequency, addDays(today, -1));
  for (let i = 0; d && i < 400; i++) {
    if (plan.endDate && d > plan.endDate) return null;
    if (!recorded.has(d)) return d;
    d = nextOccurrenceAfter(plan.anchorDate, plan.frequency, d);
  }
  return null;
}

/** Scheduled SIP dates in [from, to] that aren't recorded yet. */
export function sipOccurrences(plan: SipPlan | null, txns: InvTxn[], from: ISODate, to: ISODate): ISODate[] {
  if (!plan || plan.status !== "ACTIVE") return [];
  const recorded = new Set(txns.map((t) => t.sipFor).filter(Boolean));
  const out: ISODate[] = [];
  let d: ISODate | null = plan.anchorDate >= from ? plan.anchorDate : nextOccurrenceAfter(plan.anchorDate, plan.frequency, addDays(from, -1));
  while (d && d <= to && out.length < 1000) {
    if (plan.endDate && d > plan.endDate) break;
    if (!recorded.has(d)) out.push(d);
    d = nextOccurrenceAfter(plan.anchorDate, plan.frequency, d);
  }
  return out;
}

/** Net money invested per month (buys − net sale proceeds). */
export function contributionsByMonth(txns: InvTxn[]): { month: string; investedPaise: number; withdrawnPaise: number }[] {
  const map = new Map<string, { investedPaise: number; withdrawnPaise: number }>();
  for (const t of txns) {
    const m = monthKey(t.date);
    const row = map.get(m) ?? { investedPaise: 0, withdrawnPaise: 0 };
    if (t.type === "BUY") row.investedPaise += t.amountPaise + t.feePaise;
    if (t.type === "SELL") row.withdrawnPaise += t.amountPaise - t.feePaise;
    map.set(m, row);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
}

export interface PortfolioTotals {
  contributedPaise: number;
  proceedsPaise: number;
  dividendsPaise: number;
  costBasisPaise: number;
  /** Sum of holdings with a known value. */
  valuePaise: number;
  /** Holdings with no price/quantity (excluded from value and gains). */
  unvaluedCount: number;
  realisedPaise: number;
  unrealisedPaise: number;
  absoluteReturn: number | null;
  xirr: number | null;
  allocation: { type: AssetType; valuePaise: number; share: number }[];
}

export function portfolioTotals(
  holdings: { type: AssetType; stats: HoldingStats }[],
  today: ISODate,
): PortfolioTotals {
  const valued = holdings.filter((h) => h.stats.valuePaise !== null || h.stats.qtyMicro === 0);
  const sum = (f: (s: HoldingStats) => number) => holdings.reduce((a, h) => a + f(h.stats), 0);
  const value = valued.reduce((a, h) => a + (h.stats.valuePaise ?? 0), 0);
  const unrealised = valued.reduce((a, h) => a + (h.stats.unrealisedPaise ?? 0), 0);
  const realised = sum((s) => s.realisedPaise);
  const dividends = sum((s) => s.dividendsPaise);
  const contributed = sum((s) => s.contributedPaise);
  const unvaluedCount = holdings.length - valued.length;

  const byType = new Map<AssetType, number>();
  for (const h of valued) byType.set(h.type, (byType.get(h.type) ?? 0) + (h.stats.valuePaise ?? 0));
  const allocation = [...byType.entries()]
    .filter(([, v]) => v > 0)
    .map(([type, v]) => ({ type, valuePaise: v, share: value ? v / value : 0 }))
    .sort((a, b) => b.valuePaise - a.valuePaise);

  const flows = holdings.flatMap((h) => h.stats.flows);
  if (value > 0) flows.push({ date: today, amountPaise: value });

  return {
    contributedPaise: contributed,
    proceedsPaise: sum((s) => s.proceedsPaise),
    dividendsPaise: dividends,
    costBasisPaise: sum((s) => s.costBasisPaise),
    valuePaise: value,
    unvaluedCount,
    realisedPaise: realised,
    unrealisedPaise: unrealised,
    absoluteReturn: unvaluedCount === 0 && contributed > 0 ? (realised + unrealised + dividends) / contributed : null,
    xirr: unvaluedCount === 0 ? xirr(flows) : null,
    allocation,
  };
}
