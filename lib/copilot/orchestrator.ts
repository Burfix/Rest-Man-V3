/**
 * GM Co-Pilot Orchestrator
 *
 * runCopilot() — single entry point that assembles the full CopilotOutput.
 *
 * Fetches all upstream data, runs each engine, returns the complete
 * output package that the page consumes.
 */

import { getTodayBookingsSummary } from "@/services/ops/bookingsSummary";
import { getLatestSalesSummary } from "@/services/ops/salesSummary";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { getDailyOperationsDashboardSummary } from "@/services/ops/dailyOperationsSummary";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import { getMicrosStatus } from "@/services/micros/status";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { getInventoryIntelligence } from "@/services/inventory/intelligence";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { todayISO } from "@/lib/utils";

import { getServiceWindow } from "./service-window";
import { getServiceState } from "./service-state";
import { mapServiceToRevenue } from "./service-impact";
import { generateGMBrief } from "./gm-brief";
import { generateGMInsights } from "./gm-insights";
import { generateGMDecisions } from "./gm-decisions";
import { getDecisionTrustState } from "./data-trust";
import { getCopilotOperatingScore } from "./operating-score";
import { getServiceScore } from "./service-score";

import type { CopilotOutput } from "./types";
import type {
  TodayBookingsSummary,
  SalesSummary,
  MaintenanceSummary,
  DailyOperationsDashboardSummary,
  RevenueForecast,
  ComplianceSummary,
} from "@/types";
import type { MicrosStatusSummary } from "@/types/micros";

// ── Fallback defaults ─────────────────────────────────────────────────────

const EMPTY_TODAY: TodayBookingsSummary = {
  total: 0, totalCovers: 0, largeBookings: 0, eventLinked: 0,
  escalationsToday: 0, bookings: [],
};
const EMPTY_SALES: SalesSummary = { upload: null, topItems: [], bottomItems: [] };
const EMPTY_DAILY_OPS: DailyOperationsDashboardSummary = {
  latestReport: null, reportDate: null, uploadedAt: null,
};
const EMPTY_COMPLIANCE: ComplianceSummary = {
  total: 0, compliant: 0, scheduled: 0, due_soon: 0, expired: 0, unknown: 0,
  compliance_pct: 0, critical_items: [], due_soon_items: [], scheduled_items: [],
};
const EMPTY_MAINTENANCE: MaintenanceSummary = {
  totalEquipment: 0, openRepairs: 0, inProgress: 0, awaitingParts: 0,
  outOfService: 0, urgentIssues: [], resolvedThisWeek: 0, avgFixTimeDays: null,
  monthlyActualCost: null, topProblemAsset: null, foodSafetyRisks: 0,
  serviceDisruptions: 0, complianceRisks: 0,
};

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

// ── Configuration ─────────────────────────────────────────────────────────

const TARGET_LABOUR_PCT = 32;
const TARGET_AVG_SPEND = 280;
const SEATING_CAPACITY = 200;

// ══════════════════════════════════════════════════════════════════════════
// Main Orchestrator
// ══════════════════════════════════════════════════════════════════════════

