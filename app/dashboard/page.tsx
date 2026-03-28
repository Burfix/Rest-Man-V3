/**
 * ForgeStack Operating Brain v2 — Real-Time Operational Control System
 *
 * Layout:
 *   1. ControlBar           — revenue risk + time pressure + score strip
 *   2. OperatingScoreHero   — dominant visual center
 *   3. SinceLastCheck       — delta strip
 *   4. MainGrid:
 *      Primary:  CommandFeed (with execute buttons) → ServicePulse
 *      Secondary: BusinessStatusRail → FeedbackLoop → DataHealthWarning
 *   5. SecondaryDrilldowns  — reviews, maintenance, sales analytics
 */

import { getTodayBookingsSummary } from "@/services/ops/bookingsSummary";
import { getSevenDayReviewSummary } from "@/services/ops/reviewsSummary";
import { getLatestSalesSummary } from "@/services/ops/salesSummary";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { getUpcomingEvents } from "@/services/ops/eventsSummary";
import { getDataFreshnessSummary } from "@/services/ops/dataFreshness";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import { getMicrosStatus } from "@/services/micros/status";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { deriveMicrosIntegrationStatus, canUseMicrosLiveData } from "@/lib/integrations/status";
import { getOperatingScore } from "@/services/ops/operatingScore";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { getInventoryIntelligence } from "@/services/inventory/intelligence";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { evaluateOperations } from "@/services/decision-engine";
import { getServicePeriod } from "@/lib/commandCenter";
import { getSiteConfig } from "@/lib/config/site";
import { getUserContext } from "@/lib/auth/get-user-context";

import ControlBar              from "@/components/operating-brain/ControlBar";
import OperatingScoreHero     from "@/components/operating-brain/OperatingScoreHero";
import SinceLastCheck         from "@/components/operating-brain/SinceLastCheck";
import CommandFeed            from "@/components/operating-brain/CommandFeedV2";
import ServicePulse           from "@/components/operating-brain/ServicePulse";
import BusinessStatusRail     from "@/components/operating-brain/BusinessStatusRail";
import FeedbackLoop           from "@/components/operating-brain/FeedbackLoop";
import DataHealthWarning      from "@/components/operating-brain/DataHealthWarning";
import SecondaryInsights      from "@/components/dashboard/SecondaryInsights";

import type {
  TodayBookingsSummary,
  SevenDayReviewSummary,
  SalesSummary,
  MaintenanceSummary,
  VenueEvent,
  RevenueForecast,
  ComplianceSummary,
} from "@/types";
import type { MicrosStatusSummary } from "@/types/micros";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Settle helpers ─────────────────────────────────────────────────────────

function settled<T>(
  result: PromiseSettledResult<T>,
  fallback: T
): { value: T; error: string | null } {
  if (result.status === "fulfilled") return { value: result.value, error: null };
  const msg =
    result.reason instanceof Error ? result.reason.message : String(result.reason);
  return { value: fallback, error: msg };
}

const EMPTY_TODAY: TodayBookingsSummary = {
  total: 0,
  totalCovers: 0,
  largeBookings: 0,
  eventLinked: 0,
  escalationsToday: 0,
  bookings: [],
};

const EMPTY_REVIEWS: SevenDayReviewSummary = {
  byPlatform: [],
  overallAverage: 0,
  totalReviews: 0,
  positiveCount: 0,
  neutralCount: 0,
  negativeCount: 0,
  flaggedReviews: [],
};

const EMPTY_SALES: SalesSummary = { upload: null, topItems: [], bottomItems: [] };

const EMPTY_COMPLIANCE: ComplianceSummary = {
  total: 0,
  compliant: 0,
  scheduled: 0,
  due_soon: 0,
  expired: 0,
  unknown: 0,
  compliance_pct: 0,
  critical_items: [],
  due_soon_items: [],
  scheduled_items: [],
};

