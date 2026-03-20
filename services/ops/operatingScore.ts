/**
 * Operating Score Engine
 *
 * getOperatingScore(locationId) → OperatingScore (0–100)
 *
 * Four weighted components:
 *   Revenue vs Target   40 pts
 *   Labour %            20 pts
 *   Compliance status   20 pts
 *   Maintenance status  20 pts
 *
 * All data is fetched live from the DB; results are suitable for
 * server-side rendering or caching by the caller.
 */

import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import { computeComplianceStatus } from "@/lib/compliance/scoring";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MaintenanceSeverity = "none" | "minor" | "critical";
export type ComplianceWorstStatus = "compliant" | "scheduled" | "due_soon" | "expired" | "unknown";
export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

export interface RevenueComponent {
  score:       number;          // 0 | 10 | 20 | 30 | 40
  max:         40;
  actual:      number | null;   // most recent day's net sales (ZAR)
  target:      number | null;   // set target for that date
  gap_pct:     number | null;   // (target - actual) / target * 100;  positive = below target
  data_date:   string | null;   // YYYY-MM-DD of the daily ops report used
  detail:      string;
}

export interface LabourComponent {
  score:       number;          // 5 | 15 | 20
  max:         20;
  labour_pct:  number | null;   // from latest daily ops report
  detail:      string;
}

export interface ComplianceComponent {
  score:        number;         // 0 | 10 | 19 | 20
  max:          20;
  worst_status: ComplianceWorstStatus;
  total_items:  number;
  expired:      number;
  due_soon:     number;
  scheduled:    number;
  detail:       string;
}

export interface MaintenanceComponent {
  score:          number;       // 0 | 10 | 20
  max:            20;
  severity:       MaintenanceSeverity;
  open_count:     number;
  critical_count: number;       // urgent priority or high-impact level
  detail:         string;
}

export interface OperatingScore {
  total:        number;         // 0–100
  grade:        ScoreGrade;
  location_id:  string;
  components: {
    revenue:     RevenueComponent;
    labour:      LabourComponent;
    compliance:  ComplianceComponent;
    maintenance: MaintenanceComponent;
  };
  computed_at:  string;         // ISO timestamp
}

// ── Grade helper ──────────────────────────────────────────────────────────────

function toGrade(total: number): ScoreGrade {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  if (total >= 40) return "D";
  return "F";
}

// ── Revenue scoring ───────────────────────────────────────────────────────────

/**
 * Revenue bands (gap = how far BELOW target, as %)
 *   gap ≤ 0%   (on target or above) → 40
 *   gap ≤ 5%   (within 5% short)    → 30
 *   gap ≤ 10%  (within 10% short)   → 20
 *   gap ≤ 20%  (within 20% short)   → 10
 *   gap > 20%  (more than 20% short)→  0
 */
function scoreRevenue(actual: number | null, target: number | null): { score: number; gap_pct: number | null } {
  if (actual === null || target === null || target === 0) {
    return { score: 0, gap_pct: null };
  }

  const gap_pct = ((target - actual) / target) * 100;   // positive = below target

  let score: number;
  if      (gap_pct <= 0)  score = 40;
  else if (gap_pct <= 5)  score = 30;
  else if (gap_pct <= 10) score = 20;
  else if (gap_pct <= 20) score = 10;
  else                    score = 0;

  return { score, gap_pct: Math.round(gap_pct * 10) / 10 };
}

function revenueDetail(score: number, gap_pct: number | null, actual: number | null, target: number | null): string {
  if (actual === null)  return "No sales data available";
  if (target === null)  return `Sales R${actual.toLocaleString()} — no target set`;
  if (gap_pct === null) return `Sales R${actual.toLocaleString()}`;
  if (gap_pct <= 0)     return `On target (R${actual.toLocaleString()} vs R${target.toLocaleString()})`;
  return `${gap_pct.toFixed(1)}% below target (R${actual.toLocaleString()} vs R${target.toLocaleString()})`;
}

// ── Labour scoring ────────────────────────────────────────────────────────────

