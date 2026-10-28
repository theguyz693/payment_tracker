import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAmfi } from "./prices";

describe("AMFI NAV parsing", () => {
  it("parses the current 8-column and older 6-column layouts", () => {
    const text = [
      "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
      "",
      "Axis Mutual Fund",
      "135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;28.9301;27-Oct-2026",
      "100027;INF209K01AJ8;-;Old Style Fund - Growth;12.345678;01-Sep-2025",
      "100028;-;-;Suspended Fund;N.A.;01-Sep-2025",
      "148304;-;-;Segregated Portfolio;Direct Plan;Growth;0;27-Oct-2026",
    ].join("\n");
    expect(parseAmfi(text)).toEqual([
      { code: "135762", name: "Axis Children's Fund · Direct Plan · Growth Option", price4: 289301, asOf: "2026-10-27" },
      { code: "100027", name: "Old Style Fund - Growth", price4: 123457, asOf: "2025-09-01" },
    ]);
  });

  // Set AMFI_SAMPLE to a downloaded NAVAll.txt to check the parser against real data.
  it("parses a real downloaded file when present", () => {
    const f = process.env.AMFI_SAMPLE;
    if (!f || !existsSync(f)) return;
    const rows = parseAmfi(readFileSync(f, "utf8"));
    expect(rows.length).toBeGreaterThan(5000);
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.asOf) && r.price4 > 0)).toBe(true);
  });
});
