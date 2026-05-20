/**
 * lib/profit/engine.ts
 *
 * Deterministic Profit Intelligence engine.
 *
 * Entry points:
 *   getProfitIntelligence(siteId, dateRange)     → ProfitIntelligenceResult
 *   getGroupProfitIntelligence(orgId, dateRange) → GroupProfitIntelligenceResult
 *
 * Data sourcing priority:
 *   1. Live MICROS sales data (micros_daily_totals / daily_ops_tracker)
 *   2. Manual sales uploads
 *   3. Forecast (fallback, clearly labelled)
 *
 * Labour sourced from daily_ops_tracker.
 * Food cost: inventory_usage if available, otherwise estimated from target %.
 * Overhead from profit_settings.daily_overhead_estimate.
 */

import { createServerClient } from "@/lib/supabase/server";
import { getSiteConfig } from "@/lib/config/site";
import { detectProfitLeaks } from "./leaks";
import type {
  ProfitIntelligenceResult,
  GroupProfitIntelligenceResult,
  ProfitBridge,
  ProfitBridgeLine,
  DataQuality,
  DataQualityFlag,
  ConfidenceLevel,
  ProfitAction,
  ProfitSettings,
  StoreProfitSummary,
  ProfitDateRange,
} from "./types";

// ── Date helpers ──────────────────────────────────────────────────────────────

function toDateRange(range: ProfitDateRange): { from: string; to: string } {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (range) {
    case "today":     return { from: fmt(today), to: fmt(today) };
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case "7d": {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      return { from: fmt(w), to: fmt(today) };
    }
    case "mtd": {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: fmt(m), to: fmt(today) };
    }
  }
}

// ── Profit settings loader ────────────────────────────────────────────────────

async function loadProfitSettings(siteId: string): Promise<ProfitSettings> {
  const supabase = createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("profit_settings")
    .select("*")
    .eq("site_id", siteId)
    .maybeSingle();

  // Fall back to site config if no profit_settings row exists
  const siteConfig = await getSiteConfig(siteId);

  return {
    siteId,
    targetFoodCostPct:      Number((data as Record<string,unknown> | null)?.target_food_cost_pct)  || 32,
    targetLabourPct:        Number((data as Record<string,unknown> | null)?.target_labour_pct)      || siteConfig.target_labour_pct || 30,
    dailyOverheadEstimate:  Number((data as Record<string,unknown> | null)?.daily_overhead_estimate) || 0,
    targetMarginPct:        Number((data as Record<string,unknown> | null)?.target_margin_pct)      || siteConfig.target_margin_pct || 12,
  };
}

// ── Sales data loader ─────────────────────────────────────────────────────────

interface SalesData {
  revenue: number | null;
  covers: number | null;
  avgSpend: number | null;
  discountsComps: number | null;
  isLive: boolean;
  isStale: boolean;
  lastUpdatedAt: string | null;
  /** loc_ref resolved from micros_connections (or sites.micros_location_ref) — threaded to labour loader */
  locRef: string | null;
}

