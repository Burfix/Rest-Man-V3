/**
 * Operations Command Dashboard — GM daily operations command center.
 *
 * Layout (7 zones, top-to-bottom priority order):
 *   1. DashboardTopBar     — identity + service period + 5 KPI tiles
 *   2. FreshnessBar        — data recency indicators
 *   3. CriticalActionsPanel — ranked morning briefing (action-first)
 *   4. Risk + Brief grid   — OperationalRiskCard | ServiceBriefCard
 *   5. Today + Health grid — TodayAtVenueCard   | OperationalHealthCard
 *   6. SecondaryInsights   — reviews, sales, ops analytics (below fold)
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

import FreshnessBar          from "@/components/dashboard/ops/FreshnessBar";
import CommandHeadlineBanner from "@/components/dashboard/ops/CommandHeadlineBanner";
import DashboardTopBar       from "@/components/dashboard/ops/DashboardTopBar";
import CriticalActionsPanel  from "@/components/dashboard/ops/CriticalActionsPanel";
import TwoHourOutlookPanel   from "@/components/dashboard/ops/TwoHourOutlook";
import OperationalRiskCard   from "@/components/dashboard/ops/OperationalRiskCard";
import ServiceBriefCard      from "@/components/dashboard/ops/ServiceBriefCard";
import TodayAtVenueCard      from "@/components/dashboard/ops/TodayAtVenueCard";
import OperationalHealthCard from "@/components/dashboard/ops/OperationalHealthCard";
import SecondaryInsights     from "@/components/dashboard/SecondaryInsights";

import {
  getServicePeriod,
  buildPriorityActions,
  generateCommandHeadline,
  generateConfidenceSummary,
  generateTwoHourOutlook,
  computeRevenueTrend,
  computeLabourTrend,
} from "@/lib/commandCenter";

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

const EMPTY_DAILY_OPS: DailyOperationsDashboardSummary = {
  latestReport: null,
  reportDate: null,
  uploadedAt: null,
};

const EMPTY_COMPLIANCE: ComplianceSummary = {
  total: 0,
  compliant: 0,
  due_soon: 0,
  expired: 0,
  unknown: 0,
  compliance_pct: 0,
  critical_items: [],
  due_soon_items: [],
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

  const errors = [todayErr, reviewsErr, salesErr, maintenanceErr, eventsErr, dailyOpsErr]
    .filter(Boolean) as string[];

  // ─── Command Center computations ─────────────────────────────────────────
  const today_iso     = todayISO();
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
  });

  const commandHeadline = generateCommandHeadline({
    compliance:    complianceSummary,
    maintenance,
    forecast,
    dailyOps,
    today:         { total: today.total, totalCovers: today.totalCovers },
    servicePeriod,
  });

  const ms = microsStatus as MicrosStatusSummary | null;

  const confidenceSummary = generateConfidenceSummary({
    microsStatus: ms ? {
      isConfigured:     ms.isConfigured,
      minutesSinceSync: ms.minutesSinceSync ?? null,
      lastSyncError:    ms.connection?.last_sync_error ?? null,
    } : null,
    dailyOps,
    today: today_iso,
  });

  const twoHourOutlook = generateTwoHourOutlook({
    forecast,
    dailyOps,
    today:         { total: today.total, totalCovers: today.totalCovers },
    servicePeriod,
  });

  const revenueTrend = computeRevenueTrend(forecast);
  const labourTrend  = computeLabourTrend(dailyOps.latestReport?.labor_cost_percent ?? null);

  const totalAlerts = priorityActions.filter(
    (a) => a.severity === "critical" || a.severity === "urgent"
  ).length;

  return (
    <div className="space-y-5">

      {/* ── 1. Operations Command Bar ── */}
      <DashboardTopBar
        date={today_iso}
        servicePeriod={servicePeriod}
        compliance={complianceSummary}
        maintenance={maintenance}
        forecast={forecast}
        dailyOps={dailyOps}
        events={events}
        today={today}
        totalAlerts={totalAlerts}
        microsStatus={ms ? {
          isConfigured:     ms.isConfigured,
          minutesSinceSync: ms.minutesSinceSync ?? null,
          lastSyncError:    ms.connection?.last_sync_error ?? null,
        } : null}
        revenueTrend={revenueTrend}
        labourTrend={labourTrend}
      />

      {/* ── 2. Data Freshness Row ── */}
      {freshness && <FreshnessBar freshness={freshness} />}

      {/* ── Command Headline ── */}
      <CommandHeadlineBanner headline={commandHeadline} confidence={confidenceSummary} />

      {/* ── Two-Hour Outlook ── */}
      <TwoHourOutlookPanel outlook={twoHourOutlook} />

      {/* ── MICROS live revenue strip — shown only when synced today ── */}
      {(() => {
        const ms = microsStatus as MicrosStatusSummary | null;
        const ld = ms?.latestDailySales;
        const todayDate = today_iso;
        if (!ld || ld.business_date !== todayDate) return null;
        const mins = ms?.minutesSinceSync;
        const ageLabel = mins == null ? "" : mins < 1 ? " · now" : mins < 60 ? ` · ${mins}m ago` : ` · ${Math.floor(mins / 60)}h ago`;
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs">
            <span className="flex items-center gap-1 font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              MICROS Live{ageLabel}
            </span>
            <span className="text-stone-400">·</span>
            <span className="text-stone-600">Sales: <span className="font-semibold text-stone-900">R {ld.net_sales.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span></span>
            <span className="text-stone-600">Covers: <span className="font-semibold text-stone-900">{ld.guest_count}</span></span>
            <span className="text-stone-600">Checks: <span className="font-semibold text-stone-900">{ld.check_count}</span></span>
            {ld.labor_pct > 0 && (
              <span className="text-stone-600">Labour: <span className={`font-semibold ${ld.labor_pct > 50 ? "text-amber-700" : "text-stone-900"}`}>{ld.labor_pct.toFixed(1)}%</span></span>
            )}
          </div>
        );
      })()}

      {/* ── Non-fatal DB errors ── */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-semibold">Some sections could not load:</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 3. Critical Actions — GM Morning Briefing ── */}
      <CriticalActionsPanel actions={priorityActions} />

      {/* ── 4. Operational Risk + Service Brief ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OperationalRiskCard
          compliance={complianceSummary}
          maintenance={maintenance}
        />
        <ServiceBriefCard
          today={today}
          events={events}
          forecast={forecast}
          dailyOps={dailyOps}
          date={today_iso}
          servicePeriod={servicePeriod}
        />
      </div>

      {/* ── 5. Today at Venue + Operational Health ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TodayAtVenueCard
          today={today}
          events={events}
          dailyOps={dailyOps}
          maintenance={maintenance}
          date={today_iso}
          forecast={forecast}
          microsSource={ms?.isConfigured ? "micros_live" : null}
          microsSyncedAt={ms?.connection?.last_sync_at ?? null}
        />
        <OperationalHealthCard
          compliance={complianceSummary}
          maintenance={maintenance}
          forecast={forecast}
          reviews={reviews}
          dailyOps={dailyOps}
          microsStatus={ms ? {
            isConfigured:     ms.isConfigured,
            minutesSinceSync: ms.minutesSinceSync ?? null,
            lastSyncError:    ms.connection?.last_sync_error ?? null,
          } : undefined}
          freshness={freshness ? {
            sales:  freshness.sales  ? { lastUpdated: freshness.sales.lastUpdatedAt,  stale: freshness.sales.stale }  : null,
            labour: freshness.dailyOps ? { lastUpdated: freshness.dailyOps.lastUpdatedAt, stale: freshness.dailyOps.stale } : null,
          } : undefined}
        />
      </div>

      {/* ── 6. Secondary Intelligence (below fold) ── */}
      <SecondaryInsights
        reviews={reviews}
        maintenance={maintenance}
        hasEquipment={maintenance.totalEquipment > 0}
        hasReviews={reviews.totalReviews > 0}
      />

    </div>
  );
}


