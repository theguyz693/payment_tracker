// The export endpoints must refuse anonymous callers and only ever export the session user's data.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string; name: string; email: string } | null = null;
vi.mock("./session", () => ({
  getSessionUser: vi.fn(async () => user),
  getToday: vi.fn(async () => "2026-10-28"),
}));
const exportedFor: string[] = [];
vi.mock("./export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./export")>();
  const fake = (label: string) => vi.fn(async (userId: string) => (exportedFor.push(userId), `${label}\r\n`));
  return {
    ...actual,
    exportItemsCsv: fake("items"),
    exportGoalsCsv: fake("goals"),
    exportLoansCsv: fake("loans"),
    exportInvestmentsCsv: fake("investments"),
    exportAllJson: vi.fn(async (userId: string) => (exportedFor.push(userId), "{}")),
  };
});

const { GET } = await import("@/app/api/export/[kind]/route");
const call = (kind: string, query = "") => GET(new NextRequest(`http://localhost/api/export/${kind}${query}`), { params: Promise.resolve({ kind }) });

beforeEach(() => {
  user = null;
  exportedFor.length = 0;
});

describe("data export", () => {
  it("rejects anonymous requests", async () => {
    const res = await call("all");
    expect(res.status).toBe(401);
    expect(exportedFor).toEqual([]);
  });
  it("rejects unknown kinds", async () => {
    user = { id: "user-A", name: "A", email: "a@x.test" };
    expect((await call("../../etc/passwd")).status).toBe(404);
    expect((await call("__proto__")).status).toBe(404);
  });
  it("exports only the session user's data, whatever the URL says", async () => {
    user = { id: "user-A", name: "A", email: "a@x.test" };
    for (const kind of ["items", "goals", "loans", "investments", "all"]) {
      const res = await call(kind, "?userId=user-B");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    }
    expect(exportedFor).toEqual(["user-A", "user-A", "user-A", "user-A", "user-A"]);
  });
});
