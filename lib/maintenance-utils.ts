/**
 * Maintenance Intelligence Utilities
 *
 * Pure functions for analytics, MTTR, impact analysis, and
 * contractor/asset performance. No database calls — operate
 * on MaintenanceLog[] arrays fetched by the service layer.
 *
 * These are the building blocks for future predictive maintenance,
 * contractor scorecards, and replacement recommendations.
 */

import type { MaintenanceLog } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum days before an open issue is considered overdue, by priority */
const PRIORITY_SLA_DAYS: Record<string, number> = {
  urgent: 0.25,  // 6 hours
  high:   1,
  medium: 3,
  low:    7,
};

const OPEN_STATUSES = new Set(["open", "in_progress", "awaiting_parts"]);
const RESOLVED_STATUSES = new Set(["resolved", "closed"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Canonical fix date: prefers date_fixed, falls back to date_resolved */
function resolvedDate(log: MaintenanceLog): string | null {
  return log.date_fixed ?? log.date_resolved ?? null;
}

// ── Repair Duration ───────────────────────────────────────────────────────────

export interface RepairDurationResult {
  hours: number;
  days: number;
  /** Human-readable label e.g. "6.5h" or "2.1 days" */
  label: string;
}

export function calcRepairDuration(
  dateReported: string,
  dateFixed: string
): RepairDurationResult {
  const start = new Date(dateReported + "T12:00:00Z").getTime();
  const end   = new Date(dateFixed   + "T12:00:00Z").getTime();
  const ms    = Math.max(0, end - start);
  const hours = ms / 3_600_000;
  const days  = hours / 24;
  const label =
    hours < 1    ? "< 1h"                     :
    hours < 24   ? `${hours.toFixed(1)}h`     :
    `${days.toFixed(1)} day${days >= 2 ? "s" : ""}`;
  return { hours, days, label };
}

// ── MTTR ──────────────────────────────────────────────────────────────────────

/**
 * Mean Time To Repair across all resolved issues with a fix date.
 * Returns days (decimal), or null if no data.
 */
export function calcMTTR(logs: MaintenanceLog[]): number | null {
  const resolved = logs.filter((l) => {
    const fixed = resolvedDate(l);
    return fixed != null && RESOLVED_STATUSES.has(l.repair_status);
  });
  if (resolved.length === 0) return null;

  const durationDays = resolved
    .map((l) => calcRepairDuration(l.date_reported, resolvedDate(l)!).days)
    .filter((d) => d >= 0);

  return durationDays.length > 0
    ? durationDays.reduce((s, d) => s + d, 0) / durationDays.length
    : null;
}

// ── Open Issues by Priority ───────────────────────────────────────────────────

export interface OpenByPriority {
  urgent: number;
  high:   number;
  medium: number;
  low:    number;
  total:  number;
}

export function getOpenByPriority(logs: MaintenanceLog[]): OpenByPriority {
  const open = logs.filter((l) => OPEN_STATUSES.has(l.repair_status));
  const urgent = open.filter((l) => l.priority === "urgent").length;
  const high   = open.filter((l) => l.priority === "high").length;
  const medium = open.filter((l) => l.priority === "medium").length;
  const low    = open.filter((l) => l.priority === "low").length;
  return { urgent, high, medium, low, total: urgent + high + medium + low };
}

// ── Overdue Issues ────────────────────────────────────────────────────────────

/**
 * Returns open issues that have exceeded their SLA window.
 * Sorted: most overdue first.
 */
export function getOverdueIssues(logs: MaintenanceLog[]): MaintenanceLog[] {
  const now = Date.now();
  return logs
    .filter((l) => {
      if (!OPEN_STATUSES.has(l.repair_status)) return false;
      const sla    = PRIORITY_SLA_DAYS[l.priority] ?? 3;
      const ageDays =
        (now - new Date(l.date_reported + "T12:00:00Z").getTime()) / 86_400_000;
      return ageDays > sla;
    })
    .sort((a, b) => a.date_reported.localeCompare(b.date_reported)); // oldest first
}

// ── Top Failing Assets ────────────────────────────────────────────────────────

export interface AssetFailureRecord {
  asset_name:   string;
  equipment_id: string | null;
  count:        number;
  latestDate:   string;
  hasOpenIssue: boolean;
  isRecurring:  boolean; // 3+ issues in window
}

export function getTopFailingAssets(
  logs: MaintenanceLog[],
  days = 90
): AssetFailureRecord[] {
  const cutoff = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recent = logs.filter((l) => l.date_reported >= cutoff);

  const map = new Map<string, AssetFailureRecord>();
  for (const l of recent) {
    const key = l.equipment_id ?? l.unit_name;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (l.date_reported > existing.latestDate)
        existing.latestDate = l.date_reported;
      if (OPEN_STATUSES.has(l.repair_status)) existing.hasOpenIssue = true;
    } else {
      map.set(key, {
        asset_name:   l.unit_name,
        equipment_id: l.equipment_id,
        count:        1,
        latestDate:   l.date_reported,
        hasOpenIssue: OPEN_STATUSES.has(l.repair_status),
        isRecurring:  false,
      });
    }
  }

  const results = Array.from(map.values());
  for (const r of results) r.isRecurring = r.count >= 3;
  return results.sort((a, b) => b.count - a.count);
}

// ── Contractor Performance ────────────────────────────────────────────────────

export interface ContractorPerformance {
  name:           string;
  issuesHandled:  number;
  avgFixTimeDays: number | null;
  avgCost:        number | null;
  totalCost:      number;
}

export function getContractorPerformance(
  logs: MaintenanceLog[]
): ContractorPerformance[] {
  const map = new Map<
    string,
    { durations: number[]; costs: number[]; count: number }
  >();

  for (const l of logs) {
    // Prefer contractor_name; fall back to fixed_by if fixed_by_type === contractor
    const name =
      l.contractor_name ??
      (l.fixed_by_type === "contractor" ? l.fixed_by : null);
    if (!name?.trim()) continue;

    const fixed = resolvedDate(l);
    const entry = map.get(name) ?? { durations: [], costs: [], count: 0 };
    entry.count++;
    if (fixed) {
      entry.durations.push(
        calcRepairDuration(l.date_reported, fixed).days
      );
    }
    if (l.actual_cost != null && l.actual_cost > 0) {
      entry.costs.push(l.actual_cost);
    }
    map.set(name, entry);
  }

  return Array.from(map.entries())
    .map(([name, d]) => ({
      name,
      issuesHandled:  d.count,
      avgFixTimeDays:
        d.durations.length > 0
          ? d.durations.reduce((s, v) => s + v, 0) / d.durations.length
          : null,
      avgCost:
        d.costs.length > 0
          ? d.costs.reduce((s, v) => s + v, 0) / d.costs.length
          : null,
      totalCost: d.costs.reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.issuesHandled - a.issuesHandled);
}

// ── Business Impact ───────────────────────────────────────────────────────────

export interface BusinessImpactSummary {
  foodSafetyRisks:     number;
  serviceDisruptions:  number;
  revenueImpacts:      number;
  complianceRisks:     number;
  openFoodSafetyIssues: MaintenanceLog[];
}

export function getBusinessImpactSummary(
  logs: MaintenanceLog[]
): BusinessImpactSummary {
  const open = logs.filter((l) => OPEN_STATUSES.has(l.repair_status));
  return {
    foodSafetyRisks:
      open.filter((l) => l.impact_level === "food_safety_risk").length,
    serviceDisruptions:
      open.filter((l) => l.impact_level === "service_disruption").length,
    revenueImpacts:
      open.filter((l) => l.impact_level === "revenue_loss").length,
    complianceRisks:
      open.filter((l) => l.impact_level === "compliance_risk").length,
    openFoodSafetyIssues:
      open.filter((l) => l.impact_level === "food_safety_risk"),
  };
}

// ── Maintenance Costs ─────────────────────────────────────────────────────────

export interface MaintenanceCosts {
  thisMonth:    number;
  thisQuarter:  number;
  total:        number;
}

export function getMonthlyCosts(logs: MaintenanceLog[]): MaintenanceCosts {
  const now          = new Date();
  const monthStart   = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  const quarterStart = new Date(now.getFullYear(), quarterMonth, 1)
    .toISOString()
    .slice(0, 10);

  let thisMonth = 0, thisQuarter = 0, total = 0;
  for (const l of logs) {
    const cost = l.actual_cost ?? 0;
    if (cost <= 0) continue;
    const d = resolvedDate(l) ?? l.date_reported;
    total        += cost;
    if (d >= quarterStart) thisQuarter += cost;
    if (d >= monthStart)   thisMonth   += cost;
  }
  return { thisMonth, thisQuarter, total };
}

// ── Repeat Issue Detection ────────────────────────────────────────────────────

/**
 * Returns asset names that have had `threshold` or more issues
 * in the past `withinDays` days — candidates for preventive
 * service or replacement.
 */
export function detectRepeatAssets(
  logs: MaintenanceLog[],
  withinDays = 45,
  threshold  = 2
): string[] {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recent = logs.filter((l) => l.date_reported >= cutoff);

  const counts = new Map<string, number>();
  for (const l of recent) {
    const key = l.equipment_id ?? l.unit_name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const repeatKeys = new Set(
    Array.from(counts.entries())
      .filter(([, n]) => n >= threshold)
      .map(([k]) => k)
  );

  const names = new Set<string>();
  for (const l of recent) {
    if (repeatKeys.has(l.equipment_id ?? l.unit_name)) names.add(l.unit_name);
  }
  return Array.from(names);
}

// ── Age Formatting ────────────────────────────────────────────────────────────

export function formatIssueAge(dateReported: string): string {
  const ageDays =
    (Date.now() - new Date(dateReported + "T12:00:00Z").getTime()) /
    86_400_000;
  if (ageDays < 0.042) return "Reported just now";
  if (ageDays < 1) {
    const h = Math.round(ageDays * 24);
    return `Reported ${h}h ago`;
  }
  const d = Math.round(ageDays);
  return `Reported ${d} day${d !== 1 ? "s" : ""} ago`;
}

// ── Impact Label Helpers ──────────────────────────────────────────────────────

export const IMPACT_LABELS: Record<string, string> = {
  none:                "No operational impact",
  minor:               "Minor impact",
  service_disruption:  "Service disruption",
  revenue_loss:        "Revenue loss",
  compliance_risk:     "Compliance risk",
  food_safety_risk:    "Food safety risk",
};

export const IMPACT_SEVERITY: Record<string, "critical" | "high" | "medium" | "low"> = {
  food_safety_risk:   "critical",
  compliance_risk:    "high",
  service_disruption: "high",
  revenue_loss:       "medium",
  minor:              "low",
  none:               "low",
};