async function loadSalesData(siteId: string, from: string, to: string): Promise<SalesData> {
  const supabase = createServerClient();

  // ── Step 1: Resolve MICROS connection for this site ───────────────────────
  // micros_connections has a site_id column (added via migration 057).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conn } = await (supabase as any)
    .from("micros_connections")
    .select("id, loc_ref")
    .eq("site_id", siteId)
    .eq("status", "connected")
    .maybeSingle() as { data: { id: string; loc_ref: string } | null };

  let connectionId: string | null = conn?.id ?? null;
  let locRef: string | null = conn?.loc_ref ?? null;

  // Fallback: try sites.micros_location_ref if no active connection found
  if (!locRef) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: siteRow } = await (supabase as any)
      .from("sites")
      .select("micros_location_ref")
      .eq("id", siteId)
      .maybeSingle() as { data: { micros_location_ref: string | null } | null };
    locRef = siteRow?.micros_location_ref ?? null;
  }

  // ── Step 2: Primary — micros_sales_daily (written by MICROS sync) ─────────
  if (connectionId || locRef) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseQuery = (supabase as any)
      .from("micros_sales_daily")
      .select("net_sales, guest_count, check_count, discounts, synced_at")
      .gte("business_date", from)
      .lte("business_date", to);

    const { data: micros } = connectionId
      ? await baseQuery.eq("connection_id", connectionId)
      : await baseQuery.eq("loc_ref", locRef);

    if (micros && (micros as Array<unknown>).length > 0) {
      const rows = micros as Array<Record<string, unknown>>;
      const revenue       = rows.reduce((s, r) => s + Number(r.net_sales   ?? 0), 0);
      const covers        = rows.reduce((s, r) => s + Number(r.guest_count ?? 0), 0);
      const discountsComps = rows.reduce((s, r) => s + Number(r.discounts  ?? 0), 0);
      // Pick the most recent synced_at across all rows
      const lastSync = rows.reduce<string | null>((latest, r) => {
        const synced = r.synced_at as string | null;
        if (!synced) return latest;
        return !latest || synced > latest ? synced : latest;
      }, null);
      const ageMs   = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity;
      const isStale = ageMs > 20 * 60 * 1000;

      return {
        revenue: revenue > 0 ? revenue : null,
        covers: covers > 0 ? covers : null,
        avgSpend: revenue > 0 && covers > 0 ? revenue / covers : null,
        discountsComps: discountsComps > 0 ? discountsComps : null,
        isLive: !isStale,
        isStale,
        lastUpdatedAt: lastSync ?? null,
        locRef,
      };
    }
  }

  // ── Step 3: Fallback — daily_summaries (manual uploads) ───────────────────
  const { data: summaries } = await supabase
    .from("daily_summaries")
    .select("total_revenue, covers, avg_spend")
    .eq("site_id", siteId)
    .gte("business_date", from)
    .lte("business_date", to);

  if (summaries && summaries.length > 0) {
    const rows = summaries as Array<Record<string, unknown>>;
    const revenue = rows.reduce((s, r) => s + Number(r.total_revenue ?? 0), 0);
    const covers  = rows.reduce((s, r) => s + Number(r.covers        ?? 0), 0);
    return {
      revenue: revenue > 0 ? revenue : null,
      covers: covers > 0 ? covers : null,
      avgSpend: revenue > 0 && covers > 0 ? revenue / covers : null,
      discountsComps: null,
      isLive: false,
      isStale: true,
      lastUpdatedAt: null,
      locRef,
    };
  }

  return { revenue: null, covers: null, avgSpend: null, discountsComps: null, isLive: false, isStale: true, lastUpdatedAt: null, locRef };
}

// ── Labour data loader ────────────────────────────────────────────────────────

interface LabourData {
  labourCost: number | null;
  labourPct: number | null;
  available: boolean;
}

async function loadLabourData(
  locRef: string | null,
  siteId: string,
  from: string,
  to: string,
  revenue: number | null,
): Promise<LabourData> {
  const supabase = createServerClient();

  // ── Primary: labour_daily_summary (MICROS timecards — written by labour sync) ─
  if (locRef) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: labSummary } = await (supabase as any)
      .from("labour_daily_summary")
      .select("total_pay, labour_pct")
      .eq("loc_ref", locRef)
      .gte("business_date", from)
      .lte("business_date", to) as { data: Array<Record<string, unknown>> | null };

    if (labSummary && labSummary.length > 0) {
      const labourCost = labSummary.reduce((s, r) => s + Number(r.total_pay ?? 0), 0);
      const labourPct  = revenue && revenue > 0 ? (labourCost / revenue) * 100 : null;
      return { labourCost: labourCost > 0 ? labourCost : null, labourPct, available: labourCost > 0 };
    }
  }

  // ── Fallback: daily_ops_tracker (legacy manual entry path) ────────────────
  const { data } = await supabase
    .from("daily_ops_tracker")
    .select("labour_cost, labour_pct")
    .eq("site_id", siteId)
    .gte("business_date", from)
    .lte("business_date", to);

  if (data && data.length > 0) {
    const rows = data as Array<Record<string, unknown>>;
    const labourCost = rows.reduce((s, r) => s + Number(r.labour_cost ?? 0), 0);
    const labourPct  = revenue && revenue > 0 ? (labourCost / revenue) * 100 : null;
    return { labourCost: labourCost > 0 ? labourCost : null, labourPct, available: labourCost > 0 };
  }

  return { labourCost: null, labourPct: null, available: false };
}

