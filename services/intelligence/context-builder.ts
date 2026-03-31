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
import { forecastToday } from "@/services/forecasting/forecast-engine";
import type { ForecastResult } from "@/services/forecasting/forecast-engine";

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

export type { ForecastResult };

export type OperationsContext = {
  revenue:     RevenueContext;
  labour:      LabourContext;
  dailyOps:    DailyOpsContext;
  maintenance: MaintenanceContext;
  compliance:  ComplianceContext;
  meta:        MetaContext;
  forecast:    ForecastResult;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTimeOfDay(hourInJohannesburg: number): MetaContext["timeOfDay"] {
  if (hourInJohannesburg >= 6  && hourInJohannesburg < 11) return "pre-service";
  if (hourInJohannesburg >= 11 && hourInJohannesburg < 23) return "service";
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

  const [revRes, snapRes, labRes, siteRes, actRes, maintRes, compRes] =
    await Promise.all([
      // Revenue
      supabase
        .from("revenue_records")
        .select("net_vat_excl, net_sales")
        .eq("site_id", siteId)
        .eq("service_date", date),

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

      // Actions (daily ops proxy) — cast through any as Supabase types may lag schema
      (supabase as any)
        .from("actions")
        .select("id, status, due_at")
        .eq("site_id", siteId)
        .is("archived_at", null),

      // Maintenance — open issues
      supabase
        .from("maintenance_logs")
        .select("id, priority, impact_level")
        .eq("site_id", siteId)
        .in("repair_status", ["open", "in_progress", "awaiting_parts"]),

      // Compliance
      supabase
        .from("compliance_items")
        .select("id, status, next_due_date")
        .eq("site_id", siteId)
        .eq("is_active", true),
    ]);

  // ── Revenue ────────────────────────────────────────────────────────────────
  const revRows    = (revRes.data   ?? []) as { net_vat_excl: number | null; net_sales: number | null }[];
  const snapRows   = (snapRes.data  ?? []) as { revenue_target: number | null }[];
  const actual     = revRows.reduce((s, r) => s + (r.net_vat_excl ?? r.net_sales ?? 0), 0);
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

  // ── Daily ops (actions proxy) ───────────────────────────────────────────────
  const actionRows    = (actRes.data ?? []) as { id: string; status: string; due_at: string | null }[];
  const totalTasks    = actionRows.length;
  const completed     = actionRows.filter((a) => a.status === "completed").length;
  const blocked       = actionRows.filter((a) => a.status === "blocked").length;
  const overdue       = actionRows.filter(
    (a) => a.due_at && new Date(a.due_at).getTime() < now &&
      !["completed", "cancelled"].includes(a.status)
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
  const compRows      = (compRes.data ?? []) as { id: string; status: string; next_due_date: string | null }[];
  const overdueCount  = compRows.filter(
    (c) => c.status === "overdue" || c.status === "expired" ||
      (c.next_due_date && c.next_due_date < date)
  ).length;
  const dueSoonCutoff = new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);
  const atRiskCount   = compRows.filter(
    (c) => c.status === "due_soon" ||
      (c.next_due_date && c.next_due_date >= date && c.next_due_date <= dueSoonCutoff)
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

  // ── Forecast (pure computation from historical patterns) ───────────────────
  const serviceEndHour = 22; // 22:00 SAST
  const hoursRemaining = Math.max(0, serviceEndHour - hour);
  const forecast = forecastToday(date, actual, hoursRemaining, target > 0 ? target : undefined);

  return {
    revenue:     { actual, target, variance, trend },
    labour:      { actualPercent, targetPercent: targetLabourPct, variance: labourVariance, staffOnFloor: 0 },
    dailyOps:    { totalTasks, completed, overdue, blocked, completionRate },
    maintenance: { openCount: maintRows.length, urgentCount, serviceBlocking },
    compliance:  { overdueCount, atRiskCount },
    meta:        { timeOfDay, sessionPressure },
    forecast,
  };
}
