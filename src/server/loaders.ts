// Page-level data loading: one place that assembles a user's whole financial
// picture (items, history, goals, loans, investments with valuations).
// Everything is scoped to the userId passed in (from requireUser()).

import "server-only";
import { cache } from "react";
import type { InvestmentFlow } from "@/lib/analytics";
import { viewGoal, type GoalView } from "@/lib/goals";
import { loanStatus, type LoanStatus } from "@/lib/emi";
import {
  ASSET_LABEL,
  computeHolding,
  HoldingError,
  holdingXirr,
  nextSipDate,
  portfolioTotals,
  type HoldingStats,
  type InvTxn,
  type PortfolioTotals,
} from "@/lib/portfolio";
import type { GoalSource, SipSource } from "@/lib/forecast";
import { settlementsToLedger, type LedgerEntry } from "@/lib/ledger";
import type { ISODate, Settlement, Transaction } from "@/lib/types";
import { diffDays } from "@/lib/dates";
import { getSettings, listGoals, listLoans, type Loan, type UserSettings } from "./finance-repo";
import { listHoldings, listInvTxns, type Holding } from "./investments-repo";
import { getQuotes, priceKey, type Quote } from "./prices";
import { loadUserData } from "./repository";

export interface PriceInfo {
  price4: number;
  asOf: ISODate;
  source: string;
  manual: boolean;
  /** Older than a few days: shown with a "stale" warning. */
  stale: boolean;
}

export interface HoldingView {
  holding: Holding;
  txns: InvTxn[];
  stats: HoldingStats;
  price: PriceInfo | null;
  xirr: number | null;
  nextSip: ISODate | null;
  /** Set when the recorded history is inconsistent (shouldn't happen; shown instead of numbers). */
  error: string | null;
}

const STALE_DAYS = 5;

/** Market quote or manual price, whichever is more recent (market wins ties). */
export function pickPrice(h: Holding, quotes: Map<string, Quote>, today: ISODate): PriceInfo | null {
  const q = h.provider && h.providerKey ? quotes.get(priceKey(h.provider, h.providerKey)) : undefined;
  const market = q ? { price4: q.price4, asOf: q.asOf, source: q.source, manual: false } : null;
  const manual = h.manualPrice ? { price4: h.manualPrice.price4, asOf: h.manualPrice.asOf, source: "Entered by you", manual: true } : null;
  const best = market && manual ? (manual.asOf > market.asOf ? manual : market) : (market ?? manual);
  return best ? { ...best, stale: diffDays(today, best.asOf) > STALE_DAYS } : null;
}

export const loadPortfolio = cache(async (userId: string, today: ISODate): Promise<{
  holdings: HoldingView[];
  totals: PortfolioTotals;
  flows: InvestmentFlow[];
}> => {
  const [holdings, txns] = await Promise.all([listHoldings(userId), listInvTxns(userId)]);
  const keys = holdings.filter((h) => h.provider && h.providerKey).map((h) => priceKey(h.provider!, h.providerKey!));
  const quotes = await getQuotes(keys).catch((e) => {
    console.warn("[portfolio] price lookup failed", e);
    return new Map<string, Quote>();
  });

  const views: HoldingView[] = holdings.map((h) => {
    const ht = txns.filter((t) => t.holdingId === h.id);
    const price = pickPrice(h, quotes, today);
    try {
      const stats = computeHolding(ht, price?.price4 ?? null, h.type === "GOLD" ? (h.gold ?? undefined) : undefined);
      return { holding: h, txns: ht, stats, price, xirr: holdingXirr(stats, today), nextSip: nextSipDate(h.sip, ht, today), error: null };
    } catch (e) {
      if (!(e instanceof HoldingError)) throw e;
      const stats = computeHolding(ht.filter((t) => t.type !== "SELL"), null);
      return { holding: h, txns: ht, stats, price, xirr: null, nextSip: nextSipDate(h.sip, ht, today), error: e.message };
    }
  });

  const activeIds = new Set(holdings.map((h) => h.id));
  const flows: InvestmentFlow[] = txns
    .filter((t) => activeIds.has(t.holdingId))
    .map((t) =>
      t.type === "BUY"
        ? { date: t.date, kind: "INVEST" as const, amountPaise: t.amountPaise + t.feePaise }
        : { date: t.date, kind: "DIVEST" as const, amountPaise: t.type === "SELL" ? t.amountPaise - t.feePaise : t.amountPaise },
    );

  return {
    holdings: views,
    totals: portfolioTotals(
      views.map((v) => ({ type: v.holding.type, stats: v.stats })),
      today,
    ),
    flows,
  };
});

