// Zod schemas for the Integrations Hub forms (server boundary).

import { z } from "zod";
import { isISODate } from "../dates";
import { parseDecimal } from "../decimal";
import { parseRupees } from "../money";
import { FREQUENCIES } from "../types";

const amount = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = parseRupees(v);
    if (p === null || p <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount greater than 0" });
      return z.NEVER;
    }
    return p;
  });
const date = z.string().trim().refine(isISODate, "Enter a valid date");
const text = (max: number, label = "This field") => z.string().trim().min(1, `${label} is required`).max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const vpa = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[\w.\-]{2,}@[A-Za-z][\w]{1,}$/.test(v), "Use a demo UPI ID like name@okdemo");
const demoFail = z
  .string()
  .optional()
  .transform((v) => Math.min(Math.max(Number(v) || 0, 0), 3));
const flag = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const upiSimSchema = z.object({
  provider: z.enum(["gpay_sim", "phonepe_sim"], { message: "Choose a simulated UPI app" }),
  flow: z.enum(["debit", "credit"]),
  name: text(80, "Name"),
  vpa,
  amount,
  note: optional(140),
  categoryId: optional(60),
  outcome: z.enum(["SUCCESS", "PENDING", "FAILED"]),
  failFirstAttempts: demoFail,
  simulateCrash: flag,
});

export const requestSimSchema = z.object({
  name: text(80, "Contact"),
  vpa,
  amount,
  message: optional(140),
});

export const mandateSchema = z
  .object({
    name: text(60, "Name"),
    payeeName: text(80, "Payee"),
    provider: z.enum(["gpay_sim", "phonepe_sim", "autopay_sim"]),
    amount,
    frequency: z.enum(FREQUENCIES).refine((f) => f !== "ONE_TIME", "Autopay must repeat"),
    startDate: date,
    endDate: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isISODate(v), "Enter a valid date"),
    categoryId: z.string().trim().min(1).max(60),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date can't be before the start date" });
  });

const decimal = (places: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => {
      const n = parseDecimal(v, places);
      return n !== null && n > 0;
    }, `${label} must be a positive number with at most ${places} decimals`);

export const tradeSimSchema = z
  .object({
    symbol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.&\-_]+$/, "Letters, digits and . & - _ only"),
    name: text(80, "Name"),
    segment: z.enum(["EQ", "ETF", "MF"]),
    side: z.enum(["BUY", "SELL"]),
    quantity: decimal(6, "Quantity"),
    price: decimal(4, "Price"),
    charges: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || "0")
      .refine((v) => parseRupees(v) !== null, "Charges must be an amount"),
    tradeDate: date,
    sipDate: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isISODate(v), "Enter a valid date"),
    failFirstAttempts: demoFail,
  })
  .superRefine((v, ctx) => {
    if (v.sipDate && (v.side !== "BUY" || v.segment !== "MF")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sipDate"], message: "SIP dates are only for mutual fund purchases" });
  });
