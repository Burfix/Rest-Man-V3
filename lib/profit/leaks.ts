/**
 * lib/profit/leaks.ts
 *
 * Rule-based profit leak detection engine.
 *
 * Each rule receives the profit intelligence inputs and emits zero or more
 * ProfitLeak objects. Rules are deterministic and side-effect free.
 *
 * Called by getProfitIntelligence() inside lib/profit/engine.ts.
 */

import type { ProfitLeak, LeakSeverity } from "./types";

interface LeakInput {
  revenue: number | null;
  targetRevenue: number | null;
  labourCost: number | null;
  labourPct: number | null;
  targetLabourPct: number;
  estimatedFoodCost: number | null;
  foodCostPct: number | null;
  targetFoodCostPct: number;
  estimatedWaste: number | null;
  discountsComps: number | null;
  covers: number | null;
  targetCovers: number | null;
  avgSpend: number | null;
  targetAvgSpend: number | null;
  inventoryAvailable: boolean;
  salesStale: boolean;
  foodCostEstimated: boolean;
}

// ── Severity helpers ──────────────────────────────────────────────────────────

function revenueShortfallSeverity(gap: number, target: number): LeakSeverity {
  const pct = target > 0 ? gap / target : 0;
  if (pct >= 0.25) return "critical";
  if (pct >= 0.15) return "high";
  if (pct >= 0.05) return "medium";
  return "low";
}

function labourDragSeverity(deltaPoints: number): LeakSeverity {
  if (deltaPoints >= 10) return "critical";
  if (deltaPoints >= 6)  return "high";
  if (deltaPoints >= 3)  return "medium";
  return "low";
}

function foodCostSeverity(deltaPoints: number): LeakSeverity {
  if (deltaPoints >= 8) return "critical";
  if (deltaPoints >= 5) return "high";
  if (deltaPoints >= 2) return "medium";
  return "low";
}

// ── Rule: Labour drag ─────────────────────────────────────────────────────────

function labourDragRule(input: LeakInput): ProfitLeak[] {
  if (input.labourPct == null || input.revenue == null) return [];
  const delta = input.labourPct - input.targetLabourPct;
  if (delta < 2) return [];

  const impact =
    input.revenue > 0 ? Math.round((delta / 100) * input.revenue) : null;

  return [{
    id: "labour_drag",
    title: `Labour drag: running ${delta.toFixed(1)} pts above target`,
    severity: labourDragSeverity(delta),
    financialImpact: impact,
    explanation: `Labour is at ${input.labourPct.toFixed(1)}% of revenue against a target of ${input.targetLabourPct}%. Every percentage point over target costs approximately R${input.revenue > 0 ? Math.round(input.revenue / 100).toLocaleString() : "—"} in margin.`,
    recommendedAction: "Review the current shift schedule. Consider reducing one FOH or BOH shift if covers allow. Confirm whether all staff are clock-on.",
    sourceData: `labourPct=${input.labourPct.toFixed(1)}%, targetLabourPct=${input.targetLabourPct}%`,
    category: "labour",
  }];
}

// ── Rule: Revenue shortfall ───────────────────────────────────────────────────

function revenueShortfallRule(input: LeakInput): ProfitLeak[] {
  if (input.revenue == null || input.targetRevenue == null) return [];
  const gap = input.targetRevenue - input.revenue;
  if (gap < 500) return [];

  return [{
    id: "revenue_shortfall",
    title: `Revenue shortfall: R${Math.round(gap).toLocaleString()} below target`,
    severity: revenueShortfallSeverity(gap, input.targetRevenue),
    financialImpact: gap,
    explanation: `Revenue is R${Math.round(input.revenue).toLocaleString()} against a target of R${Math.round(input.targetRevenue).toLocaleString()}. This shortfall is directly compressing operating profit.`,
    recommendedAction: "Push high-margin menu items. Confirm all bookings have arrived. Consider a tactical upsell or promotional push to drive covers.",
    sourceData: `revenue=${input.revenue}, targetRevenue=${input.targetRevenue}`,
    category: "revenue",
  }];
}

