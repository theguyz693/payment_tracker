// Joins class names, skipping falsy values (used by the ReceiptPrinter component).
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
