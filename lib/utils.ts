import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

// ============================================================
// Tailwind class merging
// ============================================================

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ============================================================
// Date helpers
// ============================================================

/** Format a date string for display: "Saturday, 21 March 2026" */
export function formatDisplayDate(dateStr: string): string {
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, "EEEE, d MMMM yyyy") : dateStr;
}

/** Format a date string for display: "21 Mar 2026" */
export function formatShortDate(dateStr: string): string {
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, "d MMM yyyy") : dateStr;
}

/** Return the day name (lowercase) for a given ISO date string */
export function getDayName(dateStr: string): string {
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, "EEEE").toLowerCase() : "";
}

/**
 * Return today's date as YYYY-MM-DD.
 * Reads TZ from VENUE_TIMEZONE env var; falls back to Africa/Johannesburg (SAST).
 * Override this env var when deploying for venues outside South Africa.
 */
export function todayISO(): string {
  const tz = process.env.VENUE_TIMEZONE ?? "Africa/Johannesburg";
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

// ============================================================
// Phone number normalisation
// ============================================================

/**
 * Normalise WhatsApp phone numbers to E.164 without the leading +.
 * WhatsApp Cloud API delivers numbers as "27821234567" (no +).
 */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ============================================================
// Service charge helper
// ============================================================

export function requiresServiceCharge(guestCount: number, threshold: number): boolean {
  return guestCount > threshold;
}

// ============================================================
// Safe JSON parse
// ============================================================

export function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// ============================================================
// Supabase numeric column helper
// ============================================================

/**
 * Safely parse a Supabase numeric column (returned as string | number) to float.
 * Postgres NUMERIC columns come back as strings from the JS client.
 */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

// ============================================================
// N days ago helper
// ============================================================

// ============================================================
// Currency formatting (South African Rand)
// ============================================================

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(value);
}

// ============================================================
// Date offset helpers
// ============================================================

/** Return a date N days ago as YYYY-MM-DD in Africa/Johannesburg timezone */
export function nDaysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

// ============================================================
// Phone number masking (privacy)
// ============================================================

/**
 * Mask a phone number for display in list views.
 * Shows the first prefix segment and last 3 digits only.
 *
 * Examples:
 *   +27821234567  →  +27*******567
 *   0821234567    →  082*****567
 *   +1 555 000 1234 →  +1*********234
 *
 * If the number is too short to mask sensibly, returns "••••••••".
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "••••••••";

  // Preserve the leading + if present, plus the international prefix (2-3 digits)
  const hasPlus = phone.startsWith("+");
  const prefix = hasPlus ? "+" + digits.slice(0, 2) : digits.slice(0, 3);
  const suffix = digits.slice(-3);
  const masked = "*".repeat(Math.max(digits.length - prefix.replace("+", "").length - 3, 3));
  return `${prefix}${masked}${suffix}`;
}

// ============================================================
// Test / dummy data guard
// ============================================================

const TEST_NAME_PATTERNS = [/\btest\b/i, /\bdummy\b/i, /\bdemo\b/i];
const TEST_PHONE_PATTERNS = [/0{5,}/, /1234567/];

/**
 * Returns true if this looks like test/dummy data that should be suppressed
 * in a production UI.
 */
export function isTestEntry({
  name,
  phone,
}: {
  name?: string | null;
  phone?: string | null;
}): boolean {
  if (name && TEST_NAME_PATTERNS.some((p) => p.test(name))) return true;
  if (phone && TEST_PHONE_PATTERNS.some((p) => p.test(phone))) return true;
  return false;
}

