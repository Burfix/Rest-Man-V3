/**
 * Operating Score Engine
 *
 * getOperatingScore(locationId) → OperatingScore (0–100)
 *
 * Four weighted components (System Pulse formula):
 *   Revenue vs Target     45 pts  (weight 0.45)
 *   Labour %              30 pts  (weight 0.30)
 *   Compliance status     15 pts  (weight 0.15)
 *   Maintenance status    10 pts  (weight 0.10)
 *
 * Supplementary data (food cost, inventory risk) is still fetched and
 * returned for informational use but does not affect the total score.
 *
 * All data is fetched live from the DB; results are suitable for
 * server-side rendering or caching by the caller.
 */

import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import { computeComplianceStatus } from "@/lib/compliance/scoring";
import { isFresh } from "@/lib/data/freshness";
import {
  calcRevenueScore,
  calcLabourScore,
  calcComplianceScore,
  calcMaintenanceScore,
  toGrade as libToGrade,
  WEIGHTS,
  type ScoreConfidence,
} from "@/lib/scoring/operatingScore";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MaintenanceSeverity = "none" | "minor" | "critical";
export type ComplianceWorstStatus = "compliant" | "scheduled" | "due_soon" | "expired" | "unknown";
export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

/** Re-export so callers can import confidence type from this module. */
export type { ScoreConfidence };

export interface RevenueComponent {
  /** Weighted points earned (out of max 40). */
  score:       number;
  /** Raw score 0–100 before weighting. */
  rawScore:    number;
  max:         40;
  actual:      number | null;
  target:      number | null;
  gap_pct:     number | null;
  data_date:   string | null;
  detail:      string;
}

export interface LabourComponent {
  /** Weighted points earned (out of max 25). */
  score:       number;
  /** Raw score 0–100 before weighting. */
  rawScore:    number;
  max:         25;
  labour_pct:  number | null;
  detail:      string;
}

export interface ComplianceComponent {
  /** Weighted points earned (out of max 10). */
  score:        number;
  /** Raw score 0–100 before weighting. */
  rawScore:     number;
  max:          10;
  worst_status: ComplianceWorstStatus;
  total_items:  number;
  expired:      number;
  due_soon:     number;
  scheduled:    number;
  detail:       string;
}

export interface MaintenanceComponent {
  /** Weighted points earned (out of max 10). */
  score:          number;
  /** Raw score 0–100 before weighting. */
  rawScore:       number;
  max:            10;
  severity:       MaintenanceSeverity;
  open_count:     number;
  critical_count: number;
  detail:         string;
}

export interface ServiceComponent {
  /** Weighted points earned (out of max 15). */
  score:    number;
  /** Raw score 0–100 before weighting. Always 75 in non-copilot context (neutral). */
  rawScore: number;
  max:      15;
  detail:   string;
}

// ── Supplementary types (not counted in total score) ─────────────────────────

export interface FoodCostComponent {
  score:          number;
  max:            15;
  food_cost_pct:  number | null;
  target_pct:     number | null;
  variance_pct:   number | null;
  stock_risk:     "none" | "low" | "medium" | "high";
  detail:         string;
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
  /** Final score 0–100, clamped. */
  total:        number;
  grade:        ScoreGrade;
  location_id:  string;
  confidence:   ScoreConfidence;
  /** Up to 2 main drag labels, e.g. ["revenue gap", "labour over target"]. */
  drivers:      string[];
  /** One-sentence summary, e.g. "Driven by revenue gap and labour over target". */
  summary:      string;
  components: {
    revenue:     RevenueComponent;
    labour:      LabourComponent;
    service:     ServiceComponent;
    compliance:  ComplianceComponent;
    maintenance: MaintenanceComponent;
    /** Supplementary — informational only, not counted in total. */
    food_cost?:      FoodCostComponent;
    inventory_risk?: InventoryRiskComponent;
  };
  computed_at:  string;         // ISO timestamp
}

// ── Grade helper ──────────────────────────────────────────────────────────────

function toGrade(total: number): ScoreGrade {
  return libToGrade(total);
}

// ── Compliance worst-status helper ────────────────────────────────────────────

function deriveWorstStatus(
  expired: number,
  dueSoon: number,
  scheduled: number,
): ComplianceWorstStatus {
  if (expired > 0)   return "expired";
  if (dueSoon > 0)   return "due_soon";
  if (scheduled > 0) return "scheduled";
  return "compliant";
}

