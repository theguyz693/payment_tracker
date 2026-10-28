// "Download my data": CSV per record type and one JSON file with everything.
// Every function takes the authenticated userId (from the session) and reads
// only that user's records through the user-scoped repositories.

import "server-only";
import { toCsv } from "@/lib/ledger";
import { formatScaled, PRICE_DP, QTY_DP } from "@/lib/decimal";
import { FREQUENCY_LABEL } from "@/lib/types";
import { getSettings, listGoals, listLoans } from "./finance-repo";
import { listHoldings, listInvTxns } from "./investments-repo";
import { loadUserData } from "./repository";

const rupees = (paise: number | null) => (paise === null ? null : (paise / 100).toFixed(2));

export const EXPORT_KINDS = ["items", "goals", "loans", "investments", "all"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export async function exportItemsCsv(userId: string): Promise<string> {
  const { transactions } = await loadUserData(userId, { includeArchived: true });
  return toCsv([
    ["Title", "Direction", "Amount (INR)", "Category", "Frequency", "Next due", "Start", "End", "Status", "Paused", "Archived", "Counterparty", "Notes", "Last settled"],
    ...transactions.map((t) => [
      t.title,
      t.direction,
      rupees(t.amountPaise),
      t.category.name,
      FREQUENCY_LABEL[t.frequency],
      t.dueDate,
      t.startDate,
      t.endDate,
      t.status,
      t.paused ? "yes" : "no",
      t.archived ? "yes" : "no",
      t.counterparty,
      t.notes,
      t.lastSettledOn,
    ]),
  ]);
}

export async function exportGoalsCsv(userId: string): Promise<string> {
  const goals = await listGoals(userId, { includeArchived: true });
  return toCsv([
    ["Goal", "Target (INR)", "Target date", "Priority", "Category", "Entry date", "Entry type", "Entry amount (INR)", "Note"],
    ...goals.flatMap((g) =>
      g.entries.length
        ? g.entries.map((e) => [g.name, rupees(g.targetPaise), g.targetDate, g.priority, g.category, e.date, e.type, rupees(e.amountPaise), e.note])
        : [[g.name, rupees(g.targetPaise), g.targetDate, g.priority, g.category, null, null, null, null]],
    ),
  ]);
}

export async function exportLoansCsv(userId: string): Promise<string> {
  const loans = await listLoans(userId);
  return toCsv([
    ["Loan", "Lender", "Principal (INR)", "Rate (%)", "Tenure (months)", "First EMI", "EMI (INR)", "EMIs paid before tracking", "Prepayment date", "Prepayment (INR)"],
    ...loans.flatMap((l) => {
      const base = [l.name, l.lender, rupees(l.principalPaise), (l.annualRateBps / 100).toFixed(2), l.tenureMonths, l.firstEmiDate, rupees(l.emiPaise), l.paidBeforeTracking];
      return l.prepayments.length ? l.prepayments.map((p) => [...base, p.date, rupees(p.amountPaise)]) : [[...base, null, null]];
    }),
  ]);
}

export async function exportInvestmentsCsv(userId: string): Promise<string> {
  const [holdings, txns] = await Promise.all([listHoldings(userId, { includeArchived: true }), listInvTxns(userId)]);
  const byId = new Map(holdings.map((h) => [h.id, h]));
  return toCsv([
    ["Holding", "Type", "Symbol / scheme code", "Date", "Transaction", "Quantity", "Price (INR)", "Amount (INR)", "Fees (INR)", "SIP date", "Note"],
    ...txns.map((t) => {
      const h = byId.get(t.holdingId);
      return [
        h?.name ?? "(removed)",
        h?.type ?? null,
        h?.symbol ?? h?.providerKey ?? null,
        t.date,
        t.type,
        t.qtyMicro === null ? null : formatScaled(t.qtyMicro, QTY_DP).replace(/,/g, ""),
        t.price4 === null ? null : formatScaled(t.price4, PRICE_DP).replace(/,/g, ""),
        rupees(t.amountPaise),
        rupees(t.feePaise),
        t.sipFor,
        t.note,
      ];
    }),
  ]);
}

/** Everything, as structured JSON (amounts in paise, as stored). */
export async function exportAllJson(userId: string, account: { name: string; email: string }): Promise<string> {
  const [{ transactions, settlements }, goals, loans, holdings, investmentTxns, settings] = await Promise.all([
    loadUserData(userId, { includeArchived: true }),
    listGoals(userId, { includeArchived: true }),
    listLoans(userId),
    listHoldings(userId, { includeArchived: true }),
    listInvTxns(userId),
    getSettings(userId),
  ]);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      note: "Amounts are integer paise (₹1 = 100). Quantities are micro-units (÷1,000,000); prices are ÷10,000 rupees.",
      account,
      settings,
      transactions,
      paymentHistory: settlements,
      goals,
      loans,
      holdings,
      investmentTransactions: investmentTxns,
    },
    null,
    2,
  );
}
