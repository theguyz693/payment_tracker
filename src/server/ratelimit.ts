// GateKeeper rate limiting, stored in MongoDB so it holds across Vercel's
// serverless instances (an in-memory counter would reset per instance).
//
// Fixed windows: one counter document per (bucket, subject, window), bumped
// with an atomic upsert and removed by a TTL index. Rejections are recorded
// for the monitoring page.
//
// Failure mode if the database can't be reached:
//   closed (default) -> the request is refused. Used for every write that
//                       moves money or creates records.
//   open             -> the request goes ahead, with a warning logged. Used
//                       only for read-only reporting.

import "server-only";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { RateLimitError, UserError } from "./errors";
import { log } from "./log";
import { isDuplicateKey, rateLimitsCollection, rejectionsCollection } from "./models";

export interface Limit {
  limit: number;
  windowSec: number;
  failMode: "open" | "closed";
}

export const LIMITS = {
  /** Create / edit / settle / archive transactions. */
  "tx.write": { limit: 60, windowSec: 60, failMode: "closed" },
  /** Goals, loans, investments and settings writes. */
  "finance.write": { limit: 60, windowSec: 60, failMode: "closed" },
  /** Simulated provider events from the hub. */
  "integration.simulate": { limit: 30, windowSec: 60, failMode: "closed" },
  /** Accept / reject payment requests. */
  "request.decide": { limit: 30, windowSec: 60, failMode: "closed" },
  /** Create / pause / resume mandates. */
  "mandate.config": { limit: 20, windowSec: 60, failMode: "closed" },
  /** Retry / resend / recover events from the console. */
  "event.retry": { limit: 20, windowSec: 60, failMode: "closed" },
  /** Webhook deliveries, per client IP. */
  "webhook.ip": { limit: 120, windowSec: 60, failMode: "closed" },
  /** Data exports. */
  export: { limit: 10, windowSec: 60, failMode: "open" },
  /** Fund search (calls AMFI through our cache). */
  search: { limit: 30, windowSec: 60, failMode: "open" },
} as const satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/** Hash an IP so raw addresses aren't stored. */
export function ipSubject(ip: string | null): string {
  return `ip:${createHash("sha256").update(`rl:${ip ?? "unknown"}`).digest("hex").slice(0, 16)}`;
}

/** Count one request against `bucket` for `subject` (a user id or ipSubject()). */
export async function consume(bucket: Bucket, subject: string, now = Date.now()): Promise<RateDecision> {
  const { limit, windowSec } = LIMITS[bucket];
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const _id = `${bucket}:${subject}:${windowStart}`;
  const update = {
    $inc: { count: 1 },
    $setOnInsert: { bucket, windowStart: new Date(windowStart), expiresAt: new Date(windowStart + windowMs + 60_000) },
  };
  let doc;
  try {
    doc = await rateLimitsCollection().findOneAndUpdate({ _id }, update, { upsert: true, returnDocument: "after" });
  } catch (e) {
    // Two first requests in a window can race on the upsert; the loser retries as an update.
    if (!isDuplicateKey(e)) throw e;
    doc = await rateLimitsCollection().findOneAndUpdate({ _id }, update, { upsert: true, returnDocument: "after" });
  }
  const count = doc?.count ?? 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSec: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

/**
 * Enforce a limit. Throws RateLimitError when over the limit; applies the
 * bucket's fail mode if the database is unavailable.
 */
export async function enforce(bucket: Bucket, subject: string, ctx: { userId: string | null; route: string; requestId?: string; provider?: string | null }): Promise<void> {
  let decision: RateDecision;
  try {
    decision = await consume(bucket, subject);
  } catch (e) {
    if (LIMITS[bucket].failMode === "open") {
      log("warn", "ratelimit.unavailable", { bucket, route: ctx.route, requestId: ctx.requestId, failMode: "open" });
      return;
    }
    log("error", "ratelimit.unavailable", { bucket, route: ctx.route, requestId: ctx.requestId, failMode: "closed", errorName: e instanceof Error ? e.name : "unknown" });
    throw new UserError("This action is temporarily unavailable. Please try again shortly.");
  }
  if (decision.allowed) return;
  await recordRejection({ userId: ctx.userId, reason: "RATE_LIMITED", route: ctx.route, provider: ctx.provider ?? null });
  log("warn", "ratelimit.rejected", { bucket, route: ctx.route, requestId: ctx.requestId, userId: ctx.userId, retryAfterSec: decision.retryAfterSec });
  throw new RateLimitError(`Too many requests. Try again in ${decision.retryAfterSec}s.`, decision.retryAfterSec);
}

export type RejectionReason = "RATE_LIMITED" | "INVALID_SIGNATURE" | "STALE_TIMESTAMP" | "INVALID_PAYLOAD" | "UNKNOWN_PROVIDER" | "UNKNOWN_ACCOUNT" | "FORBIDDEN" | "PAYLOAD_CONFLICT" | "TOO_LARGE";

/** Remember a rejected request (30 days) for the monitoring page. Never throws. */
export async function recordRejection(r: { userId: string | null; reason: RejectionReason; route: string; provider: string | null }): Promise<void> {
  const at = new Date();
  await rejectionsCollection()
    .insertOne({ _id: new ObjectId(), ...r, at, expiresAt: new Date(at.getTime() + 30 * 24 * 60 * 60 * 1000) })
    .catch(() => log("warn", "rejection.record_failed", { reason: r.reason }));
}