// ── Food cost / inventory loader ──────────────────────────────────────────────

interface FoodCostData {
  estimatedFoodCost: number | null;
  foodCostPct: number | null;
  estimatedWaste: number | null;
  inventoryAvailable: boolean;
  isEstimated: boolean;
}

async function loadFoodCostData(
  siteId: string,
  from: string,
  to: string,
  revenue: number | null,
  targetFoodCostPct: number,
): Promise<FoodCostData> {
  const supabase = createServerClient();

  // Try inventory usage
  const { data: inv } = await supabase
    .from("inventory_usage")
    .select("total_cost, waste_cost")
    .eq("site_id", siteId)
    .gte("usage_date", from)
    .lte("usage_date", to);

  if (inv && inv.length > 0) {
    const rows = inv as Array<Record<string, unknown>>;
    const foodCost  = rows.reduce((s, r) => s + Number(r.total_cost  ?? 0), 0);
    const wasteCost = rows.reduce((s, r) => s + Number(r.waste_cost  ?? 0), 0);
    const foodCostPct = revenue && revenue > 0 ? (foodCost / revenue) * 100 : null;
    return {
      estimatedFoodCost: foodCost > 0 ? foodCost : null,
      foodCostPct,
      estimatedWaste: wasteCost > 0 ? wasteCost : null,
      inventoryAvailable: true,
      isEstimated: false,
    };
  }

  // Fallback: estimate from target food cost pct
  if (revenue != null && revenue > 0) {
    const estFood  = (targetFoodCostPct / 100) * revenue;
    const estWaste = estFood * 0.05; // rough 5% waste estimate
    return {
      estimatedFoodCost: Math.round(estFood),
      foodCostPct: targetFoodCostPct,
      estimatedWaste: Math.round(estWaste),
      inventoryAvailable: false,
      isEstimated: true,
    };
  }

  return { estimatedFoodCost: null, foodCostPct: null, estimatedWaste: null, inventoryAvailable: false, isEstimated: true };
}

// ── Profit at risk ────────────────────────────────────────────────────────────

function calcProfitAtRisk(
  revenue: number | null,
  targetRevenue: number | null,
  labourCost: number | null,
  estimatedFoodCost: number | null,
  dailyOverhead: number,
): { profitAtRisk: number | null; explanation: string | null } {
  if (revenue == null || targetRevenue == null) return { profitAtRisk: null, explanation: null };

  const revenueShortfall = targetRevenue - revenue;
  if (revenueShortfall <= 0) return { profitAtRisk: null, explanation: null };

  // Fixed costs don't reduce proportionally — labour and overheads remain
  const fixedDrag = (labourCost ?? 0) + dailyOverhead;
  const variableCost = estimatedFoodCost ?? 0;
  const variableCostRate = revenue > 0 ? variableCost / revenue : 0;

  // Project profit at current pace vs target pace
  const projectedProfit = revenue - (labourCost ?? 0) - (estimatedFoodCost ?? 0) - dailyOverhead;
  const targetProfit = targetRevenue - fixedDrag - targetRevenue * variableCostRate;
  const profitAtRisk = Math.max(0, Math.round(targetProfit - projectedProfit));

  if (profitAtRisk <= 0) return { profitAtRisk: null, explanation: null };

  return {
    profitAtRisk,
    explanation: `R${profitAtRisk.toLocaleString()} profit at risk if revenue pace does not recover. Labour and overhead costs remain fixed while revenue falls short.`,
  };
}

// ── Profit bridge ─────────────────────────────────────────────────────────────

