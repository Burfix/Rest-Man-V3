/**
 * lib/sales/freshness.ts — Freshness policy for sales data
 *
 * Thresholds (for UI indicator only — does NOT gate data visibility):
 *   LIVE    = data updated ≤ 20 minutes ago
 *   STALE   = data updated 21–120 minutes ago
 *   OFFLINE = no data or last update > 120 minutes ago
 */

import type { SalesFreshnessState } from "./types";

export const FRESHNESS_LIVE_MAX_MINUTES = 20;
export const FRESHNESS_STALE_MAX_MINUTES = 120;

export function classifyFreshness(minutesSinceUpdate: number | null): SalesFreshnessState {
  if (minutesSinceUpdate == null) return "offline";
  if (minutesSinceUpdate <= FRESHNESS_LIVE_MAX_MINUTES) return "live";
  if (minutesSinceUpdate <= FRESHNESS_STALE_MAX_MINUTES) return "stale";
  return "offline";
}

export function freshnessLabel(minutes: number | null): string {
  if (minutes == null) return "unknown";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  return `${h}h ago`;
}

export function freshnessSourceLabel(
  source: "micros" | "manual" | "forecast",
  state: SalesFreshnessState,
): string {
  switch (source) {
    case "micros":
      if (state === "live") return "MICROS LIVE";
      if (state === "stale") return "MICROS STALE";
      return "MICROS OFFLINE";
    case "manual":
      return "MANUAL UPLOAD";
    case "forecast":
      return "FORECAST";
  }
}
