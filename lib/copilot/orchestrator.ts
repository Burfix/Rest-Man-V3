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
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import { getMicrosStatus } from "@/services/micros/status";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { todayISO } from "@/lib/utils";
import { getSiteConfig } from "@/lib/config/site";
import { persistDecisions, supersedeOldDecisions } from "./decision-store";

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

// ── Configuration (from database) ─────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════
// Main Orchestrator
// ══════════════════════════════════════════════════════════════════════════

export async function runCopilot(siteId: string): Promise<CopilotOutput> {
  const now = new Date();
  const today_iso = todayISO();

  // ── 0. Load site config (replaces hardcoded constants) ─────────────────────
  const cfg = await getSiteConfig(siteId);
  const TARGET_LABOUR_PCT = cfg.target_labour_pct;
  const TARGET_AVG_SPEND = cfg.target_avg_spend;
  const SEATING_CAPACITY = cfg.seating_capacity;

  // ── 1. Parallel data fetch ────────────────────────────────────────────
  const [
    todayResult, maintenanceResult,
    forecastResult, complianceResult, microsResult,
    labourResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getMaintenanceSummary(cfg.site_id),
    generateRevenueForecast(today_iso),
    getComplianceSummary(),
    getMicrosStatus(),
    getStoredDailySummary(
      process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "manual"
    ),
  ]);

  const today = settled(todayResult, EMPTY_TODAY);
  const maintenance = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const forecast = settled(forecastResult, null as RevenueForecast | null);
  const complianceSummary = settled(complianceResult, EMPTY_COMPLIANCE);
  const microsStatus = settled(microsResult, null) as MicrosStatusSummary | null;
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

  const labourPct = labourSummary?.labourPercentOfSales
    ?? salesSnapshot.labourCostPercent
    ?? 0;

  const netSales = salesSnapshot.netSales;
  const targetSales = salesSnapshot.targetSales ?? forecast?.forecast_sales ?? 0;
  const labourReliabilityNote = netSales < 5000
    ? "Labour % unreliable — insufficient revenue data"
    : null;
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
    maintenanceUrgent: maintenance.urgentIssues.length,
    maintenanceServiceBlocking: maintenance.serviceDisruptions > 0,
    complianceExpired: complianceSummary.expired,
    complianceDueSoon: complianceSummary.due_soon,
    salesAgeMinutes,
    labourAgeMinutes,
  });

  // ── 8. GM Brief ──────────────────────────────────────────────────────
  const brief = generateGMBrief({
    serviceWindow: windowInfo.window,
    serviceState,
    serviceImpact,
    revenueActual: netSales,
    revenueTarget: targetSales,
    labourPercent: labourPct,
    targetLabourPercent: TARGET_LABOUR_PCT,
    labourReliabilityNote,
    coversActual: covers,
    coversForecast: forecastCovers,
    avgSpend,
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
    maintenanceOpen: maintenance.openRepairs,
    maintenanceUrgent: maintenance.urgentIssues.length,
    maintenanceRepeatIssues: 0,
    complianceExpired: complianceSummary.expired,
    complianceDueSoon: complianceSummary.due_soon,
    salesAgeMinutes,
    labourAgeMinutes,
    floorEnergyScore: serviceState.signals.floorEnergyScore,
    upsellRate: serviceState.signals.upsellRate,
    walkInConversionRate: serviceState.signals.walkInConversionRate,
    tableTurnRate: serviceState.signals.tableTurnRate,
  });

  // ── 10. Data trust ───────────────────────────────────────────────────
  const trustState = getDecisionTrustState({
    salesAgeMinutes,
    labourAgeMinutes,
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
    maintenanceUrgent: maintenance.urgentIssues.length,
    maintenanceHighCount: maintenance.urgentIssues.filter((i) => i.priority === "high").length,
    maintenanceMediumCount: 0,  // summary doesn't track medium separately; medium not in urgentIssues
    maintenanceOpenCount: maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts,
    maintenanceServiceBlocking: maintenance.serviceDisruptions > 0,
    maintenanceOldestOpenDays: 0,  // summary doesn't carry age; brain context-builder handles this
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

  // ── 13. Persist decisions (async, non-blocking) ───────────────────────

  persistDecisions(decisions, siteId).then((idMap) => {
    if (idMap.size > 0) {
      const currentHashes = Array.from(idMap.values());
      supersedeOldDecisions(siteId, currentHashes).catch(() => {});
    }
  }).catch(() => {});

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
