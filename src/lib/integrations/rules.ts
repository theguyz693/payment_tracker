// Pure rules for the reliability layer: state transitions, retry backoff and
// request fingerprints. No database access, so every rule is unit-tested.

import type { EventStatus } from "./types";

// ---- Request fingerprints (idempotency) ----

/** JSON with object keys sorted, so equal payloads always serialise the same way. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Client idempotency keys: 8–64 of [A-Za-z0-9_-] (a UUID fits). */
export function isIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && /^[\w-]{8,64}$/.test(v);
}

// ---- Event processing ----

export const MAX_EVENT_ATTEMPTS = 5;
/** How long a worker owns a claimed event before another may take it over. */
export const EVENT_LEASE_MS = 30_000;

/** Exponential backoff: 15s, 30s, 1m, 2m … capped at 15 minutes. */
export function retryDelayMs(attemptCount: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attemptCount - 1), 15 * 60_000);
}

/** Statuses a worker may claim. FAILED only for an explicit (user) retry. */
export function isClaimable(status: EventStatus, opts: { manual: boolean }): boolean {
  if (status === "RECEIVED" || status === "RETRY_PENDING") return true;
  return opts.manual && status === "FAILED";
}

export type FailureKind = "business" | "transient";

/** After a failed attempt: retry later, or stop. Business-rule failures never retry on their own. */
export function nextStatusAfterFailure(kind: FailureKind, attemptCount: number, maxAttempts = MAX_EVENT_ATTEMPTS): "RETRY_PENDING" | "FAILED" {
  return kind === "transient" && attemptCount < maxAttempts ? "RETRY_PENDING" : "FAILED";
}

// ---- Payment requests ----

export type RequestDecision = "ACCEPT" | "REJECT";

/** Only a pending request can be decided, and only once. */
export function canDecide(status: "PENDING" | "ACCEPTED" | "REJECTED"): boolean {
  return status === "PENDING";
}

// ---- Autopay attempts ----

export const MAX_MANDATE_ATTEMPTS = 3;

export interface AttemptLike {
  attemptNo: number;
  status: "PENDING" | "SUCCESS" | "FAILED";
}

export type NextAttempt = { ok: true; attemptNo: number } | { ok: false; reason: "already_paid" | "pending" | "exhausted" };

/**
 * The next debit attempt allowed for one mandate occurrence: none after a
 * success, none while one is pending, and at most MAX_MANDATE_ATTEMPTS.
 */
export function nextAttempt(attempts: AttemptLike[]): NextAttempt {
  if (attempts.some((a) => a.status === "SUCCESS")) return { ok: false, reason: "already_paid" };
  if (attempts.some((a) => a.status === "PENDING")) return { ok: false, reason: "pending" };
  if (attempts.length >= MAX_MANDATE_ATTEMPTS) return { ok: false, reason: "exhausted" };
  return { ok: true, attemptNo: attempts.reduce((m, a) => Math.max(m, a.attemptNo), 0) + 1 };
}

/** A PENDING attempt may resolve to SUCCESS or FAILED, exactly once. */
export function canResolveAttempt(status: "PENDING" | "SUCCESS" | "FAILED"): boolean {
  return status === "PENDING";
}