export async function runCopilot(): Promise<CopilotOutput> {
  const now = new Date();
  const today_iso = todayISO();

  // ── 1. Parallel data fetch ────────────────────────────────────────────
  const [
    todayResult, maintenanceResult, dailyOpsResult,
    forecastResult, complianceResult, microsResult,
    inventoryResult, labourResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getMaintenanceSummary(),
    getDailyOperationsDashboardSummary(),
    generateRevenueForecast(today_iso),
    getComplianceSummary(),
    getMicrosStatus(),
    getInventoryIntelligence(),
    getStoredDailySummary(
      process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "manual"
    ),
  ]);

  const today = settled(todayResult, EMPTY_TODAY);
  const maintenance = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const dailyOps = settled(dailyOpsResult, EMPTY_DAILY_OPS);
  const forecast = settled(forecastResult, null as RevenueForecast | null);
  const complianceSummary = settled(complianceResult, EMPTY_COMPLIANCE);
  const microsStatus = settled(microsResult, null) as MicrosStatusSummary | null;
  const inventoryIntel = settled(inventoryResult, null);
  const labourSummary = settled(labourResult, null);

  // ── 2. Unified sales snapshot ─────────────────────────────────────────
  const salesSnapshot = await getCurrentSalesSnapshot(
    today_iso, microsStatus, forecast,
    today.total, today.totalCovers,
  );

  // ── 3. Derived metrics ────────────────────────────────────────────────
  const nowMs = Date.now();
  const salesAgeMinutes = salesSnapshot.freshnessMinutes ?? null;
  const labourAgeMinutes = labourSummary?.lastSyncAt
    ? Math.round((nowMs - new Date(labourSummary.lastSyncAt).getTime()) / 60_000)
    : null;
  const inventoryAgeMinutes = inventoryIntel?.lastSynced
    ? Math.round((nowMs - new Date(inventoryIntel.lastSynced).getTime()) / 60_000)
    : null;
  const dailyOpsAgeDays = dailyOps.reportDate
    ? Math.round((nowMs - new Date(dailyOps.reportDate).getTime()) / 86_400_000)
    : null;

  const labourPct = labourSummary?.labourPercentOfSales
    ?? salesSnapshot.labourCostPercent
    ?? dailyOps.latestReport?.labor_cost_percent
    ?? 0;

  const netSales = salesSnapshot.netSales;
  const targetSales = salesSnapshot.targetSales ?? forecast?.forecast_sales ?? 0;
  const covers = salesSnapshot.covers;
  const forecastCovers = forecast?.forecast_covers ?? today.totalCovers;
  const avgSpend = covers > 0 ? netSales / covers : 0;
  const activeStaff = labourSummary?.activeStaffCount ?? null;

  const bookedCovers = today.totalCovers;
  const walkInCovers = Math.max(0, covers - bookedCovers);
  const revenueGap = Math.max(0, targetSales - netSales);
  const revenueVariancePct = targetSales > 0
    ? ((netSales - targetSales) / targetSales) * 100
    : 0;

  const criticalStockCount = inventoryIntel?.criticalItems.length ?? 0;
  const lowStockCount = inventoryIntel?.lowItems.length ?? 0;
  const noPOCount = inventoryIntel?.noPOItems.length ?? 0;

  // ── 4. Service window ────────────────────────────────────────────────
  const windowInfo = getServiceWindow(now);

  // ── 5. Service state ─────────────────────────────────────────────────
  const serviceState = getServiceState({
    avgSpend,
    targetAvgSpend: TARGET_AVG_SPEND,
    covers,
    forecastCovers,
    bookingsToday: today.total,
    bookedCovers,
    walkInCovers,
    tableTurnEstimate: null,
    activeStaff,
    seatingCapacity: SEATING_CAPACITY,
    revenueActual: netSales,
    revenueTarget: targetSales,
    labourPercent: labourPct,
  });

  // ── 6. Service-to-revenue impact ─────────────────────────────────────
  const serviceImpact = mapServiceToRevenue(serviceState, {
    actualRevenue: netSales,
    targetRevenue: targetSales,
    avgSpend,
    targetAvgSpend: TARGET_AVG_SPEND,
    covers,
    forecastCovers,
    bookedCovers,
  });

  // ── 7. GM Decisions ──────────────────────────────────────────────────
  const decisions = generateGMDecisions({
    serviceWindow: windowInfo.window,
    serviceState,
    revenueActual: netSales,
    revenueTarget: targetSales,
    revenueGap,
    labourPercent: labourPct,
    targetLabourPercent: TARGET_LABOUR_PCT,
    activeStaff,
    covers,
    forecastCovers,
    avgSpend,
    targetAvgSpend: TARGET_AVG_SPEND,
    bookingsToday: today.total,
    bookedCovers,
    walkInCovers,
    criticalStockCount,
    lowStockCount,
    noPOCount,
    maintenanceUrgent: maintenance.urgentIssues.length,
    maintenanceServiceBlocking: maintenance.serviceDisruptions > 0,
    complianceExpired: complianceSummary.expired,
    complianceDueSoon: complianceSummary.due_soon,
    salesAgeMinutes,
    labourAgeMinutes,
    dailyOpsAgeDays,
  });

  // ── 8. GM Brief ──────────────────────────────────────────────────────
  const brief = generateGMBrief({
    serviceWindow: windowInfo.window,
    serviceState,
    serviceImpact,
    revenueActual: netSales,
    revenueTarget: targetSales,
    labourPercent: labourPct,
    coversActual: covers,
    coversForecast: forecastCovers,
    avgSpend,
    stockRisks: criticalStockCount + lowStockCount,
    maintenanceUrgent: maintenance.urgentIssues.length,
    complianceExpired: complianceSummary.expired,
    decisions,
  });

  // ── 9. GM Insights ───────────────────────────────────────────────────
  const insights = generateGMInsights({
    revenueActual: netSales,
    revenueTarget: targetSales,
    revenueVariancePercent: revenueVariancePct,
    avgSpend,
    targetAvgSpend: TARGET_AVG_SPEND,
    covers,
    forecastCovers,
    labourPercent: labourPct,
    targetLabourPercent: TARGET_LABOUR_PCT,
    activeStaff,
    bookingsToday: today.total,
    bookedCovers,
    walkInCovers,
    criticalStockCount,
    lowStockCount,
    noPOCount,
    maintenanceOpen: maintenance.openRepairs,
    maintenanceUrgent: maintenance.urgentIssues.length,
    maintenanceRepeatIssues: 0,
    complianceExpired: complianceSummary.expired,
    complianceDueSoon: complianceSummary.due_soon,
    salesAgeMinutes,
    labourAgeMinutes,
    dailyOpsAgeDays,
    floorEnergyScore: serviceState.signals.floorEnergyScore,
    upsellRate: serviceState.signals.upsellRate,
    walkInConversionRate: serviceState.signals.walkInConversionRate,
    tableTurnRate: serviceState.signals.tableTurnRate,
  });

  // ── 10. Data trust ───────────────────────────────────────────────────
  const trustState = getDecisionTrustState({
    salesAgeMinutes,
    labourAgeMinutes,
    inventoryAgeMinutes,
    dailyOpsAgeDays,
    reviewsAgeDays: null,
    bookingsLive: today.total > 0,
  });

  // ── 11. Operating score ──────────────────────────────────────────────
  const operatingScore = getCopilotOperatingScore({
    serviceState,
    revenueActual: netSales,
    revenueTarget: targetSales,
    labourPercent: labourPct,
    targetLabourPercent: TARGET_LABOUR_PCT,
    criticalStockCount,
    lowStockCount,
    maintenanceUrgent: maintenance.urgentIssues.length,
    maintenanceServiceBlocking: maintenance.serviceDisruptions > 0,
    complianceExpired: complianceSummary.expired,
    complianceDueSoon: complianceSummary.due_soon,
  });

  // ── 12. Service score (gamification) ─────────────────────────────────
  const serviceScore = getServiceScore({
    signals: serviceState.signals,
    avgSpendVsTargetRatio: targetSales > 0
      ? avgSpend / TARGET_AVG_SPEND
      : 1,
    reviewSentimentPct: 75, // TODO: wire real review data
  });

  // ── Return full output ───────────────────────────────────────────────
  return {
    brief,
    serviceState,
    serviceImpact,
    serviceScore,
    insights,
    decisions,
    trustState,
    operatingScore,
    generatedAt: now.toISOString(),
  };
}
