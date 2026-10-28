// Server-side validation for the Command Centre forms (goals, loans,
// investments, settings). Amounts arrive as rupee strings and leave as paise.

import { z } from "zod";
import { isISODate } from "./dates";
import { parseDecimal, PRICE_DP, QTY_DP } from "./decimal";
import { GOAL_CATEGORIES, GOAL_PRIORITIES } from "./goals";
import { parseRupees } from "./money";
import { ASSET_TYPES } from "./portfolio";

const date = z.string().trim().refine(isISODate, "Enter a valid date");
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isISODate(v), "Enter a valid date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** Rupees -> paise. `min` is in paise. */
const rupees = (opts: { min?: number; optional?: boolean; message?: string } = {}) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) {
        if (opts.optional) return 0;
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: opts.message ?? "Enter an amount" });
        return z.NEVER;
      }
      const paise = parseRupees(v);
      if (paise === null || paise < (opts.min ?? 1) || paise > 1e15) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: opts.message ?? "Enter a valid amount" });
        return z.NEVER;
      }
      return paise;
    });

const scaled = (places: number, message: string, optional = false) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) {
        if (optional) return null;
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      const n = parseDecimal(v, places);
      if (n === null || n <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return n;
    });

const RECURRING = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;

export const settingsSchema = z
  .object({
    cashBalance: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const neg = v.startsWith("-");
        const paise = parseRupees(neg ? v.slice(1) : v);
        if (paise === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid amount" });
          return z.NEVER;
        }
        return neg ? -paise : paise;
      }),
    cashAsOf: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.cashBalance !== null && !v.cashAsOf) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cashAsOf"], message: "When was this your balance?" });
  });

export const goalSchema = z
  .object({
    name: z.string().trim().min(1, "Give the goal a name").max(80),
    description: optionalText(500),
    target: rupees({ message: "Enter a target amount" }),
    targetDate: optionalDate,
    priority: z.enum(GOAL_PRIORITIES),
    category: z.enum(GOAL_CATEGORIES),
    initial: rupees({ optional: true, min: 0 }),
    planAmount: rupees({ optional: true, min: 0 }),
    planFrequency: z.enum(RECURRING).optional(),
    planStart: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.planAmount > 0 && !v.planStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planStart"], message: "When does the plan start?" });
  });

export const goalEntrySchema = z.object({
  type: z.enum(["CONTRIBUTION", "WITHDRAWAL"]),
  amount: rupees(),
  date,
  note: optionalText(200),
});

export const loanSchema = z.object({
  name: z.string().trim().min(1, "Give the loan a name").max(80),
  lender: optionalText(80),
  principal: rupees({ message: "Enter the loan amount" }),
  rate: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const bps = parseDecimal(v.replace(/%/g, ""), 2);
      if (bps === null || bps > 10_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the annual rate, e.g. 8.5" });
        return z.NEVER;
      }
      return bps;
    }),
  tenure: z.coerce.number({ message: "Enter the tenure in months" }).int("Whole months only").min(1, "At least 1 month").max(600, "At most 50 years"),
  firstEmiDate: date,
  emi: rupees({ optional: true, min: 0 }),
  paidBefore: z.coerce.number().int().min(0).max(600).default(0),
});

export const prepaymentSchema = z.object({ amount: rupees(), date });

export const holdingSchema = z
  .object({
    type: z.enum(ASSET_TYPES),
    name: z.string().trim().min(1, "Give it a name").max(120),
    symbol: optionalText(40).transform((v) => (v ? v.toUpperCase() : null)),
    schemeCode: optionalText(12).refine((v) => v === null || /^\d+$/.test(v), "Scheme codes are numbers"),
    notes: optionalText(500),
    sipAmount: rupees({ optional: true, min: 0 }),
    sipFrequency: z.enum(RECURRING).optional(),
    sipStart: optionalDate,
    sipEnd: optionalDate,
    karat: z.coerce.number().int().min(1).max(24).optional(),
    spread: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? parseDecimal(v.replace(/%/g, ""), 2) : 0))
      .refine((v) => v !== null && v >= 0 && v < 10_000, "Enter a percentage, e.g. 3"),
  })
  .superRefine((v, ctx) => {
    if (v.sipAmount > 0 && !v.sipStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sipStart"], message: "When does the SIP start?" });
    if (v.sipEnd && v.sipStart && v.sipEnd < v.sipStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sipEnd"], message: "End must be after the start" });
  });

export const invTxnSchema = z
  .object({
    type: z.enum(["BUY", "SELL", "DIVIDEND"]),
    date,
    amount: rupees({ optional: true, min: 0 }),
    qty: scaled(QTY_DP, "Enter a quantity (up to 6 decimals)", true),
    price: scaled(PRICE_DP, "Enter a price (up to 4 decimals)", true),
    fee: rupees({ optional: true, min: 0 }),
    sipFor: optionalDate,
    note: optionalText(200),
  })
  .superRefine((v, ctx) => {
    if (v.type === "SELL" && (!v.qty || (!v.price && !v.amount)))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qty"], message: "A sale needs the quantity and the price or proceeds" });
    if (v.type !== "SELL" && !v.amount && !(v.qty && v.price))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Enter the amount, or the quantity and price" });
  });

export const manualPriceSchema = z.object({
  price: scaled(PRICE_DP, "Enter a price (up to 4 decimals)"),
  asOf: date,
});
