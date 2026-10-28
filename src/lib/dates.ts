// Date-only helpers. All dates are "YYYY-MM-DD" strings, handled in UTC
// internally so arithmetic never shifts a day because of the local timezone.

import type { ISODate } from "./types";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepted date range. Rejects absurd years that would make schedules meaningless. */
const MIN_DATE = "1900-01-01";
const MAX_DATE = "2199-12-31";

export function isISODate(value: string): boolean {
  if (typeof value !== "string" || !ISO_RE.test(value) || value < MIN_DATE || value > MAX_DATE) return false;
  const d = parse(value);
  return toISO(d) === value; // rejects 2026-02-30 etc.
}

function parse(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Today's calendar date in the given IANA timezone (e.g. "Asia/Kolkata").
 * Servers usually run in UTC, so the caller passes the user's timezone;
 * without one this falls back to the machine's local date.
 */
export function today(timeZone?: string, now: Date = new Date()): ISODate {
  if (timeZone && isValidTimeZone(timeZone)) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Add months, clamping to the last day of the target month.
 * Jan 31 + 1 month = Feb 28/29. The caller should always add to the original
 * anchor (not to an already-clamped date) so Mar is back to the 31st.
 */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = parse(date);
  const day = d.getUTCDate();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month0 = total % 12;
  const clamped = Math.min(day, daysInMonth(year, month0));
  return toISO(new Date(Date.UTC(year, month0, clamped)));
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);
}

/** "YYYY-MM" for the month containing the date. */
export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function monthBounds(month: string): { start: ISODate; end: ISODate } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(y, m - 1)).padStart(2, "0")}`;
  return { start, end };
}

export function shiftMonth(month: string, delta: number): string {
  return addMonths(`${month}-01`, delta).slice(0, 7);
}

export function isValidMonth(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value) && isISODate(`${value}-01`);
}

// ---- Display ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Oct 5" (adds the year when it differs from the reference year). */
export function formatDate(date: ISODate, reference?: ISODate): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  if (reference && reference.slice(0, 4) !== date.slice(0, 4)) return `${base}, ${y}`;
  return base;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** Human description of a due date relative to today. */
export function relativeDue(due: ISODate, todayDate: ISODate): string {
  const diff = diffDays(due, todayDate);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < 0) return `${-diff} days overdue`;
  if (diff < 7) return `Due in ${diff} days`;
  return `Due ${formatDate(due, todayDate)}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
