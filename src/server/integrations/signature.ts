// Delivery authentication for (simulated) provider webhooks.
//
// Each delivery carries `x-sim-timestamp` (unix seconds) and
// `x-sim-signature` = hex HMAC-SHA256(secret, `${timestamp}.${body}`).
// A delivery is accepted only if the signature matches and the timestamp is
// within five minutes, which blocks tampering and limits replays; replays
// inside the window are caught by the per-event unique index.

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-sim-signature";
export const TIMESTAMP_HEADER = "x-sim-timestamp";
export const MAX_SKEW_SEC = 300;

/** INTEGRATIONS_WEBHOOK_SECRET, else derived from BETTER_AUTH_SECRET (never sent to the browser). */
function secret(): string {
  const explicit = process.env.INTEGRATIONS_WEBHOOK_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const base = process.env.BETTER_AUTH_SECRET;
  if (base) return createHash("sha256").update(`integrations-webhook:${base}`).digest("hex");
  if (process.env.NODE_ENV === "production") throw new Error("INTEGRATIONS_WEBHOOK_SECRET or BETTER_AUTH_SECRET must be set.");
  return "dev-only-integrations-secret";
}

export function signDelivery(body: string, timestamp: number): string {
  return createHmac("sha256", secret()).update(`${timestamp}.${body}`).digest("hex");
}

export type SignatureCheck = "ok" | "invalid_signature" | "stale_timestamp";

export function verifyDelivery(body: string, timestamp: string | null, signature: string | null, nowSec = Math.floor(Date.now() / 1000)): SignatureCheck {
  if (!timestamp || !/^\d{9,11}$/.test(timestamp) || !signature || !/^[a-f\d]{64}$/i.test(signature)) return "invalid_signature";
  const expected = Buffer.from(signDelivery(body, Number(timestamp)), "hex");
  const given = Buffer.from(signature, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid_signature";
  if (Math.abs(nowSec - Number(timestamp)) > MAX_SKEW_SEC) return "stale_timestamp";
  return "ok";
}
