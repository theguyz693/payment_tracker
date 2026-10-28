// Domain types shared by UI, business logic and data access.
// Kept free of database imports so the UI and logic don't depend on the DB layer.

export const DIRECTIONS = ["PAY", "RECEIVE"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const FREQUENCIES = ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Stored status. OVERDUE is never stored — it is derived from the due date. */
export const STORED_STATUSES = ["PENDING", "PAID", "RECEIVED"] as const;
export type StoredStatus = (typeof STORED_STATUSES)[number];

/** Status as shown to the user. */
export type Status = StoredStatus | "OVERDUE";

/** Calendar date in "YYYY-MM-DD" form. */
export type ISODate = string;

export interface Category {
  id: string;
  name: string;
  direction: Direction;
}

export interface Transaction {
  id: string;
  title: string;
  amountPaise: number;
  direction: Direction;
  frequency: Frequency;
  category: Category;
  counterparty: string | null;
  notes: string | null;
  startDate: ISODate;
  anchorDate: ISODate;
  dueDate: ISODate;
  endDate: ISODate | null;
  status: StoredStatus;
  archived: boolean;
  lastSettledOn: ISODate | null;
  /** Paused recurring items have no upcoming occurrences and are never overdue. */
  paused: boolean;
  /** Amount edits, oldest first (price-change history). */
  amountChanges: AmountChange[];
  /** Loan whose EMI this item tracks (see Loans). */
  loanId: string | null;
}

export interface AmountChange {
  fromPaise: number;
  toPaise: number;
  changedOn: ISODate;
}

export interface Settlement {
  /** Stable id of the history entry (used for receipts and the ledger). */
  id: string;
  transactionId: string;
  title: string;
  direction: Direction;
  categoryId: string;
  categoryName: string;
  counterparty: string | null;
  notes: string | null;
  amountPaise: number;
  dueDate: ISODate;
  settledOn: ISODate;
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  ONE_TIME: "One-time",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export const DEFAULT_CATEGORIES: Record<Direction, string[]> = {
  PAY: [
    "EMI / Loan",
    "Rent",
    "Utilities",
    "Electricity",
    "Internet",
    "Insurance",
    "Subscription",
    "Credit Card",
    "Education",
    "Shopping",
    "Food",
    "Transport",
    "Medical",
    "Other",
  ],
  RECEIVE: ["Salary", "Rent Received", "Freelance", "Refund", "Interest", "Loan Repayment", "Other"],
};

/** Stable id for a default category, e.g. "PAY:Rent". */
export function categoryId(direction: Direction, name: string): string {
  return `${direction}:${name}`;
}

/** Default categories, in display order. Stored on transactions by id. */
export const CATEGORIES: Category[] = (["PAY", "RECEIVE"] as const).flatMap((direction) =>
  DEFAULT_CATEGORIES[direction].map((name) => ({ id: categoryId(direction, name), name, direction })),
);

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
