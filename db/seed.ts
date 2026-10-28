// DEVELOPMENT ONLY: loads realistic sample data into ONE existing account.
//
//   npm run db:seed -- --local                            (login turned off: adds to the local user)
//   npm run db:seed -- --email you@example.com            (adds sample items)
//   npm run db:seed -- --email you@example.com --replace  (deletes that account's items first)
//
// Refuses to run when NODE_ENV=production. Sign up in the app first, then run
// this with the same email. Never touches any other account.
// Dates are relative to today so the dashboard always has something to show.

import { MongoClient, ObjectId } from "mongodb";
import { addDays, addMonths, today as getToday } from "../src/lib/dates";
import { categoryId, type Direction, type Frequency } from "../src/lib/types";

try {
  process.loadEnvFile?.(".env.local");
} catch {}
try {
  process.loadEnvFile?.(".env");
} catch {}

const T = getToday(process.env.DEFAULT_TIMEZONE || "Asia/Kolkata");
const rupees = (n: number) => Math.round(n * 100);

interface SeedItem {
  title: string;
  amount: number;
  direction: Direction;
  category: string;
  frequency: Frequency;
  dueDate: string; // next due (current occurrence)
  counterparty?: string;
  notes?: string;
  /** Earlier occurrences already settled: [dueDate, settledOn] */
  history?: [string, string][];
  /** One-time item already settled on this date. */
  settledOn?: string;
}

function monthlyHistory(due: string, settledOffsetDays = 0): [string, string][] {
  const prev = addMonths(due, -1);
  return [[prev, addDays(prev, settledOffsetDays)]];
}

const firstOfThisMonth = `${T.slice(0, 7)}-01`;

const items: SeedItem[] = [
  // ---- PAY ----
  {
    title: "Home Rent", amount: 25000, direction: "PAY", category: "Rent", frequency: "MONTHLY",
    dueDate: addDays(T, 2), counterparty: "Landlord", history: monthlyHistory(addDays(T, 2), -1),
  },
  {
    title: "Car EMI", amount: 12500, direction: "PAY", category: "EMI / Loan", frequency: "MONTHLY",
    dueDate: addDays(T, -3), counterparty: "HDFC Bank", notes: "Auto-debit failed — pay manually",
    history: monthlyHistory(addDays(T, -3)),
  },
  {
    title: "Electricity", amount: 2100, direction: "PAY", category: "Electricity", frequency: "MONTHLY",
    dueDate: T, counterparty: "BESCOM", history: monthlyHistory(T, -2),
  },
  {
    title: "Internet", amount: 999, direction: "PAY", category: "Internet", frequency: "MONTHLY",
    dueDate: addDays(T, 5), counterparty: "Airtel Xstream",
  },
  {
    title: "Netflix", amount: 649, direction: "PAY", category: "Subscription", frequency: "MONTHLY",
    dueDate: addDays(T, 12), counterparty: "Netflix", history: monthlyHistory(addDays(T, 12)),
  },
  {
    title: "Health insurance premium", amount: 18400, direction: "PAY", category: "Insurance", frequency: "YEARLY",
    dueDate: addDays(T, 40), counterparty: "Star Health",
  },
  {
    title: "Laptop repair", amount: 4500, direction: "PAY", category: "Other", frequency: "ONE_TIME",
    dueDate: addDays(T, -2), counterparty: "Service centre", settledOn: addDays(T, -2),
  },
  {
    title: "Bought headphones", amount: 3500, direction: "PAY", category: "Shopping", frequency: "ONE_TIME",
    dueDate: T, settledOn: T,
  },
  // ---- RECEIVE ----
  {
    title: "Rent from Rahul", amount: 18000, direction: "RECEIVE", category: "Rent Received", frequency: "MONTHLY",
    dueDate: addDays(T, 1), counterparty: "Rahul - Tenant", notes: "Apartment 2",
    history: monthlyHistory(addDays(T, 1), 1),
  },
  {
    title: "Freelance project", amount: 15000, direction: "RECEIVE", category: "Freelance", frequency: "ONE_TIME",
    dueDate: addDays(T, -4), counterparty: "Studio Kite", notes: "Invoice #014 — landing page",
  },
  {
    title: "Salary", amount: 80000, direction: "RECEIVE", category: "Salary", frequency: "MONTHLY",
    dueDate: addMonths(firstOfThisMonth, 1), counterparty: "Employer",
    history: [[firstOfThisMonth, firstOfThisMonth], [addMonths(firstOfThisMonth, -1), addMonths(firstOfThisMonth, -1)]],
  },
  {
    title: "Order refund", amount: 1299, direction: "RECEIVE", category: "Refund", frequency: "ONE_TIME",
    dueDate: addDays(T, -1), counterparty: "Amazon", settledOn: addDays(T, -1),
  },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production. The seed is for development only.");
  }
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const email = local ? "local user" : args[args.indexOf("--email") + 1];
  if (!local && (!args.includes("--email") || !email || email.startsWith("--"))) {
    throw new Error("Usage: npm run db:seed -- --email you@example.com [--replace]   (or --local while login is off)");
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (add it to .env.local).");

  const client = new MongoClient(uri);
  try {
    const db = client.db(process.env.MONGODB_DB || "payment_tracker");
    let userId = "local-user"; // AUTH DISABLED mode uses this fixed id (see src/server/session.ts)
    if (!local) {
      const user = await db.collection("user").findOne({ email: email.toLowerCase() });
      if (!user) throw new Error(`No account with email ${email}. Sign up in the app first.`);
      userId = String(user._id);
    }
    const col = db.collection("transactions");

    if (args.includes("--replace")) {
      const { deletedCount } = await col.deleteMany({ userId });
      console.log(`Removed ${deletedCount} existing items for ${email}.`);
    }

    const now = new Date();
    const docs = items.map((item) => {
      const anchor = item.history?.length ? item.history[item.history.length - 1][0] : item.dueDate;
      const settledOneTime = item.frequency === "ONE_TIME" && !!item.settledOn;
      const history = [...(item.history ?? [])];
      if (settledOneTime) history.push([item.dueDate, item.settledOn!]);
      return {
        _id: new ObjectId(),
        userId,
        title: item.title,
        amountPaise: rupees(item.amount),
        direction: item.direction,
        frequency: item.frequency,
        categoryId: categoryId(item.direction, item.category),
        counterparty: item.counterparty ?? null,
        notes: item.notes ?? null,
        startDate: anchor,
        anchorDate: anchor,
        dueDate: item.dueDate,
        endDate: null,
        status: settledOneTime ? (item.direction === "PAY" ? "PAID" : "RECEIVED") : "PENDING",
        archivedAt: null,
        history: history.map(([dueDate, settledOn]) => ({
          dueDate,
          settledOn,
          amountPaise: rupees(item.amount),
          createdAt: now,
        })),
        createdAt: now,
        updatedAt: now,
      };
    });
    await col.insertMany(docs);
    console.log(`Added ${docs.length} sample items to ${email} (today = ${T}).`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
