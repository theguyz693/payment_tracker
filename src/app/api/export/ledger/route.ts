// CSV export of the user's history (same filters as /transactions/history).
// Authenticated like any page: the user comes from the session, never the request.

import { NextResponse, type NextRequest } from "next/server";
import { filterLedger, ledgerCsv, parseLedgerFilters } from "@/lib/ledger";
import { buildLedger, loadFinancialPicture } from "@/server/loaders";
import { getSessionUser, getToday } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const today = await getToday();
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const entries = filterLedger(buildLedger(await loadFinancialPicture(user.id, today)), { ...parseLedgerFilters(params), page: 1 });
  // BOM so Excel opens the ₹ sign and names correctly.
  return new NextResponse(`﻿${ledgerCsv(entries)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payment-tracker-history-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
