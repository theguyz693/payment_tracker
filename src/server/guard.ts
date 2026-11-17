// GateKeeper for server actions: one call that authenticates (Better Auth
// session via requireUser — the user id never comes from the client),
// applies the operation's rate limit and starts a structured log context.

import "server-only";
import { RateLimitError } from "./errors";
import { log, newRequestId } from "./log";
import { enforce, type Bucket } from "./ratelimit";
import { requireUser, type SessionUser } from "./session";

export interface Gate {
  user: SessionUser;
  requestId: string;
  op: string;
  started: number;
  /** User-facing message when the request was refused by the rate limiter; null when allowed. */
  blocked: string | null;
}

export async function gate(op: string, bucket: Bucket): Promise<Gate> {
  const user = await requireUser();
  const requestId = newRequestId();
  const g: Gate = { user, requestId, op, started: performance.now(), blocked: null };
  try {
    await enforce(bucket, user.id, { userId: user.id, route: op, requestId });
  } catch (e) {
    g.blocked = e instanceof RateLimitError ? e.message : e instanceof Error ? e.message : "Please try again shortly.";
  }
  return g;
}

/** Log the end of a gated operation. */
export function finish(g: Gate, outcome: string, fields: Record<string, unknown> = {}): void {
  log("info", g.op, { requestId: g.requestId, userId: g.user.id, outcome, durationMs: Math.round(performance.now() - g.started), ...fields });
}