// ── Maintenance severity helper ───────────────────────────────────────────────

const CRITICAL_PRIORITIES    = new Set(["urgent"]);
const CRITICAL_IMPACT_LEVELS = new Set([
  "food_safety_risk",
  "compliance_risk",
  "service_disruption",
  "revenue_loss",
]);

function deriveMaintenance(
  openIssues: Array<{ priority: string; impact_level: string }>
): { severity: MaintenanceSeverity; criticalCount: number; openCount: number } {
  if (openIssues.length === 0) {
    return { severity: "none", criticalCount: 0, openCount: 0 };
  }
  const criticalCount = openIssues.filter(
    (i) => CRITICAL_PRIORITIES.has(i.priority) || CRITICAL_IMPACT_LEVELS.has(i.impact_level)
  ).length;
  return {
    severity:     criticalCount > 0 ? "critical" : "minor",
    criticalCount,
    openCount:    openIssues.length,
  };
}

// ── Food Cost scoring (supplementary — not counted in total) ──────────────────

function scoreFoodCost(
  actualPct: number | null,
  targetPct: number | null,
): { score: number; variance_pct: number | null; stock_risk: FoodCostComponent["stock_risk"] } {
  if (actualPct === null || targetPct === null) {
    return { score: 8, variance_pct: null, stock_risk: "none" };
  }
  const variance = actualPct - targetPct;
  let score: number;
  if      (variance <= 0)  score = 15;
  else if (variance <= 2)  score = 12;
  else if (variance <= 5)  score = 8;
  else if (variance <= 10) score = 4;
  else                     score = 0;
  const stock_risk: FoodCostComponent["stock_risk"] =
    variance <= 0 ? "none" : variance <= 2 ? "low" : variance <= 5 ? "medium" : "high";
  return { score, variance_pct: Math.round(variance * 10) / 10, stock_risk };
}

