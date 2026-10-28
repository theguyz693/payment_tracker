// Fixed-point helpers for investment maths.
//
// Storage units (all integers, so values survive JSON/Mongo without drift):
//   money       integer paise                    (₹1 = 100)
//   quantities  integer micro-units  (QTY_DP=6)  (units, shares, grams)
//   prices      integer 1/10,000 ₹   (PRICE_DP=4) (NAV, share price, ₹/gram)
//   rates       integer basis points             (1% = 100)
//
// Products use BigInt and are rounded ONCE, half away from zero, to the paise.

export const QTY_DP = 6;
export const PRICE_DP = 4;
const QTY_SCALE = 10n ** BigInt(QTY_DP);
const PRICE_SCALE = 10n ** BigInt(PRICE_DP);

/** Integer division rounding half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("division by zero");
  const neg = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  return neg ? -q : q;
}

/** "12.3456" with places=4 -> 123456. Rejects more decimals than allowed. */
export function parseDecimal(input: string, places: number): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > places) return null;
  const scaled = BigInt(m[1]) * 10n ** BigInt(places) + BigInt(frac.padEnd(places, "0") || "0");
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(scaled);
}

/** 123456 with places=4 -> "12.3456" (trailing zeros trimmed to `minDp`). */
export function formatScaled(value: number, places: number, minDp = 0): string {
  const neg = value < 0;
  const abs = BigInt(Math.abs(value));
  const scale = 10n ** BigInt(places);
  const whole = (abs / scale).toLocaleString("en-IN");
  let frac = (abs % scale).toString().padStart(places, "0").replace(/0+$/, "");
  if (frac.length < minDp) frac = frac.padEnd(minDp, "0");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Value in paise of `qtyMicro` units at `price4` per unit. */
export function valuePaise(qtyMicro: number, price4: number): number {
  // paise = qty/1e6 * price/1e4 * 100
  return Number(divRound(BigInt(qtyMicro) * BigInt(price4) * 100n, QTY_SCALE * PRICE_SCALE));
}

/** Price per unit (1/10,000 ₹) implied by paying `paise` for `qtyMicro` units. */
export function unitPrice4(paise: number, qtyMicro: number): number {
  if (qtyMicro <= 0) throw new RangeError("quantity must be positive");
  return Number(divRound(BigInt(paise) * QTY_SCALE * PRICE_SCALE, BigInt(qtyMicro) * 100n));
}

/** a * num / den, rounded half away from zero (for pro-rating paise). */
export function mulDiv(a: number, num: number, den: number): number {
  return Number(divRound(BigInt(a) * BigInt(num), BigInt(den)));
}

/** Apply basis points: applyBps(10000, 250) = 250 (2.5% of ₹100). */
export function applyBps(paise: number, bps: number): number {
  return mulDiv(paise, bps, 10_000);
}

/** Percentage string from a ratio: 0.1234 -> "12.34%". */
export function formatPct(ratio: number, dp = 2): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(dp)}%`;
}

export function formatSignedPct(ratio: number, dp = 2): string {
  if (!Number.isFinite(ratio)) return "—";
  const s = formatPct(Math.abs(ratio), dp);
  return ratio > 0 ? `+${s}` : ratio < 0 ? `−${s}` : s;
}

/** "8.5" -> 850 bps. */
export function parseRateBps(input: string): number | null {
  const v = parseDecimal(input.replace(/%/g, ""), 2);
  return v === null ? null : v;
}
