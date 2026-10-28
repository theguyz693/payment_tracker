// Data export for the signed-in user. The user always comes from the
// verified session; the URL only chooses which file to produce.

import { NextResponse, type NextRequest } from "next/server";
import { EXPORT_KINDS, exportAllJson, exportGoalsCsv, exportInvestmentsCsv, exportItemsCsv, exportLoansCsv, type ExportKind } from "@/server/export";
import { getSessionUser, getToday } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Unknown export" }, { status: 404 });

  const today = await getToday();
  try {
    const k = kind as ExportKind;
    const body =
      k === "items"
        ? await exportItemsCsv(user.id)
        : k === "goals"
          ? await exportGoalsCsv(user.id)
          : k === "loans"
            ? await exportLoansCsv(user.id)
            : k === "investments"
              ? await exportInvestmentsCsv(user.id)
              : await exportAllJson(user.id, { name: user.name, email: user.email });
    const json = k === "all";
    return new NextResponse(json ? body : `﻿${body}`, {
      headers: {
        "Content-Type": json ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payment-tracker-${k}-${today}.${json ? "json" : "csv"}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[export]", e);
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }
}
