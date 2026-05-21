/**
 * lib/system-health/getSystemHealth.ts
 *
 * Core system health service.
 *
 * Runs all queries in parallel. Every section is individually try/caught so
 * a DB error in one section never prevents the rest from rendering.
 *
 * Returns SystemHealthPayload — a stable, typed snapshot of platform state.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type {
  SystemHealthPayload,
  DataSourceHealth,
  DataSourceStatus,
  TrustLevel,
  MicrosHealth,
  JobHealth,
  JobStatus,
  ChecklistItem,
  SystemIncident,
  ErrorHealth,
  OverallStatus,
} from "./types";

// ── Job definitions ───────────────────────────────────────────────────────────

const JOB_DEFINITIONS: { jobType: string; label: string; canRunNow: boolean }[] = [
  { jobType: "sales_sync",          label: "MICROS Sales Sync",           canRunNow: true },
  { jobType: "labour_sync",         label: "MICROS Labour Sync",          canRunNow: true },
  { jobType: "inventory_sync",      label: "Inventory Sync",              canRunNow: true },
  { jobType: "daily_action_reset",  label: "Daily Action Reset",          canRunNow: false },
  { jobType: "action_aging",        label: "Action Aging",                canRunNow: false },
  { jobType: "weekly_report",       label: "Weekly Report Generation",    canRunNow: false },
  { jobType: "data_health_recompute", label: "Data Health Recompute",     canRunNow: false },
];

// ── Status derivation ─────────────────────────────────────────────────────────

function dataSourceStatus(
  key: string,
  ageMinutes: number | null,
): DataSourceStatus {
  if (ageMinutes === null) {
    // For compliance/maintenance, null means no recent events — that's normal
    if (["compliance", "maintenance", "reviews"].includes(key)) return "not_configured";
    return "not_configured";
  }
  if (ageMinutes <= 15)   return "live";
  if (ageMinutes <= 60)   return "fresh";
  if (ageMinutes <= 180)  return "delayed";
  if (ageMinutes <= 720)  return "stale";
  return "missing";
}

function trustFromStatus(status: DataSourceStatus): TrustLevel {
  switch (status) {
    case "live":           return "high";
    case "fresh":          return "high";
    case "delayed":        return "medium";
    case "stale":          return "low";
    case "missing":        return "none";
    case "not_configured": return "none";
  }
}

function actionFromStatus(key: string, status: DataSourceStatus): string {
  if (status === "live" || status === "fresh") return "No action needed";
  if (status === "not_configured") return "Configure data source to enable tracking";
  const labels: Record<string, string> = {
    sales:       "Run MICROS sales sync and verify POS connection",
    labour:      "Run MICROS labour sync and check time card data",
    inventory:   "Run inventory sync from Integrations",
    reviews:     "Check reviews integration in Settings",
    daily_ops:   "Confirm daily tasks are being logged by the team",
    compliance:  "Verify compliance items are up to date",
    maintenance: "Check for unlogged maintenance events",
  };
  if (status === "delayed") return `${labels[key] ?? "Check data source"} — sync appears delayed`;
  if (status === "stale")   return `${labels[key] ?? "Check data source"} — data is stale`;
  return `${labels[key] ?? "Check data source"} — data missing`;
}

function jobStatusFromRow(row: any): JobStatus {
  if (!row) return "idle";
  switch (row.status) {
    case "running":     return "running";
    case "success":     return "success";
    case "failed":      return "failed";
    case "dead_letter": return "failed";
    default:            return "idle";
  }
}

// ── Weighted freshness score ──────────────────────────────────────────────────

const STATUS_WEIGHTS: Record<DataSourceStatus, number> = {
  live:           1.0,
  fresh:          0.85,
  delayed:        0.5,
  stale:          0.2,
  missing:        0.0,
  not_configured: 0.5, // neutral — not a problem, just not set up
};

// Core sources are weighted more heavily
const SOURCE_WEIGHTS: Record<string, number> = {
  sales:       2.0,
  labour:      2.0,
  inventory:   1.0,
  reviews:     0.5,
  daily_ops:   1.0,
  compliance:  0.5,
  maintenance: 0.5,
};

function calculateFreshnessScore(sources: DataSourceHealth[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of sources) {
    const w = SOURCE_WEIGHTS[s.key] ?? 1.0;
    weightedSum += STATUS_WEIGHTS[s.status] * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 100;
  return Math.round((weightedSum / totalWeight) * 100);
}

// ── Overall status ────────────────────────────────────────────────────────────

function calculateOverallStatus(
  sources: DataSourceHealth[],
  failedJobs: number,
): { status: OverallStatus; summary: string } {
  const salesSource  = sources.find(s => s.key === "sales");
  const labourSource = sources.find(s => s.key === "labour");

  const salesMissing  = salesSource?.status  === "missing";
  const labourMissing = labourSource?.status === "missing";
  const anyStale      = sources.some(s => s.status === "stale"   && ["sales", "labour"].includes(s.key));
  const anyDelayed    = sources.some(s => s.status === "delayed" && ["sales", "labour"].includes(s.key));
  const hasFailedJobs = failedJobs > 0;

  if (salesMissing || labourMissing) {
    const missing = [salesMissing && "sales", labourMissing && "labour"].filter(Boolean).join(" and ");
    return {
      status:  "critical",
      summary: `Core data unavailable — ${missing} data has not synced in over 12 hours. Using last known data.`,
    };
  }

  if (anyStale || (hasFailedJobs && failedJobs >= 3)) {
    const staleNames = sources.filter(s => s.status === "stale").map(s => s.label).join(", ");
    return {
      status:  "degraded",
      summary: staleNames
        ? `System degraded — ${staleNames} sync is stale. Using last known data.`
        : `System degraded — ${failedJobs} sync jobs failed in the last 24 hours.`,
    };
  }

  if (anyDelayed || hasFailedJobs) {
    const delayedNames = sources.filter(s => s.status === "delayed").map(s => s.label).join(", ");
    return {
      status:  "degraded",
      summary: delayedNames
        ? `Some sources delayed — ${delayedNames} sync is behind schedule.`
        : `${failedJobs} sync job failure detected — monitoring.`,
    };
  }

  return {
    status:  "healthy",
    summary: "Core data current — all systems operating normally.",
  };
}

// ── Checklist builder ─────────────────────────────────────────────────────────

function buildChecklist(
  dataSources: DataSourceHealth[],
  overallStatus: OverallStatus,
  failedJobs24h: number,
): ChecklistItem[] {
  const coreSourcesFresh = dataSources
    .filter(s => ["sales", "labour"].includes(s.key))
    .every(s => ["live", "fresh"].includes(s.status));

  const noCriticalGaps = dataSources
    .filter(s => ["sales", "labour", "inventory"].includes(s.key))
    .every(s => s.status !== "missing");

  return [
    {
      id:       "system_healthy",
      label:    "System healthy",
      auto:     true,
      checked:  overallStatus === "healthy",
      category: "system",
    },
    {
      id:       "data_synced",
      label:    "Core data synced within 30 min",
      auto:     true,
      checked:  coreSourcesFresh,
      category: "data",
    },
    {
      id:       "no_critical_gaps",
      label:    "No critical data gaps",
      auto:     true,
      checked:  noCriticalGaps,
      category: "data",
    },
    {
      id:       "no_failed_jobs",
      label:    "No failed sync jobs in last 24h",
      auto:     true,
      checked:  failedJobs24h === 0,
      category: "system",
    },
    {
      id:       "gm_actions_reviewed",
      label:    "GM priority actions reviewed",
      auto:     false,
      checked:  false,
      category: "ops",
    },
    {
      id:       "daily_ops_completed",
      label:    "Daily ops checklist completed",
      auto:     false,
      checked:  false,
      category: "ops",
    },
    {
      id:       "no_overdue_tasks",
      label:    "No overdue tasks",
      auto:     false,
      checked:  false,
      category: "ops",
    },
    {
      id:       "reports_generated",
      label:    "Daily reports generated",
      auto:     false,
      checked:  false,
      category: "reports",
    },
  ];
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function getSystemHealth(siteId: string): Promise<SystemHealthPayload> {
  const supabase   = createServerClient() as any;
  const now        = new Date();
  const oneDayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const checkedAt  = now.toISOString();

  // ── Run all queries in parallel ────────────────────────────────────────────
  const [
    syncJobsRes,
    syncSchedulesRes,
    microsRes,
    revenueRes,
    labourRes,
    inventoryRes,
    reviewsRes,
    dailyOpsRes,
    complianceRes,
    maintenanceRes,
    incidentsRes,
    criticalActionsRes,
  ] = await Promise.allSettled([
    supabase
      .from("sync_jobs")
      .select("id, job_type, status, created_at, updated_at, attempt_count, error_message")
      .eq("site_id", siteId)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(200),

    supabase
      .from("sync_schedules")
      .select("job_type, next_run_at, last_run_at, is_paused")
      .eq("site_id", siteId),

    supabase
      .from("micros_connections")
      .select("id, loc_ref, base_url, last_error, last_synced_at, updated_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("revenue_records")
      .select("created_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("labour_records")
      .select("created_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("inventory_items")
      .select("updated_at")
      .eq("site_id", siteId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("guest_reviews")
      .select("created_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("daily_tasks")
      .select("updated_at")
      .eq("site_id", siteId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("compliance_items")
      .select("updated_at")
      .eq("site_id", siteId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("maintenance_logs")
      .select("created_at")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("system_incidents")
      .select("id, source, severity, summary, status, created_at, resolved_at, acknowledged_at, assigned_to, escalation_level, updated_at")
      .or(`site_id.eq.${siteId},site_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(20),

    // Count open priority-1 actions
    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId)
      .eq("status", "open"),
  ]);

  // ── Extract sync jobs ──────────────────────────────────────────────────────
  const syncJobs: any[] =
    syncJobsRes.status === "fulfilled" ? (syncJobsRes.value?.data ?? []) : [];
  const syncSchedules: any[] =
    syncSchedulesRes.status === "fulfilled" ? (syncSchedulesRes.value?.data ?? []) : [];

  const failedJobs24h = syncJobs.filter(
    j => j.status === "failed" || j.status === "dead_letter",
  ).length;

  const deadLetterJobs = syncJobs.filter(j => j.status === "dead_letter").length;

  const lastFailedJob = syncJobs.find(
    j => j.status === "failed" || j.status === "dead_letter",
  );

  // ── MICROS health ──────────────────────────────────────────────────────────
  const microsRow = microsRes.status === "fulfilled" ? microsRes.value?.data : null;

  const lastSalesSyncJob  = syncJobs.find(j => j.job_type === "sales_sync"  && j.status === "success");
  const lastLabourSyncJob = syncJobs.find(j => j.job_type === "labour_sync" && j.status === "success");
  const lastInvSyncJob    = syncJobs.find(j => j.job_type === "inventory_sync" && j.status === "success");

  const micros: MicrosHealth = {
    connected:        !!microsRow,
    connectionId:     microsRow?.id ?? null,
    locationRef:      microsRow?.loc_ref ?? null,
    serverUrl:        microsRow?.base_url ?? null,
    lastSalesSync:    lastSalesSyncJob?.updated_at ?? microsRow?.last_synced_at ?? null,
    lastLabourSync:   lastLabourSyncJob?.updated_at ?? null,
    lastInventorySync: lastInvSyncJob?.updated_at ?? null,
    lastError:        microsRow?.last_error ?? lastFailedJob?.error_message ?? null,
  };

  // ── Data source helper ─────────────────────────────────────────────────────
  function ageMinutes(
    res: PromiseSettledResult<any>,
    field: string,
  ): number | null {
    if (res.status === "rejected") return null;
    const row = res.value?.data;
    if (!row) return null;
    const ts = row[field];
    if (!ts) return null;
    return (now.getTime() - new Date(ts).getTime()) / 60_000;
  }

  const sourceInputs = [
    { key: "sales",       label: "Sales",       result: revenueRes,     field: "created_at" },
    { key: "labour",      label: "Labour",      result: labourRes,      field: "created_at" },
    { key: "inventory",   label: "Inventory",   result: inventoryRes,   field: "updated_at" },
    { key: "reviews",     label: "Reviews",     result: reviewsRes,     field: "created_at" },
    { key: "daily_ops",   label: "Daily Ops",   result: dailyOpsRes,    field: "updated_at" },
    { key: "compliance",  label: "Compliance",  result: complianceRes,  field: "updated_at" },
    { key: "maintenance", label: "Maintenance", result: maintenanceRes, field: "created_at" },
  ] as const;

  const dataSources: DataSourceHealth[] = sourceInputs.map(({ key, label, result, field }) => {
    const age    = ageMinutes(result as PromiseSettledResult<any>, field);
    const status = dataSourceStatus(key, age);
    const lastTs =
      (result as PromiseSettledResult<any>).status === "fulfilled"
        ? ((result as any).value?.data?.[field] ?? null)
        : null;
    return {
      key,
      label,
      status,
      lastSuccess:    lastTs,
      lastAttempt:    lastTs,
      dataAgeMinutes: age !== null ? Math.round(age) : null,
      trust:          trustFromStatus(status),
      action:         actionFromStatus(key, status),
    };
  });

  // ── Last successful sync across all sources ────────────────────────────────
  const freshTimestamps = dataSources
    .map(s => s.lastSuccess)
    .filter(Boolean) as string[];
  const lastSuccessfulSync =
    freshTimestamps.length > 0
      ? freshTimestamps.sort().reverse()[0]
      : null;

  // ── Jobs health ────────────────────────────────────────────────────────────
  const scheduleMap = new Map(syncSchedules.map(s => [s.job_type, s]));

  const jobs: JobHealth[] = JOB_DEFINITIONS.map(def => {
    const recent = syncJobs.filter(j => j.job_type === def.jobType);
    const last   = recent[0] ?? null;
    const schedule = scheduleMap.get(def.jobType);
    const failures = recent.filter(j => j.status === "failed" || j.status === "dead_letter").length;

    return {
      id:           last?.id ?? def.jobType,
      label:        def.label,
      jobType:      def.jobType,
      lastRun:      last?.updated_at ?? schedule?.last_run_at ?? null,
      nextRun:      schedule?.next_run_at ?? null,
      status:       jobStatusFromRow(last),
      failureCount: failures,
      attemptCount: last?.attempt_count ?? 0,
      canRunNow:    def.canRunNow,
    };
  });

  // ── Error health ───────────────────────────────────────────────────────────
  const errors: ErrorHealth = {
    sentryConfigured: !!(
      process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
    ),
    syncFailures24h:  failedJobs24h,
    deadLetterJobs,
    lastException:    lastFailedJob?.error_message ?? null,
  };

  // ── Open critical actions ──────────────────────────────────────────────────
  const openCriticalActions: number =
    criticalActionsRes.status === "fulfilled"
      ? (criticalActionsRes.value?.count ?? 0)
      : 0;

  // ── Incidents ──────────────────────────────────────────────────────────────
  const incidentRows: any[] =
    incidentsRes.status === "fulfilled" ? (incidentsRes.value?.data ?? []) : [];

  const incidents: SystemIncident[] = incidentRows.map(row => ({
    id:              row.id,
    source:          row.source,
    severity:        row.severity,
    summary:         row.summary,
    status:          row.status,
    createdAt:       row.created_at,
    resolvedAt:      row.resolved_at      ?? null,
    acknowledgedAt:  row.acknowledged_at  ?? null,
    assignedTo:      row.assigned_to      ?? null,
    escalationLevel: row.escalation_level ?? "normal",
    updatedAt:       row.updated_at       ?? null,
  }));

  // ── DB schema health: verify required migrations ────────────────────────────
  // Probe for columns added in recent migrations. Any missing column indicates
  // the migration has not been applied and syncs will fail with schema errors.
  try {
    const { error: schemaErr } = await supabase
      .from("micros_connections")
      .select("sales_location_ref")
      .limit(0);

    if (schemaErr?.message?.includes("sales_location_ref")) {
      // Migration 092 not applied — inject a critical synthetic incident so
      // it surfaces in the System Health console rather than failing silently.
      incidents.unshift({
        id:              "schema-micros-sales-location-ref-missing",
        source:          "schema_check",
        severity:        "critical",
        summary:
          "DB migration 092 not applied — micros_connections.sales_location_ref column missing. " +
          "Both sales and labour sync will fail until this migration is deployed. " +
          "Run: bash scripts/deploy_migration.sh supabase/migrations/092_micros_sales_location_ref.sql",
        status:          "open",
        createdAt:       checkedAt,
        resolvedAt:      null,
        escalationLevel: "urgent",
      });
      logger.error("[system-health] Migration 092 not applied — sales_location_ref column missing", {
        siteId, dbError: schemaErr.message,
      });
    }
  } catch {
    // Non-fatal — schema probe should never crash the health endpoint
  }

  // ── Overall status ─────────────────────────────────────────────────────────
  const { status: overallStatus, summary } = calculateOverallStatus(dataSources, failedJobs24h);

  // ── Freshness score ────────────────────────────────────────────────────────
  const dataFreshnessScore = calculateFreshnessScore(dataSources);

  // ── Checklist ──────────────────────────────────────────────────────────────
  const checklist = buildChecklist(dataSources, overallStatus, failedJobs24h);

  logger.info("system.health.computed", {
    siteId,
    overallStatus,
    dataFreshnessScore,
    failedJobs24h,
    dataSources: dataSources.map(s => `${s.key}:${s.status}`).join(","),
  });

  return {
    overallStatus,
    summary,
    lastSuccessfulSync,
    failedJobs24h,
    openCriticalActions,
    dataFreshnessScore,
    dataSources,
    micros,
    jobs,
    errors,
    checklist,
    incidents,
    checkedAt,
  };
}
