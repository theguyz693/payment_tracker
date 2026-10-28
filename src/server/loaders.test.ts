import { describe, expect, it } from "vitest";
import { st } from "@/test/fixtures";
import { estimateCash, pickPrice } from "./loaders";
import type { Holding } from "./investments-repo";

const holding = (p: Partial<Holding>): Holding => ({
  id: "h",
  type: "MF",
  name: "Fund",
  symbol: null,
  provider: "AMFI",
  providerKey: "119551",
  sip: null,
  gold: null,
  manualPrice: null,
  notes: null,
  archived: false,
  ...p,
});

describe("pickPrice", () => {
  const quote = { key: "AMFI:119551", price4: 500_000, asOf: "2026-10-27", source: "AMFI daily NAV", fetchedAt: new Date() };
  const quotes = new Map([[quote.key, quote]]);
  it("uses the market price and flags stale data", () => {
    expect(pickPrice(holding({}), quotes, "2026-10-28")).toMatchObject({ price4: 500_000, manual: false, stale: false });
    expect(pickPrice(holding({}), quotes, "2026-11-20")?.stale).toBe(true);
  });
  it("prefers a newer manual price, and falls back to it", () => {
    const manual = { price4: 510_000, asOf: "2026-10-28" };
    expect(pickPrice(holding({ manualPrice: manual }), quotes, "2026-10-28")).toMatchObject({ price4: 510_000, manual: true });
    expect(pickPrice(holding({ manualPrice: { ...manual, asOf: "2026-10-01" } }), quotes, "2026-10-28")?.manual).toBe(false);
    expect(pickPrice(holding({ provider: null, providerKey: null, manualPrice: manual }), quotes, "2026-10-28")?.price4).toBe(510_000);
  });
  it("returns null rather than inventing a price", () => {
    expect(pickPrice(holding({ provider: null, providerKey: null }), quotes, "2026-10-28")).toBeNull();
    expect(pickPrice(holding({ providerKey: "999" }), quotes, "2026-10-28")).toBeNull();
  });
});

describe("estimateCash", () => {
  it("needs a starting balance", () => {
    expect(estimateCash({ cashBalancePaise: null, cashAsOf: null }, [], [], "2026-10-28")).toBeNull();
  });
  it("moves the balance by actuals after the balance date only", () => {
    const s = [
      st({ direction: "RECEIVE", settledOn: "2026-10-01", amountPaise: 999_00 }), // on the balance date: already included
      st({ direction: "RECEIVE", settledOn: "2026-10-05", amountPaise: 500_00 }),
      st({ settledOn: "2026-10-06", amountPaise: 200_00 }),
      st({ settledOn: "2026-11-06", amountPaise: 777_00 }), // future-dated: ignored
    ];
    const flows = [
      { date: "2026-10-07", kind: "INVEST" as const, amountPaise: 100_00 },
      { date: "2026-10-08", kind: "DIVEST" as const, amountPaise: 50_00 },
    ];
    expect(estimateCash({ cashBalancePaise: 1_000_00, cashAsOf: "2026-10-01" }, s, flows, "2026-10-28")).toEqual({ paise: 1_250_00, asOf: "2026-10-01" });
  });
});