function buildProfitBridge(
  revenue: number | null,
  labourCost: number | null,
  estimatedFoodCost: number | null,
  estimatedWaste: number | null,
  dailyOverhead: number,
  foodCostIsEstimated: boolean,
): ProfitBridge {
  const lines: ProfitBridgeLine[] = [];

  if (revenue != null) {
    lines.push({ label: "Net Revenue", amount: revenue, isRevenue: true, isEstimated: false });
  }
  if (labourCost != null) {
    lines.push({ label: "Labour Cost", amount: -labourCost, isRevenue: false, isEstimated: false });
  }
  if (estimatedFoodCost != null) {
    lines.push({ label: foodCostIsEstimated ? "Food Cost (Estimated)" : "Food Cost", amount: -estimatedFoodCost, isRevenue: false, isEstimated: foodCostIsEstimated });
  }
  if (estimatedWaste != null && estimatedWaste > 0) {
    lines.push({ label: "Waste Estimate", amount: -estimatedWaste, isRevenue: false, isEstimated: true });
  }
  if (dailyOverhead > 0) {
    lines.push({ label: "Daily Overhead", amount: -dailyOverhead, isRevenue: false, isEstimated: false });
  }

  const operatingProfitEstimate =
    (revenue ?? 0) -
    (labourCost ?? 0) -
    (estimatedFoodCost ?? 0) -
    (estimatedWaste ?? 0) -
    dailyOverhead;

  return { lines, operatingProfitEstimate };
}

// ── Data quality assessment ───────────────────────────────────────────────────

function assessDataQuality(
  salesAvailable: boolean,
  labourAvailable: boolean,
  inventoryAvailable: boolean,
  foodCostEstimated: boolean,
  staleSales: boolean,
  dailyOverheadEstimate?: number,
): DataQuality {
  const flags: DataQualityFlag[] = [];
  let confidenceLevel: ConfidenceLevel = "high";

  if (!salesAvailable) {
    confidenceLevel = "low";
    flags.push({ key: "no_sales", message: "No sales data available — profit cannot be calculated.", severity: "critical" });
  } else if (staleSales) {
    confidenceLevel = confidenceLevel === "high" ? "medium" : confidenceLevel;
    flags.push({ key: "stale_sales", message: "Sales data is stale. Profit view may not reflect current trading.", severity: "warning" });
  }

  if (!labourAvailable) {
    confidenceLevel = confidenceLevel === "high" ? "medium" : confidenceLevel;
    flags.push({ key: "no_labour", message: "Labour cost unavailable. Margin calculation is partial.", severity: "warning" });
  }

  if (foodCostEstimated) {
    confidenceLevel = confidenceLevel === "high" ? "medium" : confidenceLevel;
    flags.push({ key: "food_cost_estimated", message: "Food cost estimated because inventory usage data is unavailable.", severity: "info" });
  }

  if (!inventoryAvailable) {
    flags.push({ key: "no_inventory", message: "Inventory data not connected. Food cost accuracy is limited.", severity: "info" });
  }

  if (foodCostEstimated && (dailyOverheadEstimate === undefined || dailyOverheadEstimate === 0)) {
    flags.push({
      key: "no_cost_targets",
      message: "Configure food cost and overhead targets to unlock full margin accuracy.",
      severity: "info",
    });
  }

  let summary: string;
  if (confidenceLevel === "high") {
    summary = "Profit estimate based on live sales and labour data";
  } else if (confidenceLevel === "medium") {
    summary = foodCostEstimated && labourAvailable
      ? "Profit estimate based on live sales and labour. Food cost is estimated."
      : staleSales
      ? "Profit view degraded because sales data is stale"
      : "Profit estimate based on partial data";
  } else {
    summary = "Profit Intelligence requires sales and labour data to calculate margin";
  }

  return {
    confidenceLevel,
    summary,
    flags,
    salesAvailable,
    labourAvailable,
    inventoryAvailable,
    foodCostEstimated,
    staleSales,
  };
}

// ── Recommended actions ───────────────────────────────────────────────────────

