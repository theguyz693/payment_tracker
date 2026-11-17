// Scheduled worker (Vercel Cron, see vercel.json): recovers events left in
// PROCESSING by a crashed or timed-out invocation, then processes retries
// whose backoff has elapsed. Requires `Authorization: Bearer $CRON_SECRET`
// (Vercel sends it automatically when CRON_SECRET is set). Without the
// secret configured the endpoint refuses to run (fail closed).
// Concurrency is safe: every event is claimed with an atomic lease.

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { today } from "@/lib/dates";
import { processDueRetries, recoverStuckEvents } from "@/server/integrations/pipeline";
import { log, logError } from "@/server/log";
import { ensureIndexes } from "@/server/models";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureIndexes();
  try {
    const day = today(process.env.DEFAULT_TIMEZONE || "Asia/Kolkata");
    const recovered = await recoverStuckEvents(null, 200);
    const processed = await processDueRetries(null, () => day, 100);
    log("info", "integration.cron", { recovered, processed });
    return NextResponse.json({ recovered, processed });
  } catch (e) {
    logError("integration.cron", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