// ── Rule: Food cost above threshold ──────────────────────────────────────────

function foodCostRule(input: LeakInput): ProfitLeak[] {
  if (input.foodCostPct == null || !input.estimatedFoodCost) return [];
  const delta = input.foodCostPct - input.targetFoodCostPct;
  if (delta < 1.5) return [];

  const impact =
    input.revenue != null && input.revenue > 0
      ? Math.round((delta / 100) * input.revenue)
      : null;

  const estimatedNote = input.foodCostEstimated ? " (food cost is estimated)" : "";
  return [{
    id: "food_cost_high",
    title: `Food cost ${input.foodCostEstimated ? "estimate" : ""} above target by ${delta.toFixed(1)} pts`,
    severity: foodCostSeverity(delta),
    financialImpact: impact,
    explanation: `Food cost is at ${input.foodCostPct.toFixed(1)}% against a target of ${input.targetFoodCostPct}%${estimatedNote}. Elevated food cost indicates either over-ordering, portioning variance, or waste.`,
    recommendedAction: "Review today's ordering. Check portion control. Investigate any prep waste or spoilage. Confirm menu pricing covers current ingredient costs.",
    sourceData: `foodCostPct=${input.foodCostPct.toFixed(1)}%, targetFoodCostPct=${input.targetFoodCostPct}%`,
    category: "food_cost",
  }];
}

// ── Rule: Low average spend ───────────────────────────────────────────────────

function avgSpendRule(input: LeakInput): ProfitLeak[] {
  if (input.avgSpend == null || input.targetAvgSpend == null) return [];
  const gap = input.targetAvgSpend - input.avgSpend;
  const gapPct = input.targetAvgSpend > 0 ? gap / input.targetAvgSpend : 0;
  if (gapPct < 0.08) return [];

  const impact =
    input.covers != null && input.covers > 0
      ? Math.round(gap * input.covers)
      : null;

  return [{
    id: "low_avg_spend",
    title: `Avg spend R${Math.round(gap)} below target — upsell weakness likely`,
    severity: gapPct >= 0.20 ? "high" : "medium",
    financialImpact: impact,
    explanation: `Average spend per cover is R${Math.round(input.avgSpend)} against a target of R${Math.round(input.targetAvgSpend)}. Low average spend compresses gross margin even when covers are on target.`,
    recommendedAction: "Brief floor team on high-margin upsells: premium mains, desserts, cocktails. Ensure menu boards and verbal prompts are driving beverage attachment.",
    sourceData: `avgSpend=${Math.round(input.avgSpend)}, targetAvgSpend=${Math.round(input.targetAvgSpend)}`,
    category: "covers",
  }];
}

// ── Rule: Low covers ──────────────────────────────────────────────────────────

function lowCoversRule(input: LeakInput): ProfitLeak[] {
  if (input.covers == null || input.targetCovers == null) return [];
  const gap = input.targetCovers - input.covers;
  const gapPct = input.targetCovers > 0 ? gap / input.targetCovers : 0;
  if (gapPct < 0.10) return [];

  const impact =
    input.avgSpend != null ? Math.round(gap * input.avgSpend) : null;

  return [{
    id: "low_covers",
    title: `Cover count ${Math.round(gap)} below target`,
    severity: gapPct >= 0.25 ? "high" : "medium",
    financialImpact: impact,
    explanation: `${input.covers} covers recorded against a target of ${input.targetCovers}. Low covers directly reduce revenue capacity.`,
    recommendedAction: "Confirm all bookings are captured. Review walk-in conversion and table turn time. Check if the floor is being maximised.",
    sourceData: `covers=${input.covers}, targetCovers=${input.targetCovers}`,
    category: "covers",
  }];
}

