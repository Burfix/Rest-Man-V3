/**
 * lib/profit/types.ts
 *
 * All TypeScript types for the Profit Intelligence module.
 * Client-facing — describes a restaurant operator's business performance,
 * NOT ForgeStack's internal billing.
 */

// ── Date range ────────────────────────────────────────────────────────────────

export type ProfitDateRange = "today" | "yesterday" | "7d" | "mtd";

// ── Confidence & data quality ────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DataQualityFlag {
  key: string;
  /** Human-readable explanation of what's missing or degraded */
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface DataQuality {
  confidenceLevel: ConfidenceLevel;
  /** One-line summary shown in the header */
  summary: string;
  flags: DataQualityFlag[];
  salesAvailable: boolean;
  labourAvailable: boolean;
  inventoryAvailable: boolean;
  foodCostEstimated: boolean;
  staleSales: boolean;
}

// ── Profit Bridge (waterfall) ─────────────────────────────────────────────────

export interface ProfitBridgeLine {
  label: string;
  amount: number;
  /** true = revenue (positive bar), false = deduction (negative bar) */
  isRevenue: boolean;
  isEstimated: boolean;
}

export interface ProfitBridge {
  lines: ProfitBridgeLine[];
  operatingProfitEstimate: number;
}

// ── Profit Leaks ─────────────────────────────────────────────────────────────

export type LeakSeverity = "critical" | "high" | "medium" | "low";

export interface ProfitLeak {
  id: string;
  title: string;
  severity: LeakSeverity;
  /** Estimated financial impact in currency units */
  financialImpact: number | null;
  explanation: string;
  recommendedAction: string;
  /** Which data point triggered this — for traceability */
  sourceData: string;
  category: "labour" | "revenue" | "food_cost" | "waste" | "covers" | "discounts" | "data";
}

// ── Recommended Actions ───────────────────────────────────────────────────────

export interface ProfitAction {
  id: string;
  title: string;
  directInstruction: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  expectedImpactText: string;
  /** Estimated impact value in currency */
  expectedImpactValue: number | null;
  /** Linked profit leak id */
  leakId?: string;
}

// ── Core profit result ────────────────────────────────────────────────────────

export interface ProfitIntelligenceResult {
  siteId: string;
  siteName: string;
  dateRange: ProfitDateRange;
  businessDate: string;

  // ── P&L metrics
  revenue: number | null;
  labourCost: number | null;
  labourPct: number | null;
  estimatedFoodCost: number | null;
  foodCostPct: number | null;
  estimatedWaste: number | null;
  discountsComps: number | null;
  dailyOverhead: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  operatingProfitEstimate: number | null;

  // ── Risk
  profitAtRisk: number | null;
  profitAtRiskExplanation: string | null;

  // ── Targets
  targetRevenue: number | null;
  targetMarginPct: number | null;
  targetLabourPct: number | null;
  targetFoodCostPct: number | null;

  // ── Analysis
  profitBridge: ProfitBridge;
  keyDrivers: ProfitLeak[];
  recommendedActions: ProfitAction[];

  // ── Data quality
  confidenceLevel: ConfidenceLevel;
  dataQuality: DataQuality;

  currencySymbol: string;
}

// ── Head Office multi-store ───────────────────────────────────────────────────

export interface StoreProfitSummary {
  siteId: string;
  siteName: string;
  revenue: number | null;
  grossMarginPct: number | null;
  labourPct: number | null;
  foodCostPct: number | null;
  operatingProfitEstimate: number | null;
  profitAtRisk: number | null;
  confidenceLevel: ConfidenceLevel;
  /** "margin_improved" | "labour_drag" | "food_cost_risk" | "revenue_shortfall" | "on_target" */
  signal: string;
}

export interface GroupProfitIntelligenceResult {
  orgId: string;
  dateRange: ProfitDateRange;
  stores: StoreProfitSummary[];
  totalRevenue: number;
  totalOperatingProfit: number;
  storesWithLabourDrag: number;
  storesWithFoodCostRisk: number;
  storesAtRisk: number;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface ProfitSettings {
  siteId: string;
  targetFoodCostPct: number;
  targetLabourPct: number;
  dailyOverheadEstimate: number;
  targetMarginPct: number;
}
