// Market prices: fetched server-side, cached in MongoDB, never invented.
//
// Providers (see README "Market data"):
// - AMFI (Indian mutual fund NAVs): official daily NAV file, free, no key.
//   NAVs are published once per business day, so they're never "real-time".
// - Alpha Vantage (stocks/ETFs incl. ".BSE" symbols): optional, needs
//   ALPHA_VANTAGE_API_KEY. The free tier is heavily rate-limited and delayed,
//   so quotes are cached for hours.
// - Gold: no free official INR feed; prices are entered manually.
//
// Anything that fails just leaves the last cached price (with its timestamp)
// or no price at all — the UI then asks for a manual price.

import "server-only";
import { parseDecimal } from "@/lib/decimal";
import type { ISODate } from "@/lib/types";
import { priceHistoryCollection, pricesCollection, type PriceProvider } from "./models";

const AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const AMFI_TTL_MS = 6 * 60 * 60 * 1000;
const AV_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export interface Quote {
  key: string; // `${provider}:${code}`
  price4: number;
  asOf: ISODate;
  source: string;
  fetchedAt: Date;
}

export function priceKey(provider: PriceProvider, code: string): string {
  return `${provider}:${code}`;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "27-Oct-2026" -> "2026-10-27" */
function parseAmfiDate(s: string): ISODate | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

/** NAV text -> price4, rounding extra decimals half-up. */
function navToPrice4(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  if (f.length <= 4) return parseDecimal(t, 4);
  const base = parseDecimal(`${w}.${f.slice(0, 4)}`, 4);
  return base === null ? null : base + (Number(f[4]) >= 5 ? 1 : 0);
}

export interface AmfiScheme {
  code: string;
  name: string;
  price4: number;
  asOf: ISODate;
}

/**
 * Parse AMFI's NAVAll.txt. Handles the current 8-column layout
 * (code;isin;isin;name;plan;option;nav;date) and the older 6-column one
 * (code;isin;isin;name;nav;date).
 */
export function parseAmfi(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(";");
    if (parts.length < 6 || !/^\d+$/.test(parts[0].trim())) continue;
    const price4 = navToPrice4(parts[parts.length - 2]);
    const asOf = parseAmfiDate(parts[parts.length - 1]);
    // Zero NAVs appear for wound-down segregated portfolios; they're not usable prices.
    if (price4 === null || price4 <= 0 || !asOf) continue;
    const name = parts
      .slice(3, parts.length - 2)
      .map((p) => p.trim())
      .filter((p) => p && p !== "-")
      .join(" · ");
    out.push({ code: parts[0].trim(), name, price4, asOf });
  }
  return out;
}

// One parsed copy per server process, refreshed every few hours.
const globalForAmfi = globalThis as unknown as { _amfi?: { at: number; schemes: Map<string, AmfiScheme> } };

async function timedFetch(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store", headers: { "User-Agent": "payment-tracker" } });
}

async function amfiSchemes(): Promise<Map<string, AmfiScheme> | null> {
  const cached = globalForAmfi._amfi;
  if (cached && Date.now() - cached.at < AMFI_TTL_MS) return cached.schemes;
  try {
    const res = await timedFetch(AMFI_URL);
    if (!res.ok) throw new Error(`AMFI HTTP ${res.status}`);
    const schemes = new Map(parseAmfi(await res.text()).map((s) => [s.code, s]));
    if (schemes.size === 0) throw new Error("AMFI file had no schemes");
    globalForAmfi._amfi = { at: Date.now(), schemes };
    return schemes;
  } catch (e) {
    console.warn("[prices] AMFI fetch failed:", e);
    return cached?.schemes ?? null;
  }
}

