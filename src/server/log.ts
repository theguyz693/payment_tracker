// Structured logging: one JSON line per event, so Vercel's log search can
// filter by operation, request id, outcome or error category.
//
// Never log passwords, tokens, cookies, secrets or full financial payloads.
// User ids are hashed; keys that look sensitive are dropped.

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { errorCategory } from "./errors";

type Level = "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  eventId?: string;
  userId?: string | null;
  durationMs?: number;
  outcome?: string;
  status?: string;
  errorCategory?: string;
  [key: string]: unknown;
}

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|signature|session|apikey|api_key|body|payload/i;

export function newRequestId(): string {
  return randomUUID();
}

/** Stable, non-reversible reference to a user for logs. */
export function userRef(userId: string): string {
  return createHash("sha256").update(`log:${userId}`).digest("hex").slice(0, 12);
}

function clean(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || SENSITIVE.test(k)) continue;
    if (k === "userId") {
      if (typeof v === "string") out.user = userRef(v);
      continue;
    }
    out[k] = typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  return out;
}

export function log(level: Level, op: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, op, ...clean(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/** Log an operation's failure with its category; the message only for user-safe errors. */
export function logError(op: string, e: unknown, fields: LogFields = {}): void {
  const category = errorCategory(e);
  const safe = category !== "internal" && e instanceof Error ? e.message : undefined;
  log(category === "internal" ? "error" : "warn", op, {
    ...fields,
    outcome: "error",
    errorCategory: category,
    message: safe,
    errorName: e instanceof Error ? e.name : typeof e,
  });
  // Full stack only for unexpected errors (server logs only, never sent to the client).
  if (category === "internal") console.error(e);
}

/** Time `fn`, logging one line with its outcome and duration. */
export async function timed<T>(op: string, fields: LogFields, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const out = await fn();
    log("info", op, { ...fields, outcome: "ok", durationMs: Math.round(performance.now() - started) });
    return out;
  } catch (e) {
    logError(op, e, { ...fields, durationMs: Math.round(performance.now() - started) });
    throw e;
  }
}
