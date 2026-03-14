/**
 * Operations Command Dashboard — the primary manager landing page.
 * "Mission Control" layout with 5 prioritised zones.
 */

import { getTodayBookingsSummary } from "@/services/ops/bookingsSummary";
import { getSevenDayReviewSummary } from "@/services/ops/reviewsSummary";
import { getLatestSalesSummary } from "@/services/ops/salesSummary";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { getUpcomingEvents } from "@/services/ops/eventsSummary";
import { getPriorityAlerts } from "@/services/ops/priorityAlerts";
import { getDailyOperationsDashboardSummary } from "@/services/ops/dailyOperationsSummary";
import { getDataFreshnessSummary } from "@/services/ops/dataFreshness";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getActiveAlerts } from "@/services/alerts/engine";
import { getComplianceSummary } from "@/services/ops/complianceSummary";

import AlertsSection from "@/components/dashboard/ops/AlertsSection";
import FreshnessBar from "@/components/dashboard/ops/FreshnessBar";
import OperationalAlertsPanel from "@/components/dashboard/ops/OperationalAlertsPanel";

import CommandStatusBar        from "@/components/dashboard/ops/CommandStatusBar";
import PrimaryKpiCards         from "@/components/dashboard/ops/PrimaryKpiCards";
import AttentionPanel          from "@/components/dashboard/ops/AttentionPanel";
import TodayOpsPanel           from "@/components/dashboard/ops/TodayOpsPanel";
import MaintenanceBoardPreview from "@/components/dashboard/ops/MaintenanceBoardPreview";
import ComplianceTimeline      from "@/components/dashboard/ops/ComplianceTimeline";
import SecondaryInsights       from "@/components/dashboard/SecondaryInsights";

import {
  buildPriorityActions,
  getServicePeriod,
} from "@/lib/commandCenter";

import {
  TodayBookingsSummary,
  SevenDayReviewSummary,
  SalesSummary,
  MaintenanceSummary,
  VenueEvent,
  PriorityAlert,
  DailyOperationsDashboardSummary,
  RevenueForecast,
  OperationalAlert,
  ComplianceSummary,
} from "@/types";
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
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function OperationsDashboard() {
  const [
    todayResult,
    reviewsResult,
    salesResult,
    maintenanceResult,
    eventsResult,
    alertsResult,
    dailyOpsResult,
    freshnessResult,
    forecastResult,
    opsAlertsResult,
    complianceResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getSevenDayReviewSummary(),
    getLatestSalesSummary(),
    getMaintenanceSummary(),
    getUpcomingEvents(),
    getPriorityAlerts(),
    getDailyOperationsDashboardSummary(),
    getDataFreshnessSummary(),
    generateRevenueForecast(todayISO()),
    getActiveAlerts(),
    getComplianceSummary(),
  ]);

  const { value: today, error: todayErr } = settled(todayResult, EMPTY_TODAY);
  const { value: reviews, error: reviewsErr } = settled(reviewsResult, EMPTY_REVIEWS);
  const { value: sales, error: salesErr } = settled(salesResult, EMPTY_SALES);
  const { value: maintenance, error: maintenanceErr } = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const { value: events, error: eventsErr } = settled(eventsResult, [] as VenueEvent[]);
  const { value: alerts, error: alertsErr } = settled(alertsResult, [] as PriorityAlert[]);
  const { value: dailyOps, error: dailyOpsErr } = settled(dailyOpsResult, EMPTY_DAILY_OPS);
  const { value: freshness } = settled(freshnessResult, null);
  const { value: forecast } = settled(forecastResult, null as RevenueForecast | null);
  const { value: opsAlerts } = settled(opsAlertsResult, [] as OperationalAlert[]);
  const { value: complianceSummary } = settled(complianceResult, EMPTY_COMPLIANCE);

  const errors = [todayErr, reviewsErr, salesErr, maintenanceErr, eventsErr, alertsErr, dailyOpsErr].filter(
    Boolean
  ) as string[];

  // ─── Command Center computations ────────────────────────────────────────
  const today_iso      = todayISO();
  const servicePeriod  = getServicePeriod("Africa/Johannesburg");
  const actions        = buildPriorityActions({
    compliance: complianceSummary,
    maintenance,
    forecast,
    dailyOps,
    reviews,
    events,
    today: today_iso,
  });

  return (
    <div className="space-y-6">
      {/* ── Command Status Bar ── */}
      <CommandStatusBar
        date={today_iso}
        servicePeriod={servicePeriod}
        compliance={complianceSummary}
        maintenance={maintenance}
        forecast={forecast}
        dailyOps={dailyOps}
        events={events}
        today={today}
        opsAlerts={opsAlerts}
      />

      {/* ── Data freshness bar ── */}
      {freshness && <FreshnessBar freshness={freshness} />}

      {/* ── DB errors (non-fatal) ── */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Some sections could not load:</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Operational Alerts ── */}
      <OperationalAlertsPanel initialAlerts={opsAlerts} />

      {/* ── Priority Alerts ── */}
      <AlertsSection alerts={alerts} />

      {/* ── Primary KPI Cards ── */}
      <PrimaryKpiCards
        compliance={complianceSummary}
        maintenance={maintenance}
        forecast={forecast}
        today={today}
        events={events}
        dailyOps={dailyOps}
        date={today_iso}
      />

      {/* ── Attention Panel ── */}
      <AttentionPanel actions={actions} />

      {/* ── Today's Operations Panel ── */}
      <TodayOpsPanel
        today={today}
        events={events}
        dailyOps={dailyOps}
        maintenance={maintenance}
        date={today_iso}
      />

      {/* ── Maintenance Board Preview ── */}
      <MaintenanceBoardPreview maintenance={maintenance} />

      {/* ── Compliance Timeline ── */}
      <ComplianceTimeline compliance={complianceSummary} />

      {/* ── Secondary Intelligence ── */}
      <SecondaryInsights
        reviews={reviews}
        sales={sales}
        dailyOps={dailyOps}
        maintenance={maintenance}
        hasEquipment={maintenance.totalEquipment > 0}
        hasSales={sales.upload !== null}
        hasReviews={reviews.totalReviews > 0}
        hasDailyOps={dailyOps.latestReport !== null}
      />
    </div>
  );
}
