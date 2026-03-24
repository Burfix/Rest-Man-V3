/**
 * ForgeStack Operating Brain — GM daily operations command surface.
 *
 * Layout (6 zones, top-to-bottom priority order):
 *   0. OperatingBrainHeader   — venue identity + service period + alerts
 *   1. Operating Cockpit      — 3-col: Glance | CommandFeed | BusinessStatus
 *   2. DataHealthIndicator    — compact data freshness
 *   3. ForecastWindowCard     — next 2 hours predictive insight
 *   4. RecommendedActionsQueue — execution queue (Now/Shift/Today/Week)
 *   5. SecondaryInsights      — reviews, maintenance, setup (below fold)
 */

import { getTodayBookingsSummary } from "@/services/ops/bookingsSummary";
import { getSevenDayReviewSummary } from "@/services/ops/reviewsSummary";
import { getLatestSalesSummary } from "@/services/ops/salesSummary";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { getUpcomingEvents } from "@/services/ops/eventsSummary";
import { getDailyOperationsDashboardSummary } from "@/services/ops/dailyOperationsSummary";
import { getDataFreshnessSummary } from "@/services/ops/dataFreshness";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import { getMicrosStatus } from "@/services/micros/status";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { deriveMicrosIntegrationStatus, canUseMicrosLiveData } from "@/lib/integrations/status";
import { getOperatingScore } from "@/services/ops/operatingScore";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getInventoryIntelligence } from "@/services/inventory/intelligence";

import OperatingBrainHeader    from "@/components/dashboard/ops/OperatingBrainHeader";
import TodayAtAGlancePanel     from "@/components/dashboard/ops/TodayAtAGlancePanel";
import CommandFeed             from "@/components/dashboard/ops/CommandFeed";
import BusinessStatusRail      from "@/components/dashboard/ops/BusinessStatusRail";
import DataHealthIndicator     from "@/components/dashboard/ops/DataHealthIndicator";
import CommandHeadlineBanner   from "@/components/dashboard/ops/CommandHeadlineBanner";
import ForecastWindowCard      from "@/components/dashboard/ops/ForecastWindowCard";
import RecommendedActionsQueue from "@/components/dashboard/ops/RecommendedActionsQueue";
import InventoryStatusWidget   from "@/components/dashboard/ops/InventoryStatusWidget";
import SecondaryInsights       from "@/components/dashboard/SecondaryInsights";
import ManualSalesUploadForm   from "@/components/dashboard/ops/ManualSalesUploadForm";
import SalesSyncButton         from "@/components/dashboard/ops/SalesSyncButton";

import {
  getServicePeriod,
  buildPriorityActions,
  generateCommandHeadline,
  generateConfidenceSummary,
  generateTwoHourOutlook,
  computeRevenueTrend,
  computeLabourTrend,
} from "@/lib/commandCenter";

import { toCommandFeedItems } from "@/types/operating-brain";
import type { StatusItem } from "@/components/dashboard/ops/BusinessStatusRail";

import type {
  TodayBookingsSummary,
  SevenDayReviewSummary,
  SalesSummary,
  MaintenanceSummary,
  VenueEvent,
  DailyOperationsDashboardSummary,
  RevenueForecast,
  ComplianceSummary,
} from "@/types";
import type { MicrosStatusSummary } from "@/types/micros";
import { todayISO, cn } from "@/lib/utils";

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

