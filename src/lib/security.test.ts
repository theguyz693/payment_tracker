import { describe, expect, it } from "vitest";
import { seedAllowed } from "../../db/seed-guard";
import { contentSecurityPolicy } from "./csp";
import { isISODate } from "./dates";
import { parseDecimal } from "./decimal";
import { parseLedgerFilters } from "./ledger";
import { MAX_AMOUNT_PAISE, parseRupees } from "./money";
import { safeNextPath } from "./redirects";
import { parseFilters } from "./filters";

describe("redirects after login stay on this site", () => {
  it("allows normal app paths", () => {
    expect(safeNextPath("/transactions?status=OVERDUE")).toBe("/transactions?status=OVERDUE");
    expect(safeNextPath("/goals/abc")).toBe("/goals/abc");
  });
  it("blocks external and tricky targets", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\\/evil.com", "javascript:alert(1)", "evil.com", "/ok\nSet-Cookie:x", "/a b", "", null, undefined, "/login", "/signup?next=/x", "/" + "a".repeat(600)]) {
      expect(safeNextPath(bad as string)).toBe("/dashboard");
    }
  });
});

describe("amount, date and text bounds", () => {
  it("parses rupees exactly and rejects junk or oversized values", () => {
    expect(parseRupees("25,000.50")).toBe(25_000_50);
    expect(parseRupees("0.1")).toBe(10);
    expect(parseRupees("1.005")).toBeNull();
    expect(parseRupees("1e5")).toBeNull();
    expect(parseRupees("-1")).toBeNull();
    expect(parseRupees("NaN")).toBeNull();
    expect(parseRupees("100000000000")).toBe(MAX_AMOUNT_PAISE);
    expect(parseRupees("100000000000.01")).toBeNull();
    expect(parseRupees("9".repeat(20))).toBeNull();
    expect(parseRupees("1".repeat(40))).toBeNull();
  });
  it("only accepts real dates in a sane range", () => {
    expect(isISODate("2026-10-28")).toBe(true);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("1899-12-31")).toBe(false);
    expect(isISODate("2200-01-01")).toBe(false);
    expect(isISODate("2026-10-28T00:00")).toBe(false);
    expect(isISODate(undefined as unknown as string)).toBe(false);
  });
  it("bounds decimals and query strings", () => {
    expect(parseDecimal("1".repeat(50), 4)).toBeNull();
    expect(parseFilters({ q: "x".repeat(5000) }).q).toHaveLength(100);
    expect(parseLedgerFilters({ q: "y".repeat(5000) }).q).toHaveLength(100);
    expect(parseFilters({ status: "$where", sort: "__proto__", direction: "X" })).toMatchObject({ status: undefined, sort: "due_asc", direction: undefined });
  });
});

describe("content security policy", () => {
  const prod = contentSecurityPolicy("abc123", false);
  it("allows scripts only by nonce in production", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });
  it("adds eval only in development", () => {
    expect(contentSecurityPolicy("n", true)).toContain("'unsafe-eval'");
  });
});

describe("seed safety", () => {
  it("only writes to dev/test databases unless one is named explicitly", () => {
    expect(seedAllowed("payment_tracker_dev", [])).toBe(true);
    expect(seedAllowed("payment_tracker_test", [])).toBe(true);
    expect(seedAllowed("payment_tracker", [])).toBe(false);
    expect(seedAllowed("payment_tracker", ["--replace"])).toBe(false);
    expect(seedAllowed("payment_tracker", ["--allow-db=other"])).toBe(false);
    expect(seedAllowed("staging", ["--allow-db=staging"])).toBe(true);
  });
});

describe("URL parameters can't reach object prototypes", () => {
  it("treats built-in property names as unknown values", async () => {
    const { resolvePeriod } = await import("./period");
    for (const evil of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(parseFilters({ sort: evil, status: evil }).sort).toBe("due_asc");
      expect(parseFilters({ status: evil }).status).toBeUndefined();
      expect(parseLedgerFilters({ type: evil }).type).toBeUndefined();
      expect(resolvePeriod({ period: evil }, "2026-10-28").key).toBe("this_month");
    }
  });
});

describe("session tokens never reach page JavaScript", () => {
  it("strips tokens from auth responses", async () => {
    const { stripTokens } = await import("@/server/auth");
    const signIn = { token: "secret", redirect: false, user: { id: "u", email: "a@x.test" } };
    expect(stripTokens(signIn)).toEqual({ redirect: false, user: { id: "u", email: "a@x.test" } });
    const session = { session: { id: "s", token: "secret", userId: "u" }, user: { id: "u" } };
    expect(JSON.stringify(stripTokens(session))).not.toContain("secret");
    expect(JSON.stringify(stripTokens([{ id: "s1", token: "a" }, { id: "s2", token: "b" }]))).toBe('[{"id":"s1"},{"id":"s2"}]');
    expect(stripTokens(null)).toBeNull();
  });
});
