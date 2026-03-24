/**
 * Operating Score Engine
 *
 * getOperatingScore(locationId) → OperatingScore (0–100)
 *
 * Seven weighted components:
 *   Revenue vs Target     20 pts
 *   Labour %              20 pts
 *   Food Cost             15 pts
 *   Compliance status     15 pts
 *   Inventory Risk        10 pts
 *   Maintenance status    10 pts
 *   Daily Ops Execution   10 pts
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
  score:       number;
  max:         20;
  actual:      number | null;
  target:      number | null;
  gap_pct:     number | null;
  data_date:   string | null;
  detail:      string;
}

export interface LabourComponent {
  score:       number;
  max:         20;
  labour_pct:  number | null;
  detail:      string;
}

export interface FoodCostComponent {
  score:          number;
  max:            15;
  food_cost_pct:  number | null;
  target_pct:     number | null;
  variance_pct:   number | null;
  stock_risk:     "none" | "low" | "medium" | "high";
  detail:         string;
}

export interface ComplianceComponent {
  score:        number;
  max:          15;
  worst_status: ComplianceWorstStatus;
  total_items:  number;
  expired:      number;
  due_soon:     number;
  scheduled:    number;
  detail:       string;
}

export interface MaintenanceComponent {
  score:          number;
  max:            10;
  severity:       MaintenanceSeverity;
  open_count:     number;
  critical_count: number;
  detail:         string;
}

export interface DailyOpsComponent {
  score:            number;
  max:              10;
  report_age_days:  number | null;
  freshness:        "fresh" | "aging" | "stale" | "missing";
  detail:           string;
}

export interface InventoryRiskComponent {
  score:          number;
  max:            10;
  critical_count: number;
  low_count:      number;
  healthy_count:  number;
  total_items:    number;
  no_po_count:    number;
  detail:         string;
}

export interface OperatingScore {
  total:        number;         // 0–100
  grade:        ScoreGrade;
  location_id:  string;
  components: {
    revenue:        RevenueComponent;
    labour:         LabourComponent;
    food_cost:      FoodCostComponent;
    compliance:     ComplianceComponent;
    inventory_risk: InventoryRiskComponent;
    maintenance:    MaintenanceComponent;
    daily_ops:      DailyOpsComponent;
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

// ── Revenue scoring (max 20) ──────────────────────────────────────────────────

/**
 * Revenue bands (gap = how far BELOW target, as %)
 *   gap ≤ 0%  → 20   gap ≤ 5%  → 16   gap ≤ 10% → 12
 *   gap ≤ 20% → 6    gap > 20% → 0
 */