/**
 * Labour bands (cost as % of net sales):
 *   ≤ 30%       → 20
 *   30% – 35%   → 15
 *   > 35%       → 5
 */
function scoreLabour(pct: number | null): number {
  if (pct === null) return 0;
  if (pct <= 30)    return 20;
  if (pct <= 35)    return 15;
  return 5;
}

function labourDetail(score: number, pct: number | null): string {
  if (pct === null) return "No labour data available";
  if (pct <= 30)    return `Labour at ${pct.toFixed(1)}% — healthy (≤30%)`;
  if (pct <= 35)    return `Labour at ${pct.toFixed(1)}% — above target (30–35%)`;
  return `Labour at ${pct.toFixed(1)}% — over budget (>35%)`;
}

// ── Compliance scoring ────────────────────────────────────────────────────────

/**
 * Compliance bands:
 *   any expired                    →  0  (active breach)
 *   any unscheduled due_soon       → 10  (unmanaged risk, no booking)
 *   any scheduled (none at risk)   → 19  (proactively managed, near-full score)
 *   all compliant / unknown        → 20
 */
function scoreCompliance(
  expired:   number,
  dueSoon:   number,
  scheduled: number,
): { score: number; worst: ComplianceWorstStatus } {
  if (expired > 0)   return { score: 0,  worst: "expired"   };
  if (dueSoon > 0)   return { score: 10, worst: "due_soon"  };
  if (scheduled > 0) return { score: 19, worst: "scheduled" };
  return               { score: 20, worst: "compliant" };
}

function complianceDetail(
  score:     number,
  worst:     ComplianceWorstStatus,
  expired:   number,
  dueSoon:   number,
  scheduled: number,
  total:     number,
): string {
  if (total === 0)           return "No compliance items found";
  if (score === 20)          return `All ${total} items compliant`;
  if (worst === "expired")   return `${expired} item${expired === 1 ? "" : "s"} expired`;
  if (worst === "scheduled") return `${scheduled} renewal${scheduled === 1 ? "" : "s"} scheduled before expiry`;
  return `${dueSoon} item${dueSoon === 1 ? "" : "s"} due soon — no renewal booked`;
}

// ── Maintenance scoring ───────────────────────────────────────────────────────

const CRITICAL_PRIORITIES    = new Set(["urgent"]);
const CRITICAL_IMPACT_LEVELS = new Set([
  "food_safety_risk",
  "compliance_risk",
  "service_disruption",
  "revenue_loss",
]);

/**
 * Maintenance bands:
 *   no open issues                      → 20
 *   open issues, none critical          → 10
 *   any open urgent-priority or high-   → 0
 *     impact (food_safety, compliance,
 *     service_disruption, revenue_loss)
 */
function scoreMaintenance(
  openIssues: Array<{ priority: string; impact_level: string }>
): { score: number; severity: MaintenanceSeverity; criticalCount: number } {
  if (openIssues.length === 0) {
    return { score: 20, severity: "none", criticalCount: 0 };
  }

  const criticalCount = openIssues.filter(
    (i) =>
      CRITICAL_PRIORITIES.has(i.priority) ||
      CRITICAL_IMPACT_LEVELS.has(i.impact_level)
  ).length;

  if (criticalCount > 0) {
    return { score: 0, severity: "critical", criticalCount };
  }
  return { score: 10, severity: "minor", criticalCount: 0 };
}

