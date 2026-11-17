// Public webhook endpoint for (simulated) provider deliveries.
//
// No session: the caller authenticates with an HMAC signature over the body
// (see src/server/integrations/signature.ts), and the payload's demo account
// reference decides which user the event belongs to. Rate-limited per IP,
// body size capped, and processed by the same pipeline as the in-app
// simulators. Responses never include other users' data or internal errors.

import { NextResponse, type NextRequest } from "next/server";
import { today } from "@/lib/dates";
import { RateLimitError } from "@/server/errors";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/server/integrations/signature";
import { MAX_BODY_BYTES, receiveDelivery } from "@/server/integrations/pipeline";
import { log, logError, newRequestId } from "@/server/log";
import { ensureIndexes } from "@/server/models";
import { enforce, ipSubject } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

function clientIp(request: NextRequest): string | null {
  // Vercel overwrites x-forwarded-for with the real client address.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const requestId = newRequestId();
  const { provider } = await params;
  await ensureIndexes();
  try {
    await enforce("webhook.ip", ipSubject(clientIp(request)), { userId: null, route: "integrations.webhook", requestId, provider });
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: "rate_limited", message: e.message }, { status: 429, headers: { "Retry-After": String(e.retryAfterSec) } });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const body = await request.text();

  try {
    const r = await receiveDelivery({
      provider,
      body,
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
      source: "WEBHOOK",
      today: today(process.env.DEFAULT_TIMEZONE || "Asia/Kolkata"),
      requestId,
    });
    if (r.kind === "rejected") {
      return NextResponse.json({ error: r.reason.toLowerCase(), message: r.message, issues: r.issues }, { status: r.httpStatus, headers: { "x-request-id": requestId } });
    }
    log("info", "integration.webhook", { requestId, eventId: r.event._id.toHexString(), status: r.event.status, duplicate: r.duplicate });
    return NextResponse.json(
      {
        eventId: r.event.externalEventId,
        status: r.event.status,
        duplicate: r.duplicate,
        outcome: r.event.outcome,
        nextRetryAt: r.event.nextRetryAt,
      },
      { status: r.httpStatus, headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    logError("integration.webhook", e, { requestId, provider });
    return NextResponse.json({ error: "internal_error", requestId }, { status: 500 });
  }
}
