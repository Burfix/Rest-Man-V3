/**
 * lib/system-health/getMicrosHealth.ts
 *
 * Fetches v_micros_system_health rows and produces the full
 * MicrosHealthApiResponse — scoring, alerts, and summary included.
 * Scoped to the caller's accessible sites (RLS + siteIds filter).
 */

import { createServerClient }    from "@/lib/supabase/server";
import { scoreMicrosHealth }     from "./micros-score";
import type {
  MicrosHealthAlert,
  MicrosHealthApiResponse,
  MicrosHealthSummary,
  MicrosSiteHealth,
} from "./micros-health-types";

export async function getMicrosHealth(
  siteIds: string[] | "all",
): Promise<MicrosHealthApiResponse> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any).from("v_micros_system_health").select("*");
  if (siteIds !== "all" && siteIds.length > 0) {
    query = query.in("site_id", siteIds);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(`v_micros_system_health query failed: ${error.message}`);

  const sites: MicrosSiteHealth[] = (rows ?? []).map((r: Record<string, unknown>) => {
    const health = scoreMicrosHealth({
      dataAgeMinutes:   r.data_age_minutes   != null ? Number(r.data_age_minutes)   : null,
      failures24h:      Number(r.failures_24h  ?? 0),
      failures7d:       Number(r.failures_7d   ?? 0),
      avgDurationMs:    Number(r.avg_duration_ms ?? 0),
      connectionStatus: (r.connection_status as string) ?? null,
    });

    return {
      connectionId:          r.connection_id  as string,
      siteId:                r.site_id        as string | null,
      siteName:              (r.site_name as string) || "Unknown",
      locationKey:           r.location_key   as string | null,
      locationRef:           r.loc_ref        as string | null,
      connectionStatus:      (r.connection_status as string) || "unknown",
      lastSyncAt:            r.last_sync_at   as string | null,
      lastSuccessfulSyncAt:  r.last_successful_sync_at as string | null,
      lastSyncError:         r.last_sync_error as string | null,
      logLastSyncAt:         r.log_last_sync_at as string | null,
      lastDurationMs:        r.last_duration_ms != null ? Number(r.last_duration_ms) : null,
      lastSalesRecords:      Number(r.last_sales_records  ?? 0),
      lastLabourRecords:     Number(r.last_labour_records ?? 0),
      failures24h:           Number(r.failures_24h  ?? 0),
      failures7d:            Number(r.failures_7d   ?? 0),
      avgDurationMs:         Number(r.avg_duration_ms ?? 0),
      salesSyncedToday:      Number(r.sales_synced_today  ?? 0),
      labourSyncedToday:     Number(r.labour_synced_today ?? 0),
      syncCountToday:        Number(r.sync_count_today    ?? 0),
      dataAgeMinutes:        r.data_age_minutes != null ? Number(r.data_age_minutes) : null,
      health,
    } satisfies MicrosSiteHealth;
  });

  // ── Alerts ───────────────────────────────────────────────────────────────
  const alerts: MicrosHealthAlert[] = [];

  for (const site of sites) {
    if (site.connectionStatus !== "connected" && site.connectionStatus !== "syncing") {
      alerts.push({
        type:     "MICROS_DISCONNECTED",
        severity: "critical",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName} MICROS connection is ${site.connectionStatus}`,
      });
    }

    if (site.dataAgeMinutes !== null && site.dataAgeMinutes > 480) {
      alerts.push({
        type:     "MICROS_STALE",
        severity: "critical",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName} data stale for ${Math.round(site.dataAgeMinutes / 60)}h`,
      });
    } else if (site.dataAgeMinutes !== null && site.dataAgeMinutes > 120) {
      alerts.push({
        type:     "MICROS_STALE",
        severity: "warning",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName} data stale for ${Math.round(site.dataAgeMinutes)} min`,
      });
    }

    if (site.failures24h > 3) {
      alerts.push({
        type:     "MICROS_FAILURE",
        severity: "critical",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName} had ${site.failures24h} sync failures in 24h`,
      });
    } else if (site.failures24h > 0) {
      alerts.push({
        type:     "MICROS_FAILURE",
        severity: "warning",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName} had ${site.failures24h} sync failure(s) in 24h`,
      });
    }

    if (site.salesSyncedToday === 0 && site.connectionStatus === "connected") {
      alerts.push({
        type:     "MICROS_NO_SALES",
        severity: "warning",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName}: no sales synced today`,
      });
    }

    if (site.labourSyncedToday === 0 && site.connectionStatus === "connected") {
      alerts.push({
        type:     "MICROS_EMPTY_LABOUR",
        severity: "warning",
        siteId:   site.siteId,
        siteName: site.siteName,
        message:  `${site.siteName}: no labour synced today`,
      });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const healthy  = sites.filter((s) => s.health.severity === "healthy").length;
  const warning  = sites.filter((s) => s.health.severity === "warning").length;
  const critical = sites.filter((s) => s.health.severity === "critical").length;

  const totalSyncedToday = sites.reduce((acc, s) => acc + s.salesSyncedToday + s.labourSyncedToday, 0);
  const connectedSites   = sites.filter((s) => s.avgDurationMs > 0);
  const avgLatencyMs     = connectedSites.length > 0
    ? Math.round(connectedSites.reduce((a, s) => a + s.avgDurationMs, 0) / connectedSites.length)
    : 0;

  const worstSite = sites.length > 0
    ? sites.reduce((worst, s) => s.health.score < worst.health.score ? s : worst).siteName
    : null;

  const overallSeverity =
    critical > 0 ? "critical" :
    warning  > 0 ? "warning"  :
    "healthy";

  const summary: MicrosHealthSummary = {
    totalSites:       sites.length,
    healthySites:     healthy,
    warningSites:     warning,
    criticalSites:    critical,
    totalSyncedToday,
    avgLatencyMs,
    worstSite:        worstSite === sites[0]?.siteName && sites.length === 1 ? null : worstSite,
    overallSeverity,
  };

  return { sites, summary, alerts, asOf: new Date().toISOString() };
}
