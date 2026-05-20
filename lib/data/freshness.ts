/**
 * lib/data/freshness.ts
 *
 * Utility to determine whether a data timestamp is "fresh" enough
 * to be shown as LIVE and used at full confidence.
 *
 * Rule: data older than 30 minutes is considered stale.
 * - LIVE badge must be hidden when data is stale.
 * - Score confidence must be downgraded to "low" when revenue or labour is stale.
 */

/** Default maximum age in minutes before data is considered stale. */
const DEFAULT_MAX_AGE_MINUTES = 30;

/**
 * Returns true when the timestamp is within the freshness window.
 * Returns false when the timestamp is null, undefined, unparseable, or too old.
 */
export function isFresh(
  timestamp: string | null | undefined,
  maxAgeMinutes: number = DEFAULT_MAX_AGE_MINUTES,
): boolean {
  if (!timestamp) return false;
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return false;
  const ageMinutes = (Date.now() - ts) / 60_000;
  return ageMinutes <= maxAgeMinutes;
}

/**
 * Returns the age of the timestamp in minutes, or null if timestamp is missing/invalid.
 */
export function ageInMinutes(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / 60_000;
}

/**
 * Returns a human-readable staleness label for display.
 * - "Just now"    — < 1 min
 * - "5 min ago"   — < 30 min
 * - "Stale"       — 30–120 min
 * - "No data"     — > 120 min or null
 */
export function freshnessLabel(timestamp: string | null | undefined): string {
  const age = ageInMinutes(timestamp);
  if (age === null) return "No data";
  if (age < 1)   return "Just now";
  if (age < 30)  return `${Math.round(age)} min ago`;
  if (age < 120) return "Stale";
  return "No data";
}
