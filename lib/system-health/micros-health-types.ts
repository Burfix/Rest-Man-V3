/**
 * lib/system-health/micros-health-types.ts
 *
 * Shared types for the MICROS mission control feature.
 */

import type { MicrosHealthScore } from "./micros-score";

export interface MicrosSiteHealth {
  connectionId:         string;
  siteId:               string | null;
  siteName:             string;
  locationKey:          string | null;
  locationRef:          string | null;

  // Connection state
  connectionStatus:     string;          // 'connected' | 'error' | 'syncing' | 'pending'

  // Latest sync
  lastSyncAt:           string | null;   // ISO from micros_connections
  lastSuccessfulSyncAt: string | null;
  lastSyncError:        string | null;

  // From sync logs
  logLastSyncAt:        string | null;
  lastDurationMs:       number | null;
  lastSalesRecords:     number;
  lastLabourRecords:    number;

  // Aggregates
  failures24h:          number;
  failures7d:           number;
  avgDurationMs:        number;
  salesSyncedToday:     number;
  labourSyncedToday:    number;
  syncCountToday:       number;

  // Freshness
  dataAgeMinutes:       number | null;

  // Computed score
  health:               MicrosHealthScore;
}

export interface MicrosHealthSummary {
  totalSites:         number;
  healthySites:       number;
  warningSites:       number;
  criticalSites:      number;
  totalSyncedToday:   number;
  avgLatencyMs:       number;
  worstSite:          string | null;
  overallSeverity:    "healthy" | "warning" | "critical";
}

export interface MicrosHealthAlert {
  type:      "MICROS_STALE" | "MICROS_FAILURE" | "MICROS_NO_SALES" | "MICROS_EMPTY_LABOUR" | "MICROS_DISCONNECTED";
  severity:  "warning" | "critical";
  siteId:    string | null;
  siteName:  string;
  message:   string;
}

export interface MicrosHealthApiResponse {
  sites:    MicrosSiteHealth[];
  summary:  MicrosHealthSummary;
  alerts:   MicrosHealthAlert[];
  asOf:     string;
}
