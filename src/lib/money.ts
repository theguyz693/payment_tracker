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

/** "25,000.5" -> 2500050. Returns null for invalid input. */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** 2500050 -> "25000.5" (for pre-filling the edit form). */
export function paiseToInput(paise: number): string {
  return String(paise / 100);
}