function buildRecommendedActions(
  leaks: ReturnType<typeof detectProfitLeaks>,
): ProfitAction[] {
  return leaks
    .filter((l) => l.category !== "data")
    .slice(0, 5)
    .map((leak, i) => ({
      id: `profit_action_${i}`,
      title: leak.recommendedAction.split(".")[0], // First sentence as title
      directInstruction: leak.recommendedAction,
      category: leak.category === "labour" ? "labour" :
                leak.category === "food_cost" ? "food_cost" :
                leak.category === "revenue" ? "revenue" : "operational",
      severity: leak.severity,
      expectedImpactText: leak.financialImpact
        ? `Recover up to R${Math.round(leak.financialImpact).toLocaleString()} in margin`
        : "Protect operating margin",
      expectedImpactValue: leak.financialImpact,
      leakId: leak.id,
    }));
}

// ── Main entry: getProfitIntelligence ─────────────────────────────────────────

export async function getProfitIntelligence(
  siteId: string,
  dateRange: ProfitDateRange = "today",
): Promise<ProfitIntelligenceResult> {
  const { from, to } = toDateRange(dateRange);

  const [siteConfig, settings] = await Promise.all([
    getSiteConfig(siteId),
    loadProfitSettings(siteId),
  ]);

  const sales = await loadSalesData(siteId, from, to);
  const labour = await loadLabourData(sales.locRef, siteId, from, to, sales.revenue);
  const foodCost = await loadFoodCostData(siteId, from, to, sales.revenue, settings.targetFoodCostPct);

  // P&L calculation
  const grossProfit =
    sales.revenue != null
      ? sales.revenue - (foodCost.estimatedFoodCost ?? 0)
      : null;

  const grossMarginPct =
    grossProfit != null && sales.revenue && sales.revenue > 0
      ? (grossProfit / sales.revenue) * 100
      : null;

  const operatingProfitEstimate =
    sales.revenue != null
      ? sales.revenue -
        (labour.labourCost ?? 0) -
        (foodCost.estimatedFoodCost ?? 0) -
        (foodCost.estimatedWaste ?? 0) -
        settings.dailyOverheadEstimate
      : null;

  // Profit at risk
  const targetRevenue =
    siteConfig.target_avg_spend && siteConfig.seating_capacity
      ? siteConfig.target_avg_spend * siteConfig.seating_capacity * 0.7 // 70% occupancy assumption
      : null;

  const { profitAtRisk, explanation: profitAtRiskExplanation } = calcProfitAtRisk(
    sales.revenue,
    targetRevenue,
    labour.labourCost,
    foodCost.estimatedFoodCost,
    settings.dailyOverheadEstimate,
  );

  const profitBridge = buildProfitBridge(
    sales.revenue,
    labour.labourCost,
    foodCost.estimatedFoodCost,
    foodCost.estimatedWaste,
    settings.dailyOverheadEstimate,
    foodCost.isEstimated,
  );

  const leaks = detectProfitLeaks({
    revenue: sales.revenue,
    targetRevenue,
    labourCost: labour.labourCost,
    labourPct: labour.labourPct,
    targetLabourPct: settings.targetLabourPct,
    estimatedFoodCost: foodCost.estimatedFoodCost,
    foodCostPct: foodCost.foodCostPct,
    targetFoodCostPct: settings.targetFoodCostPct,
    estimatedWaste: foodCost.estimatedWaste,
    discountsComps: sales.discountsComps,
    covers: sales.covers,
    targetCovers: siteConfig.seating_capacity ? siteConfig.seating_capacity * 0.7 : null,
    avgSpend: sales.avgSpend,
    targetAvgSpend: siteConfig.target_avg_spend,
    inventoryAvailable: foodCost.inventoryAvailable,
    salesStale: sales.isStale,
    foodCostEstimated: foodCost.isEstimated,
  });

  const recommendedActions = buildRecommendedActions(leaks);

  const dataQuality = assessDataQuality(
    sales.revenue != null,
    labour.available,
    foodCost.inventoryAvailable,
    foodCost.isEstimated,
    sales.isStale,
    settings.dailyOverheadEstimate,
  );

  return {
    siteId,
    siteName: siteConfig.site_name,
    dateRange,
    businessDate: from,
    revenue: sales.revenue,
    labourCost: labour.labourCost,
    labourPct: labour.labourPct,
    estimatedFoodCost: foodCost.estimatedFoodCost,
    foodCostPct: foodCost.foodCostPct,
    estimatedWaste: foodCost.estimatedWaste,
    discountsComps: sales.discountsComps,
    dailyOverhead: settings.dailyOverheadEstimate > 0 ? settings.dailyOverheadEstimate : null,
    grossProfit,
    grossMarginPct,
    operatingProfitEstimate,
    profitAtRisk,
    profitAtRiskExplanation,
    targetRevenue,
    targetMarginPct: settings.targetMarginPct,
    targetLabourPct: settings.targetLabourPct,
    targetFoodCostPct: settings.targetFoodCostPct,
    profitBridge,
    keyDrivers: leaks,
    recommendedActions,
    confidenceLevel: dataQuality.confidenceLevel,
    dataQuality,
    currencySymbol: siteConfig.currency_symbol,
  };
}

