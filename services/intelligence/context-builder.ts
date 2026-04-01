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
};

export type LabourContext = {
  actualPercent: number;
  targetPercent: number;
  variance: number;        // % over target (positive = over)
  staffOnFloor: number;
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
  urgentCount: number;
  serviceBlocking: boolean;  // any open item with impact_level = service_disruption
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

  // ── Step 1: Resolve MICROS connection ID (needed for daily sales query) ──
  // micros_connections has no site_id FK — convention-based single-site lookup.
  const connRes = await (supabase as any)
    .from("micros_connections")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const microsConnectionId = (connRes.data as { id: string } | null)?.id ?? null;

  // ── Step 2: Parallel fetch everything ──────────────────────────────────────
  const [revRes, manualRes, microsRes, snapRes, labRes, siteRes, actRes, maintRes, compRes] =
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

      // Labour
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
        .select("id, priority, impact_level")
        .eq("site_id", siteId)
        .in("repair_status", ["open", "in_progress", "awaiting_parts"]),

      // Compliance — no site_id or is_active columns on this table (single-tenant)
      // Status column is stale; use date comparison as canonical source of truth
      supabase
        .from("compliance_items")
        .select("id, next_due_date")
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
  const labRows         = (labRes.data ?? []) as { labour_cost: number | null }[];
  const targetLabourPct = ((siteRes.data as any)?.target_labour_pct as number | null) ?? 30;
  const labourCost      = labRows.reduce((s, r) => s + (r.labour_cost ?? 0), 0);
  const actualPercent   = actual > 0 ? +(labourCost / actual * 100).toFixed(1) : 0;
  const labourVariance  = +(actualPercent - targetLabourPct).toFixed(1);

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
  const maintRows     = (maintRes.data ?? []) as { id: string; priority: string; impact_level: string | null }[];
  const urgentCount   = maintRows.filter(
    (m) => m.priority === "urgent" || m.priority === "high" || m.priority === "critical"
  ).length;
  const serviceBlocking = maintRows.some(
    (m) => m.impact_level === "service_disruption"
  );

  // ── Compliance ─────────────────────────────────────────────────────────────
  // DB status column is stale (not auto-updated on expiry). Derive purely from dates,
  // matching the same logic as computeComplianceStatus() in lib/compliance/scoring.ts.
  const compRows      = (compRes.data ?? []) as { id: string; next_due_date: string | null }[];
  console.log(`[ContextBuilder] Compliance rows (${compRows.length}): ${compRows.map((c) => `${c.id.slice(0,8)} due=${c.next_due_date}`).join(", ")}`);
  // Expired: past due OR due today (certificate no longer valid as of today)
  const overdueCount  = compRows.filter(
    (c) => c.next_due_date != null && c.next_due_date <= date
  ).length;
  const dueSoonCutoff = new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);
  // At risk: due within 30 days (but not already expired)
  const atRiskCount   = compRows.filter(
    (c) => c.next_due_date != null && c.next_due_date > date && c.next_due_date <= dueSoonCutoff
  ).length;

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
    revenue:     { actual, target, variance, trend },
    labour:      { actualPercent, targetPercent: targetLabourPct, variance: labourVariance, staffOnFloor: 0 },
    dailyOps:    { totalTasks, completed, overdue, blocked, completionRate },
    maintenance: { openCount: maintRows.length, urgentCount, serviceBlocking },
    compliance:  { overdueCount, atRiskCount },
    meta:        { timeOfDay, sessionPressure },
  };
}
