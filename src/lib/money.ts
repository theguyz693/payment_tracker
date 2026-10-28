// Money helpers. Amounts are integer paise everywhere except at the edges
// (form input and display).

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** 2500000 -> "₹25,000"; 64950 -> "₹649.50" */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  const text = Number.isInteger(rupees) ? inr.format(rupees) : inr.format(Number(rupees.toFixed(2)));
  return `₹${text}`;
}

/** Signed version for net figures: "+₹1,200" / "−₹800" */
export function formatSignedINR(paise: number): string {
  if (paise === 0) return formatINR(0);
  return `${paise > 0 ? "+" : "−"}${formatINR(Math.abs(paise))}`;
}

/** Largest amount accepted anywhere: ₹10,000 crore. Keeps every sum far inside safe-integer range. */
export const MAX_AMOUNT_PAISE = 10_000_000_000_000; // 1e13 paise

/** "25,000.5" -> 2500050. Returns null for invalid or out-of-range input. */
export function parseRupees(input: string): number | null {
  if (input.length > 32) return null;
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(cleaned)) return null;
  // Integer maths on the digits (no float rounding): "12.5" -> 1250.
  const [whole, frac = ""] = cleaned.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return paise <= MAX_AMOUNT_PAISE ? paise : null;
}

/** 2500050 -> "25000.5" (for pre-filling the edit form). */
export function paiseToInput(paise: number): string {
  return String(paise / 100);
}
