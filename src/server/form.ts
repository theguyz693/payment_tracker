// Helpers shared by server actions (plain module: "use server" files may only export actions).

import "server-only";
import type { ZodError } from "zod";
import type { FieldErrors } from "@/lib/validation";

export interface FormState {
  ok?: boolean;
  errors?: FieldErrors;
  message?: string;
  redirectTo?: string;
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export function formGetter(formData: FormData) {
  return (k: string): string | undefined => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
}

export function toFieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Client-generated idempotency key (see RequestIdField). Missing/invalid -> a fresh one (no dedupe). */
export function requestIdFrom(formData: FormData): string {
  const v = formData.get("requestId");
  return typeof v === "string" && /^[\w-]{8,64}$/.test(v) ? v : crypto.randomUUID();
}

/** Only same-site relative paths (blocks "//evil.com" open redirects). */
export function safeReturnPath(value: FormDataEntryValue | null | undefined, fallback: string): string {
  return typeof value === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(value) ? value : fallback;
}
