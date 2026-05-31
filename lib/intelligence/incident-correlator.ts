/**
 * lib/intelligence/incident-correlator.ts
 *
 * Deterministic multi-site incident correlation engine.
 *
 * Operates on the `system_incidents` table (migration 080) to detect:
 *   1. Incident clusters — 2+ sites hit the same source within a 2-hour window
 *   2. Vendor suspicion — a cluster spanning 3+ distinct sites
 *   3. Repeated failures — same (site_id, source) fires 3+ times within the window
 *
 * No AI/LLM. No automated actions. Read-only.
 *
 * Correlation rules (deterministic):
 *   - "Cluster" threshold: 2+ distinct sites, same source, within CLUSTER_WINDOW_MINUTES
 *   - "Vendor suspicion": cluster with 3+ distinct sites
 *   - "Repeated failure": same (site_id, source) has ≥ REPEATED_FAILURE_THRESHOLD incidents
 *
 * Uses the service-role client to read across all sites without RLS interference.
 */

import { logger }       from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";

// ── Constants ─────────────────────────────────────────────────────────────────

const CLUSTER_WINDOW_MINUTES      = 120;
const REPEATED_FAILURE_THRESHOLD  = 3;
const VENDOR_SUSPICION_MIN_SITES  = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClusterSeverity = "info" | "warning" | "critical";

export interface IncidentCluster {
  /** Source key as stored in system_incidents.source — e.g. "ops.revenue_stale" */
  sourceKey: string;
  /** Human-readable label */
  label: string;
  /** All distinct site UUIDs in the hottest 2-hour window */
  affectedSiteIds: string[];
  affectedSiteCount: number;
  /** Highest severity among incidents in the cluster window */
  severity: ClusterSeverity;
  /** ISO timestamp of the first incident in the window */
  earliestAt: string;
  /** ISO timestamp of the most recent incident in the window */
  latestAt: string;
  /** Span of the window in minutes */
  windowMinutes: number;
  /** True when affectedSiteCount >= VENDOR_SUSPICION_MIN_SITES */
  isVendorSuspicion: boolean;
  /** UUIDs of the incidents within this cluster window */
  incidentIds: string[];
}

export interface RepeatedFailure {
  siteId: string;
  sourceKey: string;
  label: string;
  count: number;
  firstAt: string;
  lastAt: string;
  severity: ClusterSeverity;
}