// ── Rule: Discounts / comps spike ────────────────────────────────────────────

function discountsRule(input: LeakInput): ProfitLeak[] {
  if (input.discountsComps == null || input.revenue == null || input.revenue <= 0) return [];
  const discountPct = (input.discountsComps / input.revenue) * 100;
  if (discountPct < 3) return [];

  return [{
    id: "discounts_spike",
    title: `Discounts & comps at ${discountPct.toFixed(1)}% of revenue`,
    severity: discountPct >= 8 ? "high" : "medium",
    financialImpact: Math.round(input.discountsComps),
    explanation: `R${Math.round(input.discountsComps).toLocaleString()} in discounts and comps represents ${discountPct.toFixed(1)}% of revenue. This directly reduces net margin.`,
    recommendedAction: "Review comp authorisations. Ensure discounts are policy-compliant. Investigate if void and comp reasons are being recorded accurately.",
    sourceData: `discountsComps=${Math.round(input.discountsComps)}, revenue=${Math.round(input.revenue)}`,
    category: "discounts",
  }];
}

// ── Rule: Waste risk ──────────────────────────────────────────────────────────

function wasteRule(input: LeakInput): ProfitLeak[] {
  if (input.estimatedWaste == null || input.revenue == null || input.revenue <= 0) return [];
  const wastePct = (input.estimatedWaste / input.revenue) * 100;
  if (wastePct < 2) return [];

  return [{
    id: "waste_risk",
    title: `Estimated waste at ${wastePct.toFixed(1)}% of revenue`,
    severity: wastePct >= 5 ? "high" : "medium",
    financialImpact: Math.round(input.estimatedWaste),
    explanation: `Waste estimate of R${Math.round(input.estimatedWaste).toLocaleString()} is degrading food cost and operating margin.`,
    recommendedAction: "Review prep quantities versus covers forecast. Confirm FIFO rotation in fridges. Brief kitchen on current waste report.",
    sourceData: `estimatedWaste=${Math.round(input.estimatedWaste)}, revenue=${Math.round(input.revenue)}`,
    category: "waste",
  }];
}

// ── Rule: Missing inventory data ──────────────────────────────────────────────

function missingInventoryRule(input: LeakInput): ProfitLeak[] {
  if (input.inventoryAvailable) return [];
  return [{
    id: "missing_inventory",
    title: "Inventory data unavailable — food cost estimated",
    severity: "low",
    financialImpact: null,
    explanation: "Food cost has been estimated using your configured target percentage because live inventory usage data is not available. Actual food cost may differ.",
    recommendedAction: "Sync inventory data or configure stock usage in ForgeStack to improve profit accuracy.",
    sourceData: "inventoryAvailable=false",
    category: "data",
  }];
}

// ── Rule: Stale sales data ────────────────────────────────────────────────────

function staleSalesRule(input: LeakInput): ProfitLeak[] {
  if (!input.salesStale) return [];
  return [{
    id: "stale_sales",
    title: "Sales data is stale — profit view degraded",
    severity: "medium",
    financialImpact: null,
    explanation: "The sales feed has not updated recently. Profit calculations are based on the last available snapshot and may not reflect current trading.",
    recommendedAction: "Check MICROS connection. If system is offline, manually enter today's sales to restore profit visibility.",
    sourceData: "salesFreshness=stale",
    category: "data",
  }];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function detectProfitLeaks(input: LeakInput): ProfitLeak[] {
  const leaks: ProfitLeak[] = [
    ...staleSalesRule(input),
    ...labourDragRule(input),
    ...revenueShortfallRule(input),
    ...foodCostRule(input),
    ...avgSpendRule(input),
    ...lowCoversRule(input),
    ...discountsRule(input),
    ...wasteRule(input),
    ...missingInventoryRule(input),
  ];

  // Sort: critical → high → medium → low
  const ORDER: Record<LeakSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return leaks.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
