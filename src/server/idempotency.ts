// Persistent idempotency for operations with side effects that must not repeat.
//
// Each logical request carries a client key. The first call claims
// (userId, scope, key) with a unique index and runs the operation; the
// operation's writes and the COMPLETED marker commit in ONE MongoDB
// transaction, so a crash can never leave "done but not recorded" (or the
// reverse). Later calls with the same key get the stored result back.
//
//   new key                       -> run, store result
//   same key, same payload, done  -> stored result (replayed: true)
//   same key, different payload   -> IdempotencyConflictError
//   same key, still running       -> wait briefly, then InProgressError
//   same key, previous run failed -> run again (failed runs committed nothing)
//   claim older than its lease    -> taken over (the previous worker died)
// Records expire via a TTL index (24h after completion).

import "server-only";
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession } from "mongodb";
import { stableStringify } from "@/lib/integrations/rules";
import { IdempotencyConflictError, InProgressError, UserError } from "./errors";
import { idempotencyCollection, isDuplicateKey, runInTransaction, type IdempotencyKeyDoc } from "./models";

const LEASE_MS = 30_000;
const TTL_MS = 24 * 60 * 60 * 1000;
const WAIT_STEPS = 6;
const WAIT_MS = 400;

export function requestHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export interface IdempotentResult<T> {
  result: T;
  replayed: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `operation` at most once per (userId, scope, key). `operation` must do
 * all its writes with the session it's given. The result must be small,
 * plain JSON (ids, codes, messages).
 */
export async function withIdempotency<T extends Record<string, unknown>>(
  opts: { userId: string; scope: string; key: string; payload: unknown },
  operation: (session: ClientSession | undefined) => Promise<T>,
): Promise<IdempotentResult<T>> {
  const col = idempotencyCollection();
  const hash = requestHash(opts.payload);
  const filter = { userId: opts.userId, scope: opts.scope, key: opts.key };

  let claim: IdempotencyKeyDoc | null = null;
  for (let round = 0; round < WAIT_STEPS + 2 && !claim; round++) {
    const now = new Date();
    const fresh: IdempotencyKeyDoc = {
      _id: new ObjectId(),
      ...filter,
      requestHash: hash,
      status: "IN_PROGRESS",
      result: null,
      error: null,
      attempts: 1,
      lockedUntil: new Date(now.getTime() + LEASE_MS),
      createdAt: now,
      completedAt: null,
      expiresAt: new Date(now.getTime() + TTL_MS),
    };
    try {
      await col.insertOne(fresh);
      claim = fresh;
      break;
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }

    const existing = await col.findOne(filter);
    if (!existing) continue; // expired between insert and read: try again
    if (existing.status === "COMPLETED") {
      if (existing.requestHash !== hash) throw conflict();
      return { result: existing.result as T, replayed: true };
    }
    const takeover = existing.status === "FAILED" || existing.lockedUntil <= now;
    if (!takeover) {
      if (existing.requestHash !== hash) throw conflict();
      await sleep(WAIT_MS); // another call is running this request: wait for it
      continue;
    }
    // A failed run committed nothing, so it may be retried (even with corrected input).
    // An expired lease means the previous worker died mid-way; its transaction rolled back.
    if (existing.status === "IN_PROGRESS" && existing.requestHash !== hash) throw conflict();
    const taken = await col.findOneAndUpdate(
      { _id: existing._id, status: existing.status, lockedUntil: existing.lockedUntil },
      {
        $set: { status: "IN_PROGRESS", requestHash: hash, error: null, lockedUntil: new Date(now.getTime() + LEASE_MS), expiresAt: new Date(now.getTime() + TTL_MS) },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (taken) claim = taken;
  }
  if (!claim) throw new InProgressError("This request is still being processed. Please wait a moment.");

  const claimed = claim;
  try {
    const result = await runInTransaction(async (session) => {
      const out = await operation(session);
      const done = await col.updateOne(
        { _id: claimed._id, status: "IN_PROGRESS", lockedUntil: claimed.lockedUntil },
        { $set: { status: "COMPLETED", result: out, completedAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) } },
        { session },
      );
      // Lost the lease to another worker: abort so the operation's writes roll back.
      if (done.matchedCount !== 1) throw new InProgressError("This request is being processed elsewhere. Please wait a moment.");
      return out;
    });
    return { result, replayed: false };
  } catch (e) {
    await col
      .updateOne(
        { _id: claimed._id, status: "IN_PROGRESS", lockedUntil: claimed.lockedUntil },
        { $set: { status: "FAILED", error: e instanceof UserError ? e.message : "internal error" } },
      )
      .catch(() => {});
    throw e;
  }
}

function conflict() {
  return new IdempotencyConflictError("This request key was already used for a different request. Reload the form and try again.");
}
