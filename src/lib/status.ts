import type { ISODate, Status, Transaction } from "./types";

/** Stored status plus date check: a PENDING item past its due date is OVERDUE. */
export function effectiveStatus(tx: Pick<Transaction, "status" | "dueDate">, today: ISODate): Status {
  if (tx.status === "PENDING" && tx.dueDate < today) return "OVERDUE";
  return tx.status;
}

export function isOpen(tx: Pick<Transaction, "status">): boolean {
  return tx.status === "PENDING";
}