function scoreRevenue(actual: number | null, target: number | null): { score: number; gap_pct: number | null } {
  if (actual === null || target === null || target === 0) {
    return { score: 0, gap_pct: null };
  }
  const gap_pct = ((target - actual) / target) * 100;
  let score: number;
  if      (gap_pct <= 0)  score = 20;
  else if (gap_pct <= 5)  score = 16;
  else if (gap_pct <= 10) score = 12;
  else if (gap_pct <= 20) score = 6;
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

// ── Compliance scoring (max 15) ───────────────────────────────────────────────

/**
 * Compliance bands:
 *   any expired                    →  0
 *   any unscheduled due_soon       →  6
 *   any scheduled (none at risk)   → 13
 *   all compliant / unknown        → 15
 */
function scoreCompliance(
  expired:   number,
  dueSoon:   number,
  scheduled: number,
): { score: number; worst: ComplianceWorstStatus } {
  if (expired > 0)   return { score: 0,  worst: "expired"   };
  if (dueSoon > 0)   return { score: 6,  worst: "due_soon"  };
  if (scheduled > 0) return { score: 13, worst: "scheduled" };
  return               { score: 15, worst: "compliant" };
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

// ── Maintenance scoring (max 10) ──────────────────────────────────────────────

const CRITICAL_PRIORITIES    = new Set(["urgent"]);
const CRITICAL_IMPACT_LEVELS = new Set([
  "food_safety_risk",
  "compliance_risk",
  "service_disruption",
  "revenue_loss",
]);

/**
 * Maintenance bands:
 *   no open issues           → 10
 *   open, none critical      → 5
 *   any critical / urgent    → 0
 */
function scoreMaintenance(
  openIssues: Array<{ priority: string; impact_level: string }>
): { score: number; severity: MaintenanceSeverity; criticalCount: number } {
  if (openIssues.length === 0) {
    return { score: 10, severity: "none", criticalCount: 0 };
  }
  const criticalCount = openIssues.filter(
    (i) =>
      CRITICAL_PRIORITIES.has(i.priority) ||
      CRITICAL_IMPACT_LEVELS.has(i.impact_level)
  ).length;
  if (criticalCount > 0) {
    return { score: 0, severity: "critical", criticalCount };
  }
  return { score: 5, severity: "minor", criticalCount: 0 };
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

// ── Food Cost scoring (max 15) ────────────────────────────────────────────────

/**
 * Food cost bands (variance above target):
 *   ≤ 0% (at or below target)  → 15
 *   ≤ 2% above target          → 12
 *   ≤ 5% above target          → 8
 *   ≤ 10% above target         → 4
 *   > 10% above target         → 0
 *   no data                    → 8 (neutral)
 */
function scoreFoodCost(
  actualPct: number | null,
  targetPct: number | null,
): { score: number; variance_pct: number | null; stock_risk: "none" | "low" | "medium" | "high" } {
  if (actualPct === null || targetPct === null) {
    return { score: 8, variance_pct: null, stock_risk: "none" };
  }
  const variance = actualPct - targetPct;
  let score: number;
  if      (variance <= 0) score = 15;
  else if (variance <= 2) score = 12;
  else if (variance <= 5) score = 8;
  else if (variance <= 10) score = 4;
  else                     score = 0;

  const stock_risk = variance <= 0 ? "none" as const
    : variance <= 2 ? "low" as const
    : variance <= 5 ? "medium" as const
    : "high" as const;

  return { score, variance_pct: Math.round(variance * 10) / 10, stock_risk };
}

function foodCostDetail(score: number, actualPct: number | null, targetPct: number | null, variance: number | null): string {
  if (actualPct === null) return "No food cost data available";
  if (targetPct === null) return `Food cost ${actualPct.toFixed(1)}% — no target set`;
  if (variance !== null && variance <= 0) return `Food cost ${actualPct.toFixed(1)}% — on target (${targetPct.toFixed(1)}%)`;
  return `Food cost ${actualPct.toFixed(1)}% — ${variance?.toFixed(1)}% above target (${targetPct.toFixed(1)}%)`;
}

// ── Daily Ops scoring (max 10) ────────────────────────────────────────────────

/**
 * Daily ops freshness:
 *   report today or yesterday       → 10  (fresh)
 *   report 2–3 days old             → 6   (aging)
 *   report 4–7 days old             → 3   (stale)
 *   no report or > 7 days           → 0   (missing)
 */
function scoreDailyOps(
  latestReportDate: string | null,
  today: string,
): { score: number; age_days: number | null; freshness: "fresh" | "aging" | "stale" | "missing" } {
  if (!latestReportDate) {
    return { score: 0, age_days: null, freshness: "missing" };
  }
  const diff = Math.floor(
    (new Date(today).getTime() - new Date(latestReportDate).getTime()) / 86400000
  );
  if (diff <= 1) return { score: 10, age_days: diff, freshness: "fresh" };
  if (diff <= 3) return { score: 6,  age_days: diff, freshness: "aging" };
  if (diff <= 7) return { score: 3,  age_days: diff, freshness: "stale" };
  return { score: 0, age_days: diff, freshness: "missing" };
}

function dailyOpsDetail(freshness: "fresh" | "aging" | "stale" | "missing", ageDays: number | null): string {
  if (freshness === "missing") return ageDays !== null ? `Last report ${ageDays}d ago — stale` : "No daily ops report found";
  if (freshness === "fresh")   return ageDays === 0 ? "Today's report uploaded" : "Yesterday's report available";
  if (freshness === "aging")   return `Report ${ageDays}d old — update recommended`;
  return `Report ${ageDays}d old — requires update`;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Optional override for revenue scoring — allows MICROS live data
 * or manual uploads to be injected instead of querying daily_operations_reports.
 */
export interface SalesOverride {
  netSales: number;
  targetSales: number | null;
  dataDate: string;
}

export interface LabourOverride {
  labourPct: number;
  totalPay: number;
  totalHours: number;
  activeStaff: number;
}

export interface InventoryOverride {
  riskScore:      number; // 0–10
  criticalCount:  number;
  lowCount:       number;
  healthyCount:   number;
  totalItems:     number;
  noPOCount:      number;
}

export async function getOperatingScore(
  locationId: string,
  salesOverride?: SalesOverride | null,
  labourOverride?: LabourOverride | null,
  inventoryOverride?: InventoryOverride | null,
): Promise<OperatingScore> {
  const supabase = createServerClient();
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Fetch all data sources in parallel ────────────────────────────────────
  const [opsResult, complianceResult, maintenanceResult, foodCostResult] = await Promise.all([

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

    // Latest food cost snapshot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("food_cost_snapshots")
      .select("estimated_food_cost_pct, target_food_cost_pct")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r: any) => r)
      .catch(() => ({ data: null, error: null })),
  ]);

  // ── Parse ops report ──────────────────────────────────────────────────────
  const opsReport  = opsResult.data as { report_date: string; sales_net_vat: number | null; labor_cost_percent: number | null } | null;
  const labourPct   = opsReport?.labor_cost_percent ?? null;

  // ── Resolve revenue: prefer salesOverride (MICROS/manual) over CSV ────────
  let actualSales: number | null;
  let targetSales: number | null;
  let dataDate: string | null;

  if (salesOverride) {
    actualSales = salesOverride.netSales;
    targetSales = salesOverride.targetSales;
    dataDate    = salesOverride.dataDate;
  } else {
    actualSales = opsReport?.sales_net_vat  ?? null;
    dataDate    = opsReport?.report_date    ?? null;

    targetSales = null;
    if (dataDate) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: targetData } = await (supabase.from("sales_targets") as any)
        .select("target_sales")
        .eq("organization_id", DEFAULT_ORG_ID)
        .eq("target_date", dataDate)
        .maybeSingle();
      targetSales = (targetData?.target_sales as number | null) ?? null;
    }
  }

  // ── Score revenue (20 pts) ────────────────────────────────────────────────
  const { score: revenueScore, gap_pct } = scoreRevenue(actualSales, targetSales);
  const revenueComponent: RevenueComponent = {
    score:     revenueScore,
    max:       20,
    actual:    actualSales,
    target:    targetSales,
    gap_pct,
    data_date: dataDate,
    detail:    revenueDetail(revenueScore, gap_pct, actualSales, targetSales),
  };

  // ── Score labour (20 pts) — prefer live MICROS over CSV ────────────────────
  const liveLabourPct = labourOverride?.labourPct ?? labourPct;
  const labourScore = scoreLabour(liveLabourPct);
  const labourComponent: LabourComponent = {
    score:      labourScore,
    max:        20,
    labour_pct: liveLabourPct,
    detail:     labourDetail(labourScore, liveLabourPct),
  };

  // ── Score food cost (15 pts) ──────────────────────────────────────────────
  const fcData = foodCostResult.data as { estimated_food_cost_pct: number | null; target_food_cost_pct: number | null } | null;
  const actualFoodCostPct = fcData?.estimated_food_cost_pct ?? null;
  const targetFoodCostPct = fcData?.target_food_cost_pct ?? null;
  const { score: foodCostScore, variance_pct: fcVariance, stock_risk } = scoreFoodCost(actualFoodCostPct, targetFoodCostPct);
  const foodCostComponent: FoodCostComponent = {
    score:         foodCostScore,
    max:           15,
    food_cost_pct: actualFoodCostPct,
    target_pct:    targetFoodCostPct,
    variance_pct:  fcVariance,
    stock_risk,
    detail:        foodCostDetail(foodCostScore, actualFoodCostPct, targetFoodCostPct, fcVariance),
  };

  // ── Score compliance (15 pts) ─────────────────────────────────────────────
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
    max:          15,
    worst_status: worstStatus,
    total_items:  complianceItems.length,
    expired:      expiredCount,
    scheduled:    scheduledCount,
    due_soon:     dueSoonCount,
    detail:       complianceDetail(complianceScore, worstStatus, expiredCount, dueSoonCount, scheduledCount, complianceItems.length),
  };

  // ── Score maintenance (10 pts) ────────────────────────────────────────────
  const openIssues = (maintenanceResult.data ?? []) as { priority: string; impact_level: string }[];
  const { score: maintScore, severity, criticalCount } = scoreMaintenance(openIssues);
  const maintenanceComponent: MaintenanceComponent = {
    score:          maintScore,
    max:            10,
    severity,
    open_count:     openIssues.length,
    critical_count: criticalCount,
    detail:         maintenanceDetail(maintScore, severity, openIssues.length, criticalCount),
  };

  // ── Score daily ops freshness (10 pts) ────────────────────────────────────
  const { score: opsScore, age_days, freshness } = scoreDailyOps(
    opsReport?.report_date ?? null,
    todayStr,
  );
  const dailyOpsComponent: DailyOpsComponent = {
    score:           opsScore,
    max:             10,
    report_age_days: age_days,
    freshness,
    detail:          dailyOpsDetail(freshness, age_days),
  };

  // ── Score inventory risk (10 pts) ─────────────────────────────────────────
  const invData = inventoryOverride ?? { riskScore: 7, criticalCount: 0, lowCount: 0, healthyCount: 0, totalItems: 0, noPOCount: 0 };
  const inventoryScore = invData.riskScore;
  const inventoryDetail =
    invData.totalItems === 0 ? "No inventory items tracked" :
    invData.criticalCount > 0 ? `${invData.criticalCount} stockout${invData.criticalCount > 1 ? "s" : ""} — service at risk` :
    invData.lowCount > 0 ? `${invData.lowCount} item${invData.lowCount > 1 ? "s" : ""} running low` :
    "All stock levels healthy";
  const inventoryRiskComponent: InventoryRiskComponent = {
    score:          inventoryScore,
    max:            10,
    critical_count: invData.criticalCount,
    low_count:      invData.lowCount,
    healthy_count:  invData.healthyCount,
    total_items:    invData.totalItems,
    no_po_count:    invData.noPOCount,
    detail:         inventoryDetail,
  };

  // ── Total ─────────────────────────────────────────────────────────────────
  const total = revenueScore + labourScore + foodCostScore + complianceScore + inventoryScore + maintScore + opsScore;

  return {
    total,
    grade:       toGrade(total),
    location_id: locationId,
    components: {
      revenue:        revenueComponent,
      labour:         labourComponent,
      food_cost:      foodCostComponent,
      compliance:     complianceComponent,
      inventory_risk: inventoryRiskComponent,
      maintenance:    maintenanceComponent,
      daily_ops:      dailyOpsComponent,
    },
    computed_at: new Date().toISOString(),
  };
}
