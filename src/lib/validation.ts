// Validation for the add/edit form. Shared by the server action (source of truth).

import { z } from "zod";
import { isISODate } from "./dates";
import { parseRupees } from "./money";
import { DIRECTIONS, FREQUENCIES } from "./types";

const date = z.string().trim().refine(isISODate, "Enter a valid date");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const transactionInputSchema = z
  .object({
    direction: z.enum(DIRECTIONS, { message: "Choose pay or receive" }),
    title: z.string().trim().min(1, "Give it a name").max(100),
    amount: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const paise = parseRupees(v);
        if (paise === null || paise <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter an amount greater than 0" });
          return z.NEVER;
        }
        return paise;
      }),
    categoryId: z.string().min(1, "Choose a category"),
    frequency: z.enum(FREQUENCIES),
    dueDate: date,
    startDate: date,
    endDate: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isISODate(v), "Enter a valid date"),
    counterparty: optionalText(100),
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.startDate > v.dueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: "Start date can't be after the due date" });
    }
    if (v.endDate && v.endDate < v.dueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date can't be before the due date" });
    }
  });

export type TransactionInput = z.output<typeof transactionInputSchema>;
export type FieldErrors = Partial<Record<string, string>>;