const EMPTY_MAINTENANCE: MaintenanceSummary = {
  totalEquipment: 0,
  openRepairs: 0,
  inProgress: 0,
  awaitingParts: 0,
  outOfService: 0,
  urgentIssues: [],
  resolvedThisWeek: 0,
  avgFixTimeDays: null,
  monthlyActualCost: null,
  topProblemAsset: null,
  foodSafetyRisks: 0,
  serviceDisruptions: 0,
  complianceRisks: 0,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function OperationsDashboard() {
  // ─── User context (site + org) ──────────────────────────────────────────
  const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";
  let siteId = DEFAULT_SITE_ID;
  let orgId: string | null = null;
  try {
    const ctx = await getUserContext();
    siteId = ctx.siteId;
    orgId = ctx.orgId;
  } catch {
    // Not authenticated (shouldn't happen behind middleware) — fall back to defaults
  }

  const [
    todayResult,
    reviewsResult,
    salesResult,
    maintenanceResult,
    eventsResult,
    freshnessResult,
    forecastResult,
    complianceResult,
    microsResult,
    inventoryResult,
    labourResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getSevenDayReviewSummary(),
    getLatestSalesSummary(),
    getMaintenanceSummary(),
    getUpcomingEvents(),
    getDataFreshnessSummary(),
    generateRevenueForecast(todayISO(), orgId ?? undefined),
    getComplianceSummary(),
    getMicrosStatus(),
    getInventoryIntelligence(siteId),
    // locRef resolved after micros status is fetched — use placeholder
    Promise.resolve(null as any),
  ]);

  const { value: today }                             = settled(todayResult, EMPTY_TODAY);
  const { value: reviews }                           = settled(reviewsResult, EMPTY_REVIEWS);
  const { value: maintenance }                       = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const { value: events }                            = settled(eventsResult, [] as VenueEvent[]);
  const { value: freshness }                         = settled(freshnessResult, null);
  const { value: forecast }                          = settled(forecastResult, null as RevenueForecast | null);
  const { value: complianceSummary }                 = settled(complianceResult, EMPTY_COMPLIANCE);
  const { value: microsStatus }                      = settled(microsResult, null);
  const { value: inventoryIntel }                    = settled(inventoryResult, null);

  // Resolve MICROS locRef from DB connection (not env var)
  const msConn = microsStatus as MicrosStatusSummary | null;
  const locRef = msConn?.connection?.loc_ref ?? process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "manual";
  let labourSummary = await getStoredDailySummary(locRef).catch(() => null);
  // Fall back to yesterday if today has no labour data yet
  if (!labourSummary || (labourSummary.totalLabourHours === 0 && labourSummary.activeStaffCount === 0)) {
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yDate = yest.toISOString().split("T")[0];
    const fallback = await getStoredDailySummary(locRef, yDate).catch(() => null);
    if (fallback && fallback.totalLabourHours > 0) labourSummary = fallback;
  }

  // ─── Unified sales snapshot (single source of truth for revenue) ─────────
  const today_iso = todayISO();
  const ms = microsStatus as MicrosStatusSummary | null;

  const salesSnapshot = await getCurrentSalesSnapshot(
    today_iso,
    ms,
    forecast,
    today.total,
    today.totalCovers,
    siteId,
  );

  // ─── Operating score ────────────────────────────────────────────────────
  const salesOverride = salesSnapshot.source !== "forecast"
    ? { netSales: salesSnapshot.netSales, targetSales: salesSnapshot.targetSales, dataDate: salesSnapshot.businessDate }
    : null;

  const operatingScore = await getOperatingScore(
    siteId,
    salesOverride,
    null,
    null,
    orgId ?? undefined,
  ).catch(() => null);

  // ─── Integration health ──────────────────────────────────────────────────
  const cfgStatus = getMicrosConfigStatus();
  const microsHealth = deriveMicrosIntegrationStatus(ms, cfgStatus.configured, cfgStatus.enabled);
  const microsLiveData = canUseMicrosLiveData(microsHealth);

  const servicePeriod = getServicePeriod("Africa/Johannesburg");

  // ─── Site config (single source of truth for targets) ────────────────────
  const siteConfig = await getSiteConfig(siteId);

  // ─── Compute freshness ages ──────────────────────────────────────────────
  const now = Date.now();
  const salesAgeMinutes = salesSnapshot.freshnessMinutes ?? undefined;
  const labourAgeMinutes = labourSummary?.lastSyncAt
    ? Math.round((now - new Date(labourSummary.lastSyncAt).getTime()) / 60_000)
    : undefined;
  // Only report inventory freshness when automated sync is active;
  // otherwise stale manual-count timestamps permanently trigger "critical"
  const imEnabled = process.env.MICROS_IM_ENABLED === "true";
  const inventoryAgeMinutes = imEnabled && inventoryIntel?.lastSynced
    ? Math.round((now - new Date(inventoryIntel.lastSynced).getTime()) / 60_000)
    : undefined;

  // ─── Labour % ────────────────────────────────────────────────────────────────────
  const labourPct = labourSummary?.labourPercentOfSales
    ?? salesSnapshot.labourCostPercent
    ?? 0;

  // ─── Decision Engine — single evaluation pass ───────────────────────────
  const engineOutput = evaluateOperations({
    revenue: {
      actual: salesSnapshot.netSales,
      target: salesSnapshot.targetSales ?? 0,
      variancePercent: (salesSnapshot.targetSales ?? 0) > 0
        ? ((salesSnapshot.netSales - salesSnapshot.targetSales!) / salesSnapshot.targetSales!) * 100
        : 0,
      covers: salesSnapshot.covers,
      avgSpend: salesSnapshot.covers > 0 ? salesSnapshot.netSales / salesSnapshot.covers : 0,
    },
    labour: {
      labourPercent: labourPct,
      targetPercent: siteConfig.target_labour_pct,
      activeStaff: labourSummary?.activeStaffCount ?? undefined,
      syncAgeMinutes: labourAgeMinutes,
    },
    inventory: {
      criticalCount: inventoryIntel?.criticalItems.length ?? 0,
      lowCount: inventoryIntel?.lowItems.length ?? 0,
      noOpenPOCount: inventoryIntel?.noPOItems.length ?? 0,
      atRiskItems: inventoryIntel
        ? [...inventoryIntel.criticalItems, ...inventoryIntel.lowItems].slice(0, 5).map((item) => {
            const mi = inventoryIntel.menuImpact.find((m) => m.ingredientId === item.id);
            return {
              name: item.name,
              affectedMenuItems: mi?.affectedDishes,
              severity: item.risk_level === "critical" ? "critical" as const : "warning" as const,
            };
          })
        : undefined,
      syncAgeMinutes: inventoryAgeMinutes,
    },
    maintenance: {
      openIssues: maintenance.openRepairs,
      urgentIssues: maintenance.urgentIssues.length,
      topIssue: maintenance.topProblemAsset ?? maintenance.urgentIssues[0]?.unit_name ?? undefined,
      serviceBlocking: maintenance.serviceDisruptions > 0,
    },
    compliance: {
      score: complianceSummary.compliance_pct,
      currentPercent: complianceSummary.compliance_pct,
      renewalsScheduled: complianceSummary.scheduled,
      criticalMissing: complianceSummary.expired,
    },
    forecast: {
      peakWindow: undefined,
      forecastSales: forecast?.forecast_sales ?? undefined,
      forecastCovers: forecast?.forecast_covers ?? undefined,
      actualVsForecastPercent: forecast?.sales_gap_pct != null ? -forecast.sales_gap_pct : undefined,
      confidence: forecast?.confidence,
      timeToPeakMinutes: undefined,
    },
    bookings: {
      lunchBookings: today.total > 0 ? Math.floor(today.total * 0.4) : undefined,
      dinnerBookings: today.total > 0 ? Math.ceil(today.total * 0.6) : undefined,
    },
    freshness: {
      salesAgeMinutes,
      labourAgeMinutes,
      inventoryAgeMinutes,
    },
  });

  const scoreTotal = operatingScore?.total ?? engineOutput.operatingScoreBreakdown.reduce((s, b) => s + b.score, 0);

  const barStatus = engineOutput.operatingCommandBar.status;
  const revenueVariance = (salesSnapshot.targetSales ?? 0) > 0
    ? ((salesSnapshot.netSales - salesSnapshot.targetSales!) / salesSnapshot.targetSales!) * 100
    : 0;

  // Determine top risk for hero
  const topRisk = engineOutput.commandFeed.length > 0
    ? engineOutput.commandFeed[0].title
    : undefined;

  return (
    <div className="space-y-4">

      {/* ── 1. Control Bar — Revenue Risk | Time Pressure | Score ── */}
      <ControlBar
        revenueAtRisk={engineOutput.operatingCommandBar.revenueAtRisk ?? 0}
        variancePercent={revenueVariance}
        timePressure={engineOutput.operatingCommandBar.timeToPeakLabel ?? servicePeriod}
        score={scoreTotal}
        status={barStatus}
        servicePeriod={servicePeriod}
      />

      {/* ── 2. Operating Score Hero — Dominant Visual Center ── */}
      <div className="flex justify-center py-2">
        <OperatingScoreHero
          score={scoreTotal}
          status={barStatus}
          issueCount={engineOutput.operatingCommandBar.issueCount}
          topRisk={topRisk}
        />
      </div>

      {/* ── 3. Since Last Check ── */}
      <SinceLastCheck items={engineOutput.sinceLastCheck} />

      {/* ── 4. Main Grid: Primary + Secondary ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* Primary Column (dominant) */}
        <div className="lg:col-span-8 space-y-4">
          <CommandFeed decisions={engineOutput.commandFeed} />
          <ServicePulse
            actual={salesSnapshot.netSales}
            target={salesSnapshot.targetSales ?? 0}
            variancePercent={revenueVariance}
            covers={salesSnapshot.covers}
            avgSpend={salesSnapshot.covers > 0 ? salesSnapshot.netSales / salesSnapshot.covers : 0}
            peakWindow={undefined}
            timeToPeakMinutes={null}
            forecastCovers={forecast?.forecast_covers}
            insights={engineOutput.servicePulseInsights}
            isLive={salesSnapshot.isLive}
            source={salesSnapshot.source}
            sourceNote={salesSnapshot.notes?.[0]}
          />
        </div>

        {/* Secondary Column */}
        <div className="lg:col-span-4 space-y-4">
          <BusinessStatusRail status={engineOutput.businessStatus} />
          <FeedbackLoop />
          <DataHealthWarning health={engineOutput.dataHealth} />
        </div>
      </div>

      {/* ── 5. Secondary Drilldowns (below fold) ── */}
      <SecondaryInsights
        reviews={reviews}
        maintenance={maintenance}
        hasEquipment={maintenance.totalEquipment > 0}
        hasReviews={reviews.totalReviews > 0}
      />
    </div>
  );
}




