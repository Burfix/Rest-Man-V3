/**
 * Cross-Module Intelligence — Context Builder
 *
 * Fetches and normalises data from all live modules into a single
 * OperationsContext object. Used by the signal detector and the
 * /api/intelligence/cross-module route.
 *
 * Uses canonical tables only (revenue_records, labour_records,
 * maintenance_logs, compliance_items, actions).
 */

import { createServerClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RevenueContext = {
  actual: number;
  target: number;
  variance: number;        // % behind (negative) / ahead (positive)
  trend: "recovering" | "declining" | "stable";
  /** false = this site has no POS/MICROS connection — show "Not connected" in UI */
  connected: boolean;
};

export type LabourContext = {
  actualPercent: number;
  targetPercent: number;
  variance: number;        // % over target (positive = over)
  staffOnFloor: number;
  note: string | null;
  /** false = this site has no POS/MICROS connection — show "Not connected" in UI */
  connected: boolean;
};

export type DailyOpsContext = {
  totalTasks: number;
  completed: number;
  overdue: number;
  blocked: number;
  completionRate: number;  // 0–100
};

export type MaintenanceContext = {
  openCount: number;
  urgentCount: number;      // priority = urgent | high | critical
  highCount: number;        // priority = high (only)
  mediumCount: number;      // priority = medium (only)
  serviceBlocking: boolean; // any open item with service_blocking = true
  oldestOpenDays: number;   // age of oldest open issue in days (0 if none)
};

export type ComplianceContext = {
  overdueCount: number;
  atRiskCount: number;     // due_soon
};

export type MetaContext = {
  timeOfDay: "pre-service" | "service" | "post-service" | "closed";
  sessionPressure: "low" | "medium" | "high" | "critical";
};

export type OperationsContext = {
  revenue:     RevenueContext;
  labour:      LabourContext;
  dailyOps:    DailyOpsContext;
  maintenance: MaintenanceContext;
  compliance:  ComplianceContext;
  meta:        MetaContext;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTimeOfDay(hourInJohannesburg: number): MetaContext["timeOfDay"] {
  // Restaurant opens at 10:00 — treat 10:00 onwards as service (not 11:00).
  // Pre-service = 06:00–09:59 (prep window before doors open).
  if (hourInJohannesburg >= 6  && hourInJohannesburg < 10) return "pre-service";
  if (hourInJohannesburg >= 10 && hourInJohannesburg < 23) return "service";
  if (hourInJohannesburg >= 23) return "post-service";
  return "closed";
}

function computeSessionPressure(
  timeOfDay: MetaContext["timeOfDay"],
  revenueVariance: number,
  overdueOps: number,
  urgentMaintenance: number,
): MetaContext["sessionPressure"] {
  if (timeOfDay === "closed") return "low";
  const behind = -revenueVariance; // positive = behind
  if (behind > 20 || overdueOps > 4 || urgentMaintenance >= 3) return "critical";
  if (behind > 10 || overdueOps > 2 || urgentMaintenance >= 2) return "high";
  if (behind > 5  || overdueOps > 0 || urgentMaintenance >= 1) return "medium";
  return "low";
}

// ── Main builder ──────────────────────────────────────────────────────────────

export async function buildOperationsContext(
  siteId: string,
  date: string,  // ISO date: "YYYY-MM-DD"
): Promise<OperationsContext> {
  const supabase = createServerClient();
  const now = Date.now();

  // ── Step 1: Resolve MICROS connection ID (site-specific) ──────────────────
  // micros_connections.site_id links a connection to a site.
  // Sites with no connection (e.g. Primi Camps Bay) must not inherit another
  // site's MICROS data — they should show "Not connected" for all POS-derived fields.
  //
  // We ALSO read sites.micros_location_ref as the authoritative source of truth for
  // whether a site is POS-connected.  The micros_connections query can return null
  // due to RLS policies even when a connection exists; the sites column is always
  // readable and is set explicitly for every connected site.
  const [connRes, siteConnRes] = await Promise.all([
    (supabase as any)
      .from("micros_connections")
      .select("id, loc_ref")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    (supabase as any)
      .from("sites")
      .select("micros_location_ref")
      .eq("id", siteId)
      .maybeSingle(),
  ]);
  const microsConnectionId = (connRes.data as { id: string } | null)?.id ?? null;
  const microsLocRef = (connRes.data as { id: string; loc_ref?: string | null } | null)?.loc_ref ?? null;
  /** loc_ref from the sites table — authoritative fallback when micros_connections is unavailable */
  const siteLocRef = (siteConnRes.data as { micros_location_ref?: string | null } | null)?.micros_location_ref ?? null;
  /** Effective loc_ref: prefer connection table (live), fall back to sites column (configured) */
  const effectiveLocRef = microsLocRef ?? siteLocRef;
  /** True when this site has a configured POS/MICROS loc_ref — based on sites table, not connection query */
  const posConnected = effectiveLocRef !== null && effectiveLocRef !== "";

  // ── Step 2: Parallel fetch everything ──────────────────────────────────────
  const [revRes, manualRes, microsRes, snapRes, labSummaryRes, labFallbackRes, siteRes, actRes, maintRes, compRes] =
    await Promise.all([
      // Revenue records (tertiary fallback)
      supabase
        .from("revenue_records")
        .select("net_vat_excl, net_sales")
        .eq("site_id", siteId)
        .eq("service_date", date),

      // Manual sales upload (secondary fallback)
      (supabase as any)
        .from("manual_sales_uploads")
        .select("net_sales, gross_sales")
        .eq("site_id", siteId)
        .eq("business_date", date)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // MICROS daily sales (primary — same source as Business Status panel)
      microsConnectionId
        ? (supabase as any)
            .from("micros_sales_daily")
            .select("net_sales, gross_sales")
            .eq("connection_id", microsConnectionId)
            .eq("business_date", date)
            .maybeSingle()
        : Promise.resolve({ data: null }),

      // Target from snapshot
      supabase
        .from("store_snapshots")
        .select("revenue_target")
        .eq("site_id", siteId)
        .lte("snapshot_date", date)
        .order("snapshot_date", { ascending: false })
        .limit(1),

      // Labour (primary): MICROS labour_daily_summary
      // Uses effectiveLocRef (sites.micros_location_ref as fallback) so the query
      // succeeds even when micros_connections returns null for the session.
      effectiveLocRef
        ? (supabase as any)
            .from("labour_daily_summary")
            .select("total_pay, labour_pct, net_sales")
            .eq("loc_ref", effectiveLocRef)
            .eq("business_date", date)
            .maybeSingle()
        : Promise.resolve({ data: null }),

      // Labour (fallback): canonical labour_records
      supabase
        .from("labour_records")
        .select("labour_cost")
        .eq("site_id", siteId)
        .eq("service_date", date),

      // Site config for target labour %
      supabase
        .from("sites")
        .select("target_labour_pct")
        .eq("id", siteId)
        .single(),

      // Daily ops tasks — today's tasks only (matches PriorityActionBoard / dutiesData source)
      (supabase as any)
        .from("daily_ops_tasks")
        .select("id, status, due_time")
        .eq("site_id", siteId)
        .eq("task_date", date),

      // Maintenance — open issues
      supabase
        .from("maintenance_logs")
        .select("id, priority, impact_level, service_blocking, date_reported")
        .eq("site_id", siteId)
        .in("repair_status", ["open", "in_progress", "awaiting_parts"]),

      // Compliance — no site_id or is_active columns on this table (single-tenant)
      // Status column is stale for date-based items; use date comparison as canonical source of truth.
      // However, fall back to stored status (case-insensitive) for items where next_due_date is null.
      supabase
        .from("compliance_items")
        .select("id, next_due_date, status")
    ]);

  // ── Revenue ────────────────────────────────────────────────────────────────
  const revRows   = (revRes.data  ?? []) as { net_vat_excl: number | null; net_sales: number | null }[];
  const snapRows  = (snapRes.data ?? []) as { revenue_target: number | null }[];
  const manualRow = manualRes.data as { net_sales: number | null; gross_sales: number | null } | null;
  const microsRow = microsRes.data as { net_sales: number | null; gross_sales: number | null } | null;

  // Priority: MICROS live daily → manual upload → revenue_records
  // (Identical resolution order to Business Status panel / getCurrentSalesSnapshot)
  let actual: number;
  let revenueSource: string;
  if (microsRow && (microsRow.net_sales ?? 0) > 0) {
    actual = microsRow.net_sales!;
    revenueSource = `micros_sales_daily net_sales (conn ${microsConnectionId})`;
  } else if (manualRow && (manualRow.net_sales ?? manualRow.gross_sales ?? 0) > 0) {
    actual = manualRow.net_sales ?? manualRow.gross_sales ?? 0;
    revenueSource = "manual_sales_uploads";
  } else {
    actual = revRows.reduce((s, r) => s + (r.net_vat_excl ?? r.net_sales ?? 0), 0);
    revenueSource = `revenue_records (${revRows.length} rows)`;
  }

  console.log(`[ContextBuilder] Revenue source: R${Math.round(actual)} from ${revenueSource} | date=${date} | site=${siteId}`);
  const target     = snapRows[0]?.revenue_target ? Number(snapRows[0].revenue_target) : 0;
  const variance   = target > 0 ? +((actual - target) / target * 100).toFixed(1) : 0;
  const trend: RevenueContext["trend"] =
    variance > 2 ? "recovering" : variance < -5 ? "declining" : "stable";

  // ── Labour ─────────────────────────────────────────────────────────────────
  const labSummary      = (labSummaryRes.data ?? null) as {
    total_pay: number | null;
    labour_pct: number | null;
    net_sales: number | null;
  } | null;
  const labRows         = (labFallbackRes.data ?? []) as { labour_cost: number | null }[];
  const targetLabourPct = ((siteRes.data as any)?.target_labour_pct as number | null) ?? 15;
  const fallbackLabourCost = labRows.reduce((s, r) => s + (r.labour_cost ?? 0), 0);
  const labourCost      = labSummary?.total_pay != null ? Number(labSummary.total_pay) : fallbackLabourCost;
  const actualPercent   = labSummary?.labour_pct != null
    ? +Number(labSummary.labour_pct).toFixed(1)
    : actual > 0 ? +(labourCost / actual * 100).toFixed(1) : 0;
  const labourVariance  = +(actualPercent - targetLabourPct).toFixed(1);
  const labourNote = actual < 5000
    ? "Labour % unreliable — insufficient revenue data"
    : null;
  console.log("Labour:", {
    actual: actualPercent,
    target: targetLabourPct,
    variance: labourVariance,
    labourCost,
    revenue: actual,
    source: labSummary?.labour_pct != null ? "labour_daily_summary.labour_pct" : "derived_from_cost",
    note: labourNote,
  });

  // ── Daily ops (daily_ops_tasks — today only) ───────────────────────────────
  const taskRows       = (actRes.data ?? []) as { id: string; status: string; due_time: string | null }[];
  const totalTasks     = taskRows.length;
  const completed      = taskRows.filter((t) => t.status === "completed").length;
  const blocked        = taskRows.filter((t) => t.status === "blocked").length;
  // Overdue: not_started tasks that have a due_time set (approximate — used for session pressure only)
  const overdue        = taskRows.filter(
    (t) => t.status === "not_started" && t.due_time !== null
  ).length;
  const completionRate = totalTasks > 0 ? Math.round(completed / totalTasks * 100) : 0;

  // ── Maintenance ────────────────────────────────────────────────────────────
  const maintRows     = ((maintRes.data ?? []) as unknown) as { id: string; priority: string; impact_level: string | null; service_blocking: boolean | null; date_reported: string | null }[];
  const urgentCount   = maintRows.filter(
    (m) => m.priority === "urgent" || m.priority === "high" || m.priority === "critical"
  ).length;
  const highCount     = maintRows.filter((m) => m.priority === "high").length;
  const mediumCount   = maintRows.filter((m) => m.priority === "medium").length;
  const serviceBlocking = maintRows.some(
    (m) => m.service_blocking === true || m.impact_level === "service_disruption" || m.impact_level === "service_blocking"
  );

  // Oldest open issue age in days (for SLA deduction)
  let oldestOpenDays = 0;
  if (maintRows.length > 0) {
    const nowMs = Date.now();
    for (const m of maintRows) {
      if (m.date_reported) {
        const ageDays = (nowMs - new Date(m.date_reported).getTime()) / 86_400_000;
        if (ageDays > oldestOpenDays) oldestOpenDays = ageDays;
      }
    }
    oldestOpenDays = Math.floor(oldestOpenDays);
  }

  // ── Compliance ─────────────────────────────────────────────────────────────
  // Always fetched live from compliance_items in this request (no extra caching here).
  // DB status column can be stale, so date rules are canonical.
  const compRows      = (compRes.data ?? []) as { id: string; next_due_date: string | null; status?: string | null }[];
  console.log(`[ContextBuilder] Compliance rows (${compRows.length}): ${compRows.map((c) => `${c.id.slice(0,8)} due=${c.next_due_date} status=${c.status}`).join(", ")}`);
  // Expired: past due date OR stored status indicates expiry (case-insensitive, for items with null dates)
  const EXPIRED_STATUSES = new Set(["expired", "overdue", "due_today"]);
  const overdueCount  = compRows.filter((c) => {
    if (c.next_due_date != null && c.next_due_date < date) return true;
    if (c.next_due_date == null && c.status && EXPIRED_STATUSES.has(c.status.toLowerCase())) return true;
    return false;
  }).length;
  const atRiskCutoff  = new Date(now + 7 * 86_400_000).toISOString().slice(0, 10);
  // At risk: due within 7 days (but not already expired)
  const atRiskCount   = compRows.filter((c) => {
    if (c.next_due_date != null && c.next_due_date >= date && c.next_due_date <= atRiskCutoff) return true;
    if (c.next_due_date == null && c.status && c.status.toLowerCase() === "due_today") return true;
    return false;
  }).length;

  // ── Meta ───────────────────────────────────────────────────────────────────
  const saTime    = new Date().toLocaleString("en-US", {
    timeZone: "Africa/Johannesburg",
    hour: "numeric",
    hour12: false,
  });
  const hour      = parseInt(saTime, 10);
  const timeOfDay = getTimeOfDay(hour);
  const sessionPressure = computeSessionPressure(timeOfDay, variance, overdue, urgentCount);

  return {
    revenue:     { actual, target, variance, trend, connected: posConnected },
    labour:      { actualPercent, targetPercent: targetLabourPct, variance: labourVariance, staffOnFloor: 0, note: labourNote, connected: posConnected },
    dailyOps:    { totalTasks, completed, overdue, blocked, completionRate },
    maintenance: { openCount: maintRows.length, urgentCount, highCount, mediumCount, serviceBlocking, oldestOpenDays },
    compliance:  { overdueCount, atRiskCount },
    meta:        { timeOfDay, sessionPressure },
  };
}