// ── Head Office: getGroupProfitIntelligence ───────────────────────────────────

export async function getGroupProfitIntelligence(
  orgId: string,
  dateRange: ProfitDateRange = "today",
): Promise<GroupProfitIntelligenceResult> {
  const supabase = createServerClient();

  // Get all sites for this org
  const { data: sitesData } = await supabase
    .from("sites")
    .select("id, name")
    .eq("org_id", orgId);

  const sites = (sitesData ?? []) as Array<{ id: string; name: string }>;

  const results = await Promise.allSettled(
    sites.map((s) => getProfitIntelligence(s.id, dateRange)),
  );

  const stores: StoreProfitSummary[] = results
    .map((r, i) => {
      if (r.status === "rejected") {
        return {
          siteId: sites[i].id,
          siteName: sites[i].name,
          revenue: null,
          grossMarginPct: null,
          labourPct: null,
          foodCostPct: null,
          operatingProfitEstimate: null,
          profitAtRisk: null,
          confidenceLevel: "low" as const,
          signal: "data_unavailable",
        };
      }

      const p = r.value;
      const signal =
        p.labourPct != null && p.labourPct > (p.targetLabourPct ?? 30) + 3
          ? "labour_drag"
          : p.foodCostPct != null && p.foodCostPct > (p.targetFoodCostPct ?? 32) + 2
          ? "food_cost_risk"
          : p.revenue != null && p.targetRevenue != null && p.revenue < p.targetRevenue * 0.90
          ? "revenue_shortfall"
          : p.grossMarginPct != null && p.grossMarginPct >= (p.targetMarginPct ?? 12)
          ? "margin_improved"
          : "on_target";

      return {
        siteId: p.siteId,
        siteName: p.siteName,
        revenue: p.revenue,
        grossMarginPct: p.grossMarginPct,
        labourPct: p.labourPct,
        foodCostPct: p.foodCostPct,
        operatingProfitEstimate: p.operatingProfitEstimate,
        profitAtRisk: p.profitAtRisk,
        confidenceLevel: p.confidenceLevel,
        signal,
      };
    });

  const validStores = stores.filter((s) => s.revenue != null);
  const totalRevenue = validStores.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const totalOperatingProfit = validStores.reduce((s, r) => s + (r.operatingProfitEstimate ?? 0), 0);
  const storesWithLabourDrag = stores.filter((s) => s.signal === "labour_drag").length;
  const storesWithFoodCostRisk = stores.filter((s) => s.signal === "food_cost_risk").length;
  const storesAtRisk = stores.filter((s) => s.profitAtRisk != null && s.profitAtRisk > 0).length;

  // Sort by operating profit estimate desc (nulls last)
  stores.sort((a, b) => {
    if (a.operatingProfitEstimate == null) return 1;
    if (b.operatingProfitEstimate == null) return -1;
    return b.operatingProfitEstimate - a.operatingProfitEstimate;
  });

  return {
    orgId,
    dateRange,
    stores,
    totalRevenue,
    totalOperatingProfit,
    storesWithLabourDrag,
    storesWithFoodCostRisk,
    storesAtRisk,
  };
}