function foodCostDetail(actualPct: number | null, targetPct: number | null, variance: number | null): string {
  if (actualPct === null) return "No food cost data available";
  if (targetPct === null) return `Food cost ${actualPct.toFixed(1)}% — no target set`;
  if (variance !== null && variance <= 0) return `Food cost ${actualPct.toFixed(1)}% — on target (${targetPct.toFixed(1)}%)`;
  return `Food cost ${actualPct.toFixed(1)}% — ${variance?.toFixed(1)}% above target (${targetPct.toFixed(1)}%)`;
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
  orgId?: string,
  posConnected?: boolean,
): Promise<OperatingScore> {
  const isPosConnected = posConnected ?? true;
  const supabase = createServerClient();

  // ── Fetch all data sources in parallel ────────────────────────────────────
  const [complianceResult, maintenanceResult, foodCostResult] = await Promise.all([
    supabase
      .from("compliance_items")
      .select("next_due_date, scheduled_service_date, status"),

    supabase
      .from("maintenance_logs")
      .select("priority, impact_level")
      .in("repair_status", ["open", "in_progress", "awaiting_parts"]),

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

  // ── Resolve revenue ───────────────────────────────────────────────────────
  let actualSales: number | null;
  let targetSales: number | null;
  let dataDate: string | null;

  if (salesOverride) {
    actualSales = salesOverride.netSales;
    targetSales = salesOverride.targetSales;
    dataDate    = salesOverride.dataDate;
  } else {
    actualSales = null;
    dataDate    = null;
    targetSales = null;
  }

  if (!targetSales && dataDate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetData } = await (supabase.from("sales_targets") as any)
      .select("target_sales")
      .eq("organization_id", orgId ?? DEFAULT_ORG_ID)
      .eq("target_date", dataDate)
      .maybeSingle();
    targetSales = (targetData?.target_sales as number | null) ?? null;
  }

  // ── Revenue component ──────────────────────────────────────────────────────
  // When POS-connected but data hasn't synced yet, award a neutral raw score of 60
  // (equivalent to "we're running, just haven't received data") rather than 0.
  let revRawScore: number;
  let revDetail:   string;
  let revGapPct:   number | null = null;

  if (actualSales === null && isPosConnected) {
    revRawScore = 60;
    revDetail   = "Awaiting live sales data";
  } else {
    const rev = calcRevenueScore(actualSales, targetSales);
    revRawScore = rev.rawScore;
    revDetail   = rev.explanation;
    if (actualSales !== null && targetSales !== null && targetSales > 0) {
      revGapPct = +((( targetSales - actualSales) / targetSales) * 100).toFixed(1);
    }
  }

  const revWeighted = Math.round(revRawScore * WEIGHTS.revenue);

  const revenueComponent: RevenueComponent = {
    score:     revWeighted,
    rawScore:  revRawScore,
    max:       40,
    actual:    actualSales,
    target:    targetSales,
    gap_pct:   revGapPct,
    data_date: dataDate,
    detail:    revDetail,
  };

  // ── Labour component ───────────────────────────────────────────────────────
  // Neutral raw score of 50 when connected but not yet synced.
  const liveLabourPct = labourOverride?.labourPct ?? null;
  let labRawScore: number;
  let labDetail:   string;

  if (liveLabourPct === null && isPosConnected) {
    labRawScore = 50;
    labDetail   = "Awaiting live labour data";
  } else {
    const lab = calcLabourScore(liveLabourPct, actualSales, targetSales, 30, labourOverride?.totalPay ?? null);
    labRawScore = lab.rawScore;
    labDetail   = lab.explanation;
  }

  const labWeighted = Math.round(labRawScore * WEIGHTS.labour);

  const labourComponent: LabourComponent = {
    score:      labWeighted,
    rawScore:   labRawScore,
    max:        25,
    labour_pct: liveLabourPct,
    detail:     labDetail,
  };

  // ── Service component (neutral when not in real-time context) ─────────────
  // Service is tracked by the GM Co-Pilot in real-time; here we use neutral 75.
  const svcRawScore = 75;
  const svcWeighted = Math.round(svcRawScore * WEIGHTS.service);

  // ── Compliance component ───────────────────────────────────────────────────
  const complianceRows = (complianceResult.data as unknown as {
    next_due_date: string | null;
    scheduled_service_date?: string | null;
    status?: string | null;
  }[] | null) ?? [];
  const complianceItems = complianceRows.map((c) => ({
    status: computeComplianceStatus(c.next_due_date, c.scheduled_service_date, c.status),
  }));
  const expiredCount   = complianceItems.filter((c) => c.status === "expired").length;
  const dueSoonCount   = complianceItems.filter((c) => c.status === "due_soon").length;
  const scheduledCount = complianceItems.filter((c) => c.status === "scheduled").length;
  const compliantCount = complianceItems.filter((c) => c.status === "compliant").length;

  const comp = calcComplianceScore(
    complianceItems.length,
    compliantCount,
    expiredCount,
    dueSoonCount,
  );
  const compWeighted = Math.round(comp.rawScore * WEIGHTS.compliance);

  const complianceComponent: ComplianceComponent = {
    score:        compWeighted,
    rawScore:     comp.rawScore,
    max:          10,
    worst_status: deriveWorstStatus(expiredCount, dueSoonCount, scheduledCount),
    total_items:  complianceItems.length,
    expired:      expiredCount,
    scheduled:    scheduledCount,
    due_soon:     dueSoonCount,
    detail:       comp.explanation,
  };

  // ── Maintenance component ──────────────────────────────────────────────────
  const openIssues = (maintenanceResult.data ?? []) as { priority: string; impact_level: string }[];
  const maintInfo  = deriveMaintenance(openIssues);
  const maint      = calcMaintenanceScore(
    openIssues.length + (openIssues.length === 0 ? 1 : 0),   // avoid div-by-zero; 1 item = all clear
    openIssues.length,
    maintInfo.criticalCount,
  );
  // Simpler: when no open issues → raw=100; else use total/open ratio minus critical penalty
  const maintRawScore = openIssues.length === 0
    ? 100
    : Math.max(0, Math.round(((openIssues.length - maintInfo.criticalCount) / openIssues.length) * 100) - maintInfo.criticalCount * 20);
  const maintDetail =
    maintInfo.severity === "none"     ? "No open maintenance issues" :
    maintInfo.severity === "critical" ? `${maintInfo.criticalCount} critical issue${maintInfo.criticalCount === 1 ? "" : "s"} open` :
    `${maintInfo.openCount} minor issue${maintInfo.openCount === 1 ? "" : "s"} open`;
  const maintWeighted = Math.round(Math.min(maintRawScore, 100) * WEIGHTS.maintenance);

  const maintenanceComponent: MaintenanceComponent = {
    score:          maintWeighted,
    rawScore:       Math.min(maintRawScore, 100),
    max:            10,
    severity:       maintInfo.severity,
    open_count:     maintInfo.openCount,
    critical_count: maintInfo.criticalCount,
    detail:         maintDetail,
  };

  // ── Total (0–100) ───────────────────────────────────────────────────────
  // Use canonical weights via WEIGHTS — single source of truth
  const total = Math.min(100, revWeighted + labWeighted + svcWeighted + compWeighted + maintWeighted);

  // ── SCORE INPUT log — catches bad inputs before they corrupt the score ─────
  console.log("SCORE INPUT [services/ops/operatingScore]:", {
    actualRevenue:  actualSales,
    targetRevenue:  targetSales,
    labourPct:      liveLabourPct,
    targetLabourPct: 30,
    serviceScore:   "neutral (75)",
    expiredItems:   expiredCount,
    dueSoonItems:   dueSoonCount,
    openIssues:     maintInfo.openCount,
    criticalIssues: maintInfo.criticalCount,
    // derived
    revWeighted, labWeighted, svcWeighted, compWeighted, maintWeighted, total,
  });

  // ── Confidence ────────────────────────────────────────────────────────────
  const hasRevenue    = actualSales !== null && targetSales !== null;
  const hasLabour     = liveLabourPct !== null;
  const hasCompliance = complianceItems.length > 0;

  // Freshness check: if revenue or labour data is stale (> 30 min), cap at "low"
  const revenueIsFresh = isFresh(dataDate);
  if (hasRevenue && !revenueIsFresh) {
    console.warn("SCORE FRESHNESS WARN: revenue data is stale", { dataDate });
  }

  let confidence: ScoreConfidence;
  if (!revenueIsFresh && hasRevenue) {
    // Stale revenue — never show as high or medium confidence
    confidence = "low";
  } else if (hasRevenue && hasLabour && hasCompliance) {
    confidence = "high";
  } else if (hasRevenue && hasLabour) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // ── Drivers — threshold-based critical messages matching canonical scorer ──
  const drivers: string[] = [];

  if (revWeighted <= 10) {
    drivers.push("Revenue critically behind target");
  } else if (revRawScore < 60) {
    drivers.push("Revenue behind target");
  }

  if (labWeighted <= 10) {
    drivers.push("Labour significantly over target");
  } else if (labRawScore < 60) {
    drivers.push("Labour over target");
  }

  if (comp.rawScore < 60) {
    drivers.push("Compliance gaps");
  }

  if (Math.min(maintRawScore, 100) < 60) {
    drivers.push("Maintenance issues");
  }

  // Keep at most 2
  drivers.splice(2);

  const summary = drivers.length === 0
    ? "All systems operating well"
    : `Driven by ${drivers.join(" and ")}`;

  // ── Supplementary: food cost ───────────────────────────────────────────────
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
    detail:        foodCostDetail(actualFoodCostPct, targetFoodCostPct, fcVariance),
  };

  // ── Supplementary: inventory risk ─────────────────────────────────────────
  const invData = inventoryOverride ?? { riskScore: 7, criticalCount: 0, lowCount: 0, healthyCount: 0, totalItems: 0, noPOCount: 0 };
  const inventoryRiskComponent: InventoryRiskComponent = {
    score:          invData.riskScore,
    max:            10,
    critical_count: invData.criticalCount,
    low_count:      invData.lowCount,
    healthy_count:  invData.healthyCount,
    total_items:    invData.totalItems,
    no_po_count:    invData.noPOCount,
    detail:
      invData.totalItems === 0      ? "No inventory items tracked" :
      invData.criticalCount > 0     ? `${invData.criticalCount} stockout${invData.criticalCount > 1 ? "s" : ""} — service at risk` :
      invData.lowCount > 0          ? `${invData.lowCount} item${invData.lowCount > 1 ? "s" : ""} running low` :
      "All stock levels healthy",
  };

  return {
    total,
    grade:       toGrade(total),
    location_id: locationId,
    confidence,
    drivers,
    summary,
    components: {
      revenue:        revenueComponent,
      labour:         labourComponent,
      service: {
        score:    svcWeighted,
        rawScore: svcRawScore,
        max:      15,
        detail:   "Service score neutral — live score computed by GM Co-Pilot",
      },
      compliance:     complianceComponent,
      maintenance:    maintenanceComponent,
      food_cost:      foodCostComponent,
      inventory_risk: inventoryRiskComponent,
    },
    computed_at: new Date().toISOString(),
  };
}