function maintenanceDetail(
  score: number,
  severity: MaintenanceSeverity,
  openCount: number,
  criticalCount: number
): string {
  if (severity === "none")     return "No open maintenance issues";
  if (severity === "critical") return `${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} open`;
  return `${openCount} minor issue${openCount === 1 ? "" : "s"} open`;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function getOperatingScore(locationId: string): Promise<OperatingScore> {
  const supabase = createServerClient();

  // ── Fetch all four data sources in parallel ───────────────────────────────
  const [opsResult, complianceResult, maintenanceResult] = await Promise.all([

    // Latest daily operations report (sales + labour)
    supabase
      .from("daily_operations_reports")
      .select("report_date, sales_net_vat, labor_cost_percent")
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Compliance items — live status recomputed from date fields
    supabase
      .from("compliance_items")
      .select("next_due_date, scheduled_service_date"),

    // Open maintenance issues for this site
    supabase
      .from("maintenance_logs")
      .select("priority, impact_level")
      .in("repair_status", ["open", "in_progress", "awaiting_parts"]),
  ]);

  // ── Parse ops report ──────────────────────────────────────────────────────
  const opsReport  = opsResult.data as { report_date: string; sales_net_vat: number | null; labor_cost_percent: number | null } | null;
  const actualSales = opsReport?.sales_net_vat  ?? null;
  const labourPct   = opsReport?.labor_cost_percent ?? null;
  const dataDate    = opsReport?.report_date    ?? null;

  // ── Fetch revenue target for the same date ────────────────────────────────
  let targetSales: number | null = null;
  if (dataDate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetData } = await (supabase.from("sales_targets") as any)
      .select("target_sales")
      .eq("organization_id", DEFAULT_ORG_ID)
      .eq("target_date", dataDate)
      .maybeSingle();
    targetSales = (targetData?.target_sales as number | null) ?? null;
  }

  // ── Score revenue ─────────────────────────────────────────────────────────
  const { score: revenueScore, gap_pct } = scoreRevenue(actualSales, targetSales);
  const revenueComponent: RevenueComponent = {
    score:     revenueScore,
    max:       40,
    actual:    actualSales,
    target:    targetSales,
    gap_pct,
    data_date: dataDate,
    detail:    revenueDetail(revenueScore, gap_pct, actualSales, targetSales),
  };

  // ── Score labour ──────────────────────────────────────────────────────────
  const labourScore = scoreLabour(labourPct);
  const labourComponent: LabourComponent = {
    score:      labourScore,
    max:        20,
    labour_pct: labourPct,
    detail:     labourDetail(labourScore, labourPct),
  };

  // ── Score compliance (live status recomputed from date fields) ────────────────────
  const complianceRows = (complianceResult.data as unknown as {
    next_due_date: string | null;
    scheduled_service_date?: string | null;
  }[] | null) ?? [];
  const complianceItems = complianceRows.map((c) => ({
    status: computeComplianceStatus(c.next_due_date, c.scheduled_service_date),
  }));
  const expiredCount   = complianceItems.filter((c) => c.status === "expired").length;
  const dueSoonCount   = complianceItems.filter((c) => c.status === "due_soon").length;
  const scheduledCount = complianceItems.filter((c) => c.status === "scheduled").length;
  const { score: complianceScore, worst: worstStatus } = scoreCompliance(expiredCount, dueSoonCount, scheduledCount);
  const complianceComponent: ComplianceComponent = {
    score:        complianceScore,
    max:          20,
    worst_status: worstStatus,
    total_items:  complianceItems.length,
    expired:      expiredCount,
    scheduled:    scheduledCount,
    due_soon:     dueSoonCount,
    detail:       complianceDetail(complianceScore, worstStatus, expiredCount, dueSoonCount, scheduledCount, complianceItems.length),
  };

  // ── Score maintenance ─────────────────────────────────────────────────────
  const openIssues = (maintenanceResult.data ?? []) as { priority: string; impact_level: string }[];
  const { score: maintScore, severity, criticalCount } = scoreMaintenance(openIssues);
  const maintenanceComponent: MaintenanceComponent = {
    score:          maintScore,
    max:            20,
    severity,
    open_count:     openIssues.length,
    critical_count: criticalCount,
    detail:         maintenanceDetail(maintScore, severity, openIssues.length, criticalCount),
  };

  // ── Total ─────────────────────────────────────────────────────────────────
  const total = revenueScore + labourScore + complianceScore + maintScore;

  return {
    total,
    grade:       toGrade(total),
    location_id: locationId,
    components: {
      revenue:     revenueComponent,
      labour:      labourComponent,
      compliance:  complianceComponent,
      maintenance: maintenanceComponent,
    },
    computed_at: new Date().toISOString(),
  };
}