export interface CorrelationReport {
  orgId: string;
  generatedAt: string;
  windowHours: number;
  clusters: IncidentCluster[];
  repeatedFailures: RepeatedFailure[];
  totalOpenIncidents: number;
  vendorSuspicionCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceDb() {
  return getServiceRoleClient();
}

/**
 * Human-readable label for a source key written by incident-bridge.
 * Falls back to a title-cased version of the raw key.
 */
function sourceLabel(key: string): string {
  const labels: Record<string, string> = {
    "ops.revenue_stale":       "Revenue Feed Stale",
    "ops.labour_stale":        "Labour Feed Stale",
    "ops.inventory_stale":     "Inventory Feed Stale",
    "ops.micros_disconnected": "MICROS Disconnected",
    "ops.sync_failing":        "Sync Failing",
  };
  if (labels[key]) return labels[key];
  return key
    .replace(/^ops\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function maxSeverity(severities: string[]): ClusterSeverity {
  if (severities.includes("critical")) return "critical";
  if (severities.includes("warning"))  return "warning";
  return "info";
}

// ── Clustering ────────────────────────────────────────────────────────────────

interface RawIncident {
  id:         string;
  site_id:    string;
  source:     string;
  severity:   string;
  created_at: string;
}

/**
 * Given a group of incidents sharing the same source, find the
 * CLUSTER_WINDOW_MINUTES window that covers the most distinct sites.
 *
 * Algorithm: for each incident as a window-start, collect all incidents
 * within the next CLUSTER_WINDOW_MINUTES. Track the window with the
 * highest distinct-site count. O(N²) — safe at restaurant-group scale.
 */
function findHottestWindow(incidents: RawIncident[]): RawIncident[] {
  if (incidents.length === 0) return [];

  const sorted = [...incidents].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  let best: RawIncident[] = [];

  for (const anchor of sorted) {
    const windowStart = new Date(anchor.created_at).getTime();
    const windowEnd   = windowStart + CLUSTER_WINDOW_MINUTES * 60_000;

    const inWindow = sorted.filter((inc) => {
      const t = new Date(inc.created_at).getTime();
      return t >= windowStart && t <= windowEnd;
    });

    const distinctNow  = new Set(inWindow.map((x) => x.site_id)).size;
    const distinctBest = new Set(best.map((x) => x.site_id)).size;

    if (distinctNow > distinctBest) {
      best = inWindow;
    }
  }

  return best;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Correlate incidents across sites to detect clusters and repeated failures.
 *
 * @param siteIds     - Site UUIDs visible to the requesting user (already resolved)
 * @param orgId       - Organisation ID — used only for report labeling
 * @param windowHours - How far back to look (default: 24h)
 */
export async function correlateIncidents(
  siteIds: string[],
  orgId: string,
  windowHours = 24,
): Promise<CorrelationReport> {
  const generatedAt = new Date().toISOString();

  if (siteIds.length === 0) {
    return {
      orgId,
      generatedAt,
      windowHours,
      clusters:            [],
      repeatedFailures:    [],
      totalOpenIncidents:  0,
      vendorSuspicionCount: 0,
    };
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const since = new Date(Date.now() - windowHours * 60 * 60_000).toISOString();

  const { data, error } = await db
    .from("system_incidents")
    .select("id, site_id, source, severity, created_at")
    .in("site_id", siteIds)
    .in("status", ["open", "investigating"])
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("incident-correlator.query_failed", { err: error.message });
    throw new Error(`Correlation query failed: ${error.message}`);
  }

  const incidents: RawIncident[] = data ?? [];
  const totalOpenIncidents = incidents.length;

  // ── 1. Group by source ────────────────────────────────────────────────────
  const bySource = new Map<string, RawIncident[]>();
  for (const inc of incidents) {
    const group = bySource.get(inc.source) ?? [];
    group.push(inc);
    bySource.set(inc.source, group);
  }

  // ── 2. Find clusters ──────────────────────────────────────────────────────
  const clusters: IncidentCluster[] = [];

  for (const [src, group] of Array.from(bySource.entries())) {
    const window = findHottestWindow(group);
    const distinctSites = Array.from(new Set(window.map((x) => x.site_id)));

    // A cluster requires 2+ distinct sites — single-site degradation is a
    // repeated failure, not a cluster.
    if (distinctSites.length < 2) continue;

    const timestamps  = window.map((x) => new Date(x.created_at).getTime());
    const earliestMs  = Math.min(...timestamps);
    const latestMs    = Math.max(...timestamps);
    const windowMinutes = Math.round((latestMs - earliestMs) / 60_000);

    clusters.push({
      sourceKey:         src,
      label:             sourceLabel(src),
      affectedSiteIds:   distinctSites,
      affectedSiteCount: distinctSites.length,
      severity:          maxSeverity(window.map((x) => x.severity)),
      earliestAt:        new Date(earliestMs).toISOString(),
      latestAt:          new Date(latestMs).toISOString(),
      windowMinutes,
      isVendorSuspicion: distinctSites.length >= VENDOR_SUSPICION_MIN_SITES,
      incidentIds:       window.map((x) => x.id),
    });
  }

  // Sort: vendor suspicion first, then by affected site count descending.
  clusters.sort((a, b) => {
    if (a.isVendorSuspicion !== b.isVendorSuspicion) {
      return a.isVendorSuspicion ? -1 : 1;
    }
    return b.affectedSiteCount - a.affectedSiteCount;
  });

  // ── 3. Repeated failures ──────────────────────────────────────────────────
  const pairMap = new Map<string, RawIncident[]>();
  for (const inc of incidents) {
    const key = `${inc.site_id}::${inc.source}`;
    const arr = pairMap.get(key) ?? [];
    arr.push(inc);
    pairMap.set(key, arr);
  }

  const repeatedFailures: RepeatedFailure[] = [];
  for (const [key, incs] of Array.from(pairMap.entries())) {
    if (incs.length < REPEATED_FAILURE_THRESHOLD) continue;

    const [siteId, src] = key.split("::");
    const timestamps = incs.map((x) => new Date(x.created_at).getTime());

    repeatedFailures.push({
      siteId,
      sourceKey: src,
      label:     sourceLabel(src),
      count:     incs.length,
      firstAt:   new Date(Math.min(...timestamps)).toISOString(),
      lastAt:    new Date(Math.max(...timestamps)).toISOString(),
      severity:  maxSeverity(incs.map((x) => x.severity)),
    });
  }

  // Sort by count descending — highest-frequency failures up top.
  repeatedFailures.sort((a, b) => b.count - a.count);

  const vendorSuspicionCount = clusters.filter((c) => c.isVendorSuspicion).length;

  return {
    orgId,
    generatedAt,
    windowHours,
    clusters,
    repeatedFailures,
    totalOpenIncidents,
    vendorSuspicionCount,
  };
}
