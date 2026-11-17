import "server-only";

/** An error whose message is safe to show to the user. */
export class UserError extends Error {}

/** Same idempotency key reused with a different request. */
export class IdempotencyConflictError extends UserError {
  readonly category = "idempotency_conflict";
}

/** The same request is still being processed by another call. */
export class InProgressError extends UserError {
  readonly category = "in_progress";
}

/** The record changed since the client read it (optimistic concurrency). */
export class StaleWriteError extends UserError {
  readonly category = "stale_write";
}

/** Too many requests in the current window. */
export class RateLimitError extends UserError {
  readonly category = "rate_limited";
  constructor(
    message: string,
    readonly retryAfterSec: number,
  ) {
    super(message);
  }
}

/** A transient failure worth retrying (network blip, write conflict, simulated fault). */
export class TransientError extends Error {
  readonly category = "transient";
}

/** Short machine-readable category for logs and metrics. */
export function errorCategory(e: unknown): string {
  if (e && typeof e === "object" && "category" in e && typeof (e as { category: unknown }).category === "string") return (e as { category: string }).category;
  if (e instanceof UserError) return "user_error";
  if (isTransientMongoError(e)) return "transient";
  if (e && typeof e === "object" && (e as { code?: number }).code === 11000) return "duplicate_key";
  return "internal";
}

/** Network errors, timeouts and transient transaction errors from the driver. */
export function isTransientMongoError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; hasErrorLabel?: (l: string) => boolean };
  if (typeof err.hasErrorLabel === "function" && (err.hasErrorLabel("TransientTransactionError") || err.hasErrorLabel("RetryableWriteError"))) return true;
  return err.name === "MongoNetworkError" || err.name === "MongoNetworkTimeoutError" || err.name === "MongoServerSelectionError";
}
