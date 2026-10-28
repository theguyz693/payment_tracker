// Builders for unit tests.
import type { Settlement, Transaction } from "@/lib/types";

const cat = { id: "PAY:Rent", name: "Rent", direction: "PAY" as const };

export function tx(p: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    title: "x",
    amountPaise: 100_00,
    direction: "PAY",
    frequency: "ONE_TIME",
    category: cat,
    counterparty: null,
    notes: null,
    startDate: "2026-10-01",
    anchorDate: "2026-10-01",
    dueDate: "2026-10-06",
    endDate: null,
    status: "PENDING",
    archived: false,
    lastSettledOn: null,
    paused: false,
    amountChanges: [],
    loanId: null,
    ...p,
  };
}

export function st(p: Partial<Settlement>): Settlement {
  return {
    id: Math.random().toString(36).slice(2),
    transactionId: "t",
    title: "x",
    direction: "PAY",
    categoryId: "PAY:Rent",
    categoryName: "Rent",
    counterparty: null,
    notes: null,
    amountPaise: 100_00,
    dueDate: "2026-10-01",
    settledOn: "2026-10-01",
    ...p,
  };
}