/** Search AMFI schemes by name or code (for the "add mutual fund" form). */
export async function searchAmfi(query: string, limit = 20): Promise<AmfiScheme[] | null> {
  const schemes = await amfiSchemes();
  if (!schemes) return null;
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  if (/^\d+$/.test(q)) return schemes.has(q) ? [schemes.get(q)!] : [];
  const words = q.split(/\s+/).filter(Boolean);
  const out: AmfiScheme[] = [];
  for (const s of schemes.values()) {
    const name = s.name.toLowerCase();
    if (words.every((w) => name.includes(w))) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function alphaVantageEnabled(): boolean {
  return !!process.env.ALPHA_VANTAGE_API_KEY;
}

async function alphaVantageQuote(symbol: string): Promise<{ price4: number; asOf: ISODate } | null> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
    const res = await timedFetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { "Global Quote"?: Record<string, string> };
    const q = json["Global Quote"];
    const price4 = q ? navToPrice4(q["05. price"] ?? "") : null;
    const asOf = q?.["07. latest trading day"];
    // Rate-limit and error responses come back as 200 with a "Note"/"Information" body.
    if (!price4 || !asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
    return { price4, asOf };
  } catch (e) {
    console.warn("[prices] Alpha Vantage fetch failed:", e);
    return null;
  }
}

async function store(q: Quote): Promise<void> {
  await pricesCollection().updateOne(
    { _id: q.key },
    { $set: { price4: q.price4, asOf: q.asOf, source: q.source, fetchedAt: q.fetchedAt } },
    { upsert: true },
  );
  await priceHistoryCollection()
    .updateOne({ key: q.key, date: q.asOf }, { $set: { price4: q.price4 } }, { upsert: true })
    .catch(() => {}); // unique-index race with a concurrent refresh: harmless
}

/**
 * Cached quotes for `keys`, refreshing any older than their provider's TTL.
 * Never throws; missing keys simply have no quote.
 */
export async function getQuotes(keys: string[]): Promise<Map<string, Quote>> {
  const unique = [...new Set(keys)];
  const out = new Map<string, Quote>();
  if (unique.length === 0) return out;
  const cached = await pricesCollection().find({ _id: { $in: unique } }).toArray();
  for (const c of cached) out.set(c._id, { key: c._id, price4: c.price4, asOf: c.asOf, source: c.source, fetchedAt: c.fetchedAt });

  const stale = unique.filter((k) => {
    const c = out.get(k);
    const ttl = k.startsWith("AMFI:") ? AMFI_TTL_MS : AV_TTL_MS;
    return !c || Date.now() - c.fetchedAt.getTime() > ttl;
  });

  const amfiKeys = stale.filter((k) => k.startsWith("AMFI:"));
  if (amfiKeys.length) {
    const schemes = await amfiSchemes();
    for (const k of amfiKeys) {
      const s = schemes?.get(k.slice(5));
      if (!s) continue;
      const q: Quote = { key: k, price4: s.price4, asOf: s.asOf, source: "AMFI daily NAV", fetchedAt: new Date() };
      out.set(k, q);
      await store(q).catch((e) => console.warn("[prices] store failed", e));
    }
  }

  // Alpha Vantage: a handful per request at most, to respect the free tier.
  const avKeys = stale.filter((k) => k.startsWith("ALPHAVANTAGE:")).slice(0, 3);
  await Promise.all(
    avKeys.map(async (k) => {
      const r = await alphaVantageQuote(k.slice("ALPHAVANTAGE:".length));
      if (!r) return;
      const q: Quote = { key: k, ...r, source: "Alpha Vantage (delayed)", fetchedAt: new Date() };
      out.set(k, q);
      await store(q).catch((e) => console.warn("[prices] store failed", e));
    }),
  );
  return out;
}

/** Stored daily prices for one instrument, oldest first (for the price chart). */
export async function priceHistory(key: string, limit = 400): Promise<{ date: ISODate; price4: number }[]> {
  const rows = await priceHistoryCollection().find({ key }).sort({ date: -1 }).limit(limit).toArray();
  return rows.reverse().map((r) => ({ date: r.date, price4: r.price4 }));
}