export interface LoanView {
  loan: Loan;
  status: LoanStatus;
  linked: Transaction | null;
}

export function viewLoans(loans: Loan[], transactions: Transaction[], settlements: Settlement[]): LoanView[] {
  return loans.map((loan) => {
    const linked = loan.transactionId ? (transactions.find((t) => t.id === loan.transactionId) ?? null) : null;
    const tracked = loan.transactionId ? settlements.filter((s) => s.transactionId === loan.transactionId).length : 0;
    return { loan, status: loanStatus(loan, tracked), linked };
  });
}

/**
 * Estimated cash today: the balance the user entered, moved forward by every
 * actual payment, receipt and investment flow since that date. Null when no
 * starting balance has been entered.
 */
export function estimateCash(
  settings: UserSettings,
  settlements: Settlement[],
  flows: InvestmentFlow[],
  today: ISODate,
): { paise: number; asOf: ISODate } | null {
  if (settings.cashBalancePaise === null || !settings.cashAsOf) return null;
  const after = (d: ISODate) => d > settings.cashAsOf! && d <= today;
  let cash = settings.cashBalancePaise;
  for (const s of settlements) if (after(s.settledOn)) cash += s.direction === "RECEIVE" ? s.amountPaise : -s.amountPaise;
  for (const f of flows) if (after(f.date)) cash += f.kind === "DIVEST" ? f.amountPaise : -f.amountPaise;
  return { paise: cash, asOf: settings.cashAsOf };
}

export interface FinancialPicture {
  transactions: Transaction[];
  settlements: Settlement[];
  goals: GoalView[];
  loans: LoanView[];
  portfolio: Awaited<ReturnType<typeof loadPortfolio>>;
  settings: UserSettings;
  cash: { paise: number; asOf: ISODate } | null;
  sipSources: SipSource[];
  goalSources: GoalSource[];
}

/** Everything the overview, calendar, analytics and ledger need. */
export const loadFinancialPicture = cache(async (userId: string, today: ISODate): Promise<FinancialPicture> => {
  const [{ transactions, settlements }, goals, loans, portfolio, settings] = await Promise.all([
    loadUserData(userId),
    listGoals(userId),
    listLoans(userId),
    loadPortfolio(userId, today),
    getSettings(userId),
  ]);
  const goalViews = goals.map((g) => viewGoal(g, today));
  return {
    transactions,
    settlements,
    goals: goalViews,
    loans: viewLoans(loans, transactions, settlements),
    portfolio,
    settings,
    cash: estimateCash(settings, settlements, portfolio.flows, today),
    sipSources: portfolio.holdings.map((h) => ({ holdingId: h.holding.id, name: h.holding.name, plan: h.holding.sip, txns: h.txns })),
    goalSources: goalViews.map((g) => ({
      id: g.id,
      name: g.name,
      plan: g.plan,
      targetDate: g.targetDate,
      completed: g.status === "COMPLETED",
      remainingPaise: g.remainingPaise,
    })),
  };
});

/** Every actual event, newest first (payments, receipts, goal entries, investment transactions). */
export function buildLedger(fp: FinancialPicture): LedgerEntry[] {
  const entries = settlementsToLedger(fp.settlements);
  for (const g of fp.goals) {
    for (const e of g.entries) {
      entries.push({
        id: e.id,
        date: e.date,
        type: e.type === "CONTRIBUTION" ? "GOAL_IN" : "GOAL_OUT",
        title: g.name,
        category: "Savings goal",
        group: "GOAL",
        amountPaise: e.amountPaise,
        flow: "internal",
        counterparty: null,
        notes: e.note,
        symbol: null,
        href: `/goals/${g.id}`,
        receiptable: false,
      });
    }
  }
  for (const h of fp.portfolio.holdings) {
    for (const t of h.txns) {
      entries.push({
        id: t.id,
        date: t.date,
        type: t.type === "BUY" ? "INVEST" : t.type === "SELL" ? "DIVEST" : "DIVIDEND",
        title: h.holding.name,
        category: ASSET_LABEL[h.holding.type],
        group: h.holding.type,
        amountPaise: t.type === "BUY" ? t.amountPaise + t.feePaise : t.type === "SELL" ? t.amountPaise - t.feePaise : t.amountPaise,
        flow: t.type === "BUY" ? "out" : "in",
        counterparty: null,
        notes: t.note,
        symbol: h.holding.symbol ?? h.holding.providerKey,
        href: `/investments/${h.holding.id}`,
        receiptable: false,
      });
    }
  }
  return entries;
}
