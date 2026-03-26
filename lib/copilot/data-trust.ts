/**
 * Data Trust Engine
 *
 * getDecisionTrustState(storeId) → DataTrustState
 *
 * Checks freshness of all data sources and returns
 * operational language about decision reliability.
 */

import type { DataTrustState, TrustState, StaleSource } from "./types";

export interface TrustInput {
  salesAgeMinutes: number | null;
  labourAgeMinutes: number | null;
  inventoryAgeMinutes: number | null;
  reviewsAgeDays: number | null;
  bookingsLive: boolean;
}

interface SourceConfig {
  name: string;
  ageMinutes: number | null;
  thresholdMinutes: number;
  impact: string;
}

export function getDecisionTrustState(input: TrustInput): DataTrustState {
  const sources: SourceConfig[] = [
    {
      name: "Sales",
      ageMinutes: input.salesAgeMinutes,
      thresholdMinutes: 480,          // 8 hours
      impact: "Revenue and service decisions operating on stale data",
    },
    {
      name: "Labour",
      ageMinutes: input.labourAgeMinutes,
      thresholdMinutes: 480,
      impact: "Labour cost decisions may not reflect current staffing",
    },
    {
      name: "Inventory",
      ageMinutes: input.inventoryAgeMinutes,
      thresholdMinutes: 1440,         // 24 hours
      impact: "Stock risk assessment may miss recent consumption",
    },
    {
      name: "Reviews",
      ageMinutes: input.reviewsAgeDays != null ? input.reviewsAgeDays * 1440 : null,
      thresholdMinutes: 20160,        // 14 days
      impact: "Guest sentiment data aging — may miss emerging service issues",
    },
  ];

  const staleSources: StaleSource[] = [];

  for (const s of sources) {
    if (s.ageMinutes == null) {
      staleSources.push({
        source: s.name,
        lastUpdated: null,
        ageMinutes: null,
        impact: `${s.name} data unavailable`,
      });
    } else if (s.ageMinutes > s.thresholdMinutes) {
      staleSources.push({
        source: s.name,
        lastUpdated: null,
        ageMinutes: s.ageMinutes,
        impact: s.impact,
      });
    }
  }

  // Also check bookings
  if (!input.bookingsLive) {
    staleSources.push({
      source: "Bookings",
      lastUpdated: null,
      ageMinutes: null,
      impact: "Booking data not live — cover forecasts may be inaccurate",
    });
  }

  // ── Determine trust state ──────────────────────────────────────────────────

  let trustState: TrustState;
  const criticalStale = staleSources.filter(s =>
    s.source === "Sales" || s.source === "Labour"
  ).length;

  if (criticalStale >= 2 || staleSources.length >= 4) {
    trustState = "unreliable";
  } else if (criticalStale >= 1 || staleSources.length >= 3) {
    trustState = "degraded";
  } else if (staleSources.length >= 1) {
    trustState = "partial";
  } else {
    trustState = "trusted";
  }

  // ── Explanation ────────────────────────────────────────────────────────────

  let explanation: string;
  switch (trustState) {
    case "trusted":
      explanation = "All data sources current. Decisions fully informed.";
      break;
    case "partial":
      explanation = `Decisions based on partial data. ${staleSources[0]?.source} data ${formatAge(staleSources[0]?.ageMinutes)}.`;
      break;
    case "degraded":
      explanation = `${staleSources.length} data sources stale. Key decisions may not reflect current conditions.`;
      break;
    case "unreliable":
      explanation = "Critical data sources offline. Operating on limited visibility — validate decisions manually.";
      break;
  }

  return { trustState, staleSources, explanation };
}

function formatAge(minutes: number | null | undefined): string {
  if (minutes == null) return "unavailable";
  if (minutes < 60) return `${Math.round(minutes)}m old`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h old`;
  return `${Math.round(minutes / 1440)}d old`;
}