const EMPTY_DAILY_OPS: DailyOperationsDashboardSummary = {
  latestReport: null,
  reportDate: null,
  uploadedAt: null,
};

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
  const [
    todayResult,
    reviewsResult,
    salesResult,
    maintenanceResult,
    eventsResult,
    dailyOpsResult,
    freshnessResult,
    forecastResult,
    complianceResult,
    microsResult,
    inventoryResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getSevenDayReviewSummary(),
    getLatestSalesSummary(),
    getMaintenanceSummary(),
    getUpcomingEvents(),
    getDailyOperationsDashboardSummary(),
    getDataFreshnessSummary(),
    generateRevenueForecast(todayISO()),
    getComplianceSummary(),
    getMicrosStatus(),
    getInventoryIntelligence(),
  ]);

  const { value: today, error: todayErr }           = settled(todayResult, EMPTY_TODAY);
  const { value: reviews, error: reviewsErr }       = settled(reviewsResult, EMPTY_REVIEWS);
  const { value: sales, error: salesErr }           = settled(salesResult, EMPTY_SALES);
  const { value: maintenance, error: maintenanceErr } = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const { value: events, error: eventsErr }         = settled(eventsResult, [] as VenueEvent[]);
  const { value: dailyOps, error: dailyOpsErr }     = settled(dailyOpsResult, EMPTY_DAILY_OPS);
  const { value: freshness }                        = settled(freshnessResult, null);
  const { value: forecast }                         = settled(forecastResult, null as RevenueForecast | null);
  const { value: complianceSummary }                = settled(complianceResult, EMPTY_COMPLIANCE);
  const { value: microsStatus }                     = settled(microsResult, null);
  const { value: inventoryIntel }                   = settled(inventoryResult, null);

  // ─── Unified sales snapshot (single source of truth for revenue UI) ──────
  const today_iso     = todayISO();
  const ms = microsStatus as MicrosStatusSummary | null;

  const salesSnapshot = await getCurrentSalesSnapshot(
    today_iso,
    ms,
    forecast,
    today.total,
    today.totalCovers,
  );

  // ─── Live labour data from MICROS sync ───────────────────────────────────
  const microsCfg = getMicrosEnvConfig();
  const labourSummary = microsCfg.enabled && microsCfg.locRef
    ? await getStoredDailySummary(microsCfg.locRef, today_iso).catch(() => null)
    : null;

  // ─── Operating score (needs salesOverride + labourOverride) ───────────────
  const salesOverride = salesSnapshot.source !== "forecast"
    ? { netSales: salesSnapshot.netSales, targetSales: salesSnapshot.targetSales, dataDate: salesSnapshot.businessDate }
    : null;

  const labourOverride = labourSummary?.labourPercentOfSales != null
    ? {
        labourPct:    labourSummary.labourPercentOfSales,
        totalPay:     labourSummary.totalLabourCost,
        totalHours:   labourSummary.totalLabourHours,
        activeStaff:  labourSummary.activeStaffCount,
      }
    : null;

  // ─── Inventory intelligence param (for command center functions) ──────────
  const inventoryOverride = inventoryIntel
    ? {
        riskScore:     inventoryIntel.riskScore,
        criticalCount: inventoryIntel.criticalItems.length,
        lowCount:      inventoryIntel.lowItems.length,
        healthyCount:  inventoryIntel.healthyCount,
        totalItems:    inventoryIntel.totalItems,
        noPOCount:     inventoryIntel.noPOItems.length,
      }
    : null;

  const inventoryIntelParam = inventoryIntel
    ? {
        criticalCount:        inventoryIntel.criticalItems.length,
        lowCount:             inventoryIntel.lowItems.length,
        healthyCount:         inventoryIntel.healthyCount,
        noPOCount:            inventoryIntel.noPOItems.length,
        totalItems:           inventoryIntel.totalItems,
        riskScore:            inventoryIntel.riskScore,
        estimatedLostRevenue: inventoryIntel.estimatedLostRevenue,
        topRisks: [...inventoryIntel.criticalItems, ...inventoryIntel.lowItems].slice(0, 5).map((item) => {
          const menuImpact = inventoryIntel.menuImpact.find((m) => m.ingredientId === item.id);
          return {
            name:           item.name,
            riskLevel:      item.risk_level,
            stockOnHand:    item.current_stock,
            threshold:      item.minimum_threshold,
            unit:           item.unit,
            supplier:       item.supplier_name,
            hasOpenPO:      !inventoryIntel.noPOItems.some((npo) => npo.id === item.id),
            affectedDishes: menuImpact?.affectedDishes ?? [],
          };
        }),
      }
    : null;

  const operatingScore = await getOperatingScore(
    "00000000-0000-0000-0000-000000000001",
    salesOverride,
    labourOverride,
    inventoryOverride,
  ).catch(() => null);

  const errors = [todayErr, reviewsErr, salesErr, maintenanceErr, eventsErr, dailyOpsErr]
    .filter(Boolean) as string[];

  // ─── Command Center computations ─────────────────────────────────────────
  const servicePeriod = getServicePeriod("Africa/Johannesburg");

  // Ranked priority actions from all operational signals
  const priorityActions = buildPriorityActions({
    compliance:  complianceSummary,
    maintenance,
    forecast,
    dailyOps,
    reviews,
    events,
    today:       today_iso,
    labourPctOverride: labourSummary?.labourPercentOfSales ?? null,
    inventoryIntel: inventoryIntelParam,
  });

  const commandHeadline = generateCommandHeadline({
    compliance:    complianceSummary,
    maintenance,
    forecast,
    dailyOps,
    today:         { total: today.total, totalCovers: today.totalCovers },
    servicePeriod,
    labourPctOverride: labourSummary?.labourPercentOfSales ?? null,
    inventoryIntel: inventoryIntelParam,
  });

  // ─── Central integration health — SINGLE SOURCE OF TRUTH ─────────────────
  //  Fail closed: any ambiguous state → isLiveDataAvailable = false
  const cfgStatus    = getMicrosConfigStatus();
  const microsHealth = deriveMicrosIntegrationStatus(
    ms,
    cfgStatus.configured,
    cfgStatus.enabled,
  );
  const microsLiveData = canUseMicrosLiveData(microsHealth);

  const confidenceSummary = generateConfidenceSummary({
    microsStatus: ms ? {
      isConfigured:        ms.isConfigured,
      isLiveDataAvailable: microsLiveData,
      minutesSinceSync:    ms.minutesSinceSync ?? null,
      lastSyncError:       ms.connection?.last_sync_error ?? null,
    } : null,
    dailyOps,
    today: today_iso,
    labourLive: labourSummary != null && !labourSummary.isStale,
  });

  const twoHourOutlook = generateTwoHourOutlook({
    forecast,
    dailyOps,
    today:         { total: today.total, totalCovers: today.totalCovers },
    servicePeriod,
    inventoryIntel: inventoryIntelParam,
  });

  const revenueTrend = computeRevenueTrend(forecast);
  const labourTrend  = computeLabourTrend(labourSummary?.labourPercentOfSales ?? dailyOps.latestReport?.labor_cost_percent ?? null);

  const totalAlerts = priorityActions.filter(
    (a) => a.severity === "critical" || a.severity === "urgent"
  ).length;

  // ─── Operating Brain derived values ───────────────────────────────────────

  // Risk level — derived from operating score + critical actions
  const riskLevel =
    totalAlerts >= 3 || (operatingScore && operatingScore.total < 40) ? "critical" as const :
    totalAlerts >= 1 || (operatingScore && operatingScore.total < 55) ? "elevated" as const :
    (operatingScore && operatingScore.total < 70) ? "moderate" as const :
    "low" as const;

  // Day summary — plain English sentence
  const daySummary = commandHeadline.text;

  // Last sync label
  const lastSyncLabel =
    salesSnapshot.freshnessMinutes != null
      ? salesSnapshot.freshnessMinutes < 1 ? "just now"
        : salesSnapshot.freshnessMinutes < 60 ? `${salesSnapshot.freshnessMinutes}m ago`
        : `${Math.floor(salesSnapshot.freshnessMinutes / 60)}h ago`
      : "unknown";

  // Labour sync age label
  const labourSyncAge = labourSummary?.lastSyncAt
    ? (() => {
        const mins = Math.floor((Date.now() - new Date(labourSummary.lastSyncAt!).getTime()) / 60_000);
        return mins < 1 ? "now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
      })()
    : null;

  // Command feed items — transformed from priority actions
  const feedItems = toCommandFeedItems(priorityActions);

  // ─── Business Status Rail items ──────────────────────────────────────────

  const laborPct = labourSummary?.labourPercentOfSales ?? dailyOps.latestReport?.labor_cost_percent ?? null;
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;

  /** Compact currency formatter */
  function compactZAR(v: number): string {
    if (v >= 1_000_000) return `R ${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000)    return `R ${Math.round(v / 1_000)}K`;
    if (v >= 1_000)     return `R ${(v / 1_000).toFixed(1)}K`;
    return `R ${Math.round(v)}`;
  }

  const businessItems: StatusItem[] = [
    {
      key:     "revenue",
      label:   "Revenue",
      metric:  salesSnapshot ? compactZAR(salesSnapshot.netSales) : forecast ? compactZAR(forecast.forecast_sales) : "—",
      subtext: salesSnapshot?.targetVariancePercent != null
        ? salesSnapshot.targetVariancePercent >= 0 ? "On target" : `${Math.abs(salesSnapshot.targetVariancePercent).toFixed(0)}% behind`
        : "No target set",
      tone:    salesSnapshot?.targetVariancePercent == null ? "neutral"
        : salesSnapshot.targetVariancePercent >= 0 ? "good"
        : Math.abs(salesSnapshot.targetVariancePercent) >= 20 ? "danger" : "warning",
      href:    "/dashboard/sales",
      trend:   revenueTrend ?? undefined,
      sourceType: salesSnapshot.source === "micros" && salesSnapshot.isLive ? "micros_live"
        : salesSnapshot.source === "manual" ? "manual_upload"
        : undefined,
    },
    {
      key:     "labour",
      label:   "Labour",
      metric:  laborPct != null ? `${laborPct.toFixed(1)}%` : "—",
      subtext: laborPct == null ? "No data" : laborPct <= 30 ? "Within range" : laborPct <= 45 ? "Elevated" : "High — act now",
      tone:    laborPct == null ? "neutral" : laborPct <= 35 ? "good" : laborPct <= 45 ? "warning" : "danger",
      href:    "/dashboard/labour",
      trend:   labourTrend ?? undefined,
    },
    {
      key:     "inventory",
      label:   "Inventory",
      metric:  inventoryIntelParam ? String(inventoryIntelParam.criticalCount + inventoryIntelParam.lowCount) : "—",
      metricSub: inventoryIntelParam ? "at risk" : undefined,
      subtext: !inventoryIntelParam ? "No items" : inventoryIntelParam.criticalCount > 0 ? `${inventoryIntelParam.criticalCount} stockout` : inventoryIntelParam.lowCount > 0 ? `${inventoryIntelParam.lowCount} low` : "All healthy",
      tone:    !inventoryIntelParam ? "neutral" : inventoryIntelParam.criticalCount > 0 ? "danger" : inventoryIntelParam.lowCount > 0 ? "warning" : "good",
      href:    "/dashboard/inventory",
    },
    {
      key:     "maintenance",
      label:   "Maintenance",
      metric:  maintenance.totalEquipment > 0 ? String(totalOpen) : "—",
      metricSub: totalOpen === 1 ? "issue" : totalOpen > 1 ? "issues" : undefined,
      subtext: maintenance.outOfService > 0 ? `${maintenance.outOfService} OOS` : totalOpen > 0 ? `${maintenance.totalEquipment} tracked` : maintenance.totalEquipment > 0 ? "All operational" : "Not tracked",
      tone:    maintenance.outOfService > 0 ? "danger" : totalOpen > 0 ? "warning" : maintenance.totalEquipment > 0 ? "good" : "neutral",
      href:    "/dashboard/maintenance",
    },
    {
      key:     "compliance",
      label:   "Compliance",
      metric:  complianceSummary.total > 0 ? `${complianceSummary.compliance_pct}%` : "—",
      subtext: complianceSummary.expired > 0 ? `${complianceSummary.expired} expired` : complianceSummary.due_soon > 0 ? `${complianceSummary.due_soon} due soon` : complianceSummary.total > 0 ? "All current" : "None tracked",
      tone:    complianceSummary.expired > 0 ? "danger" : complianceSummary.due_soon > 0 ? "warning" : complianceSummary.total > 0 ? "good" : "neutral",
      href:    "/dashboard/compliance",
    },
    {
      key:     "bookings",
      label:   "Today",
      metric:  String(today.total),
      metricSub: today.total === 1 ? "booking" : "bookings",
      subtext: today.total > 0 ? `${today.totalCovers} covers confirmed` : "Walk-in trade",
      tone:    today.total > 0 ? "good" : "warning",
      href:    "/dashboard/bookings",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">

      {/* ── 0. Operating Brain Header ── */}
      <OperatingBrainHeader
        venueName="Si Cantina Sociale"
        date={today_iso}
        servicePeriod={servicePeriod}
        alertCount={totalAlerts}
      />

      {/* ── 1. Operating Cockpit — 3-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">

        {/* LEFT: Today at a Glance */}
        <div className="order-2 lg:order-1 lg:col-span-3">
          <TodayAtAGlancePanel
            score={operatingScore}
            riskLevel={riskLevel}
            servicePeriod={servicePeriod}
            lastSync={lastSyncLabel}
            daySummary={daySummary}
          />
        </div>

        {/* CENTER: Command Feed (main focal point — shown first on mobile) */}
        <div className="order-1 lg:order-2 lg:col-span-5">
          <CommandFeed items={feedItems} maxVisible={5} />
        </div>

        {/* RIGHT: Business Status */}
        <div className="order-3 lg:order-3 lg:col-span-4">
          <BusinessStatusRail items={businessItems} />
        </div>
      </div>

      {/* ── Command Headline ── */}
      <CommandHeadlineBanner headline={commandHeadline} confidence={confidenceSummary} />

      {/* ── 2. Data Health ── */}
      {freshness && (
        <DataHealthIndicator
          freshness={freshness}
          microsIsLive={microsLiveData}
          labourSyncAge={labourSyncAge ?? undefined}
        />
      )}

      {/* ── Live sales strip — when MICROS or manual data is available ── */}
      {salesSnapshot.source !== "forecast" && (
        <div className={cn(
          "flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 rounded-xl border px-4 sm:px-5 py-2.5 sm:py-3 text-xs",
          salesSnapshot.isLive
            ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/10"
            : salesSnapshot.isStale
            ? "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/10"
            : "border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/50",
        )}>
          <span className={cn(
            "flex items-center gap-1.5 font-semibold",
            salesSnapshot.isLive ? "text-emerald-700 dark:text-emerald-400" : salesSnapshot.isStale ? "text-amber-700 dark:text-amber-400" : "text-stone-600 dark:text-stone-400",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              salesSnapshot.isLive ? "bg-emerald-500 animate-pulse" : salesSnapshot.isStale ? "bg-amber-400" : "bg-stone-400",
            )} />
            {salesSnapshot.sourceLabel}
            {salesSnapshot.freshnessMinutes != null && (
              salesSnapshot.freshnessMinutes < 1 ? " · now"
              : salesSnapshot.freshnessMinutes < 60 ? ` · ${salesSnapshot.freshnessMinutes}m ago`
              : ` · ${Math.floor(salesSnapshot.freshnessMinutes / 60)}h ago`
            )}
          </span>
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <span className="text-stone-600 dark:text-stone-400">Sales: <span className="font-semibold text-stone-900 dark:text-stone-100">R {salesSnapshot.netSales.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span></span>
          <span className="text-stone-600 dark:text-stone-400">Covers: <span className="font-semibold text-stone-900 dark:text-stone-100">{salesSnapshot.covers}</span></span>
          <span className="text-stone-600 dark:text-stone-400">Checks: <span className="font-semibold text-stone-900 dark:text-stone-100">{salesSnapshot.checks}</span></span>
          {salesSnapshot.labourCostPercent != null && salesSnapshot.labourCostPercent > 0 && (
            <span className="text-stone-600 dark:text-stone-400">Labour: <span className={cn("font-semibold", salesSnapshot.labourCostPercent > 50 ? "text-amber-700 dark:text-amber-400" : "text-stone-900 dark:text-stone-100")}>{salesSnapshot.labourCostPercent.toFixed(1)}%</span></span>
          )}
          <SalesSyncButton microsConfigured={cfgStatus.configured && cfgStatus.enabled} compact />
        </div>
      )}

      {/* ── Manual sales upload prompt — when no live/manual data ── */}
      {salesSnapshot.source === "forecast" && (
        <div className="flex flex-col gap-2">
          <ManualSalesUploadForm businessDate={today_iso} />
          <SalesSyncButton microsConfigured={cfgStatus.configured && cfgStatus.enabled} />
        </div>
      )}

      {/* ── Non-fatal DB errors ── */}
      {errors.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 px-5 py-3.5 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-semibold">Some sections could not load:</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 3. Forecast Window ── */}
      <ForecastWindowCard outlook={twoHourOutlook} />

      {/* ── 4. Recommended Actions Queue ── */}
      <RecommendedActionsQueue actions={priorityActions} />

      {/* ── Inventory Status ── */}
      {inventoryIntel && inventoryIntel.totalItems > 0 && (
        <InventoryStatusWidget inventory={inventoryIntel} />
      )}

      {/* ── 5. Secondary Intelligence (below fold) ── */}
      <SecondaryInsights
        reviews={reviews}
        maintenance={maintenance}
        hasEquipment={maintenance.totalEquipment > 0}
        hasReviews={reviews.totalReviews > 0}
      />

    </div>
  );
}


