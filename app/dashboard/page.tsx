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
import { getUserContext, AuthError } from "@/lib/auth/get-user-context";
import { runOperatingBrain } from "@/services/brain/operating-brain";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AccountabilityAlert from "@/components/accountability/AccountabilityAlert";
import HeroStrip         from "@/components/brain/HeroStrip";
import PriorityActionBoard, { type DutiesData } from "@/components/brain/PriorityActionBoard";
import CommandFeed            from "@/components/operating-brain/CommandFeedV2";
import ServicePulse           from "@/components/operating-brain/ServicePulse";
import BusinessStatusRail, { type PredictiveSignals } from "@/components/operating-brain/BusinessStatusRail";
import FeedbackLoop, { type FeedbackLoopProps }  from "@/components/operating-brain/FeedbackLoop";
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
  const ctx = await getUserContext().catch((err: unknown) => {
    if (err instanceof AuthError && err.statusCode === 401) redirect("/login");
    return null;
  });

  if (!ctx?.siteId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">No site assigned. Contact your administrator.</p>
      </div>
    );
  }

  const { siteId, orgId } = ctx;

  // Start brain in parallel (runs alongside main data fetches)
  const brainPromise = runOperatingBrain(siteId, todayISO());

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
    getSevenDayReviewSummary(siteId),
    getLatestSalesSummary(),
    getMaintenanceSummary(siteId),
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

  // Build labour override from labour_daily_summary (primary source)
  const labourScoreOverride = labourSummary?.labourPercentOfSales != null
    ? {
        labourPct:   labourSummary.labourPercentOfSales,
        totalPay:    labourSummary.totalLabourCost,
        totalHours:  labourSummary.totalLabourHours,
        activeStaff: labourSummary.activeStaffCount,
      }
    : null;

  // Await brain early so we can use its connection flags in BOTH the score engine
  // AND the decision engine — single source of truth for POS connection state.
  // Brain was started in parallel at the top of the function, so this adds no latency.
  const brain = await brainPromise.catch(() => null);

  // POS connection flags (from brain's context-builder, which is site-specific).
  // Used to show "Not connected" in the HeroStrip top bar AND the score breakdown.
  const revDriver = brain?.systemHealth.allScoreDrivers.find((d) => d.module === "REVENUE");
  const labDriver = brain?.systemHealth.allScoreDrivers.find((d) => d.module === "LABOUR");
  const revenueConnected = revDriver?.connected !== false;   // true when connected or brain unavailable
  const labourConnected  = labDriver?.connected  !== false;
  // posConnected = true whenever micros_connections has a row for this site.
  // Passed to getOperatingScore so null overrides (forecast mode, late labour sync)
  // never trigger "No POS connection" — the two panels share one source of truth.
  const posConnected = revenueConnected || labourConnected;

  const operatingScore = await getOperatingScore(
    siteId,
    salesOverride,
    labourScoreOverride,
    null,
    orgId ?? undefined,
    posConnected,
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

  // ─── Labour % ─────────────────────────────────────────────────────────────────
  // Primary source: labour_daily_summary.labour_pct (via getStoredDailySummary)
  // Derived fallback: totalLabourCost / netSales when labour_pct is null but cost is known
  // We do NOT fall back to micros_sales_daily.labor_pct — that field is often 0 or unreliable.
  const derivedLabourPct =
    labourSummary && labourSummary.totalLabourCost > 0 && salesSnapshot.netSales > 0
      ? +(labourSummary.totalLabourCost / salesSnapshot.netSales * 100).toFixed(1)
      : null;
  const labourPct = labourSummary?.labourPercentOfSales ?? derivedLabourPct ?? 0;

  // brain, revDriver, labDriver, revenueConnected, labourConnected and posConnected
  // are declared above (before getOperatingScore) so the score breakdown and
  // HeroStrip top bar share exactly the same flag and cannot diverge.

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
      connected: revenueConnected,
    },
    labour: {
      labourPercent: labourPct,
      targetPercent: siteConfig.target_labour_pct,
      activeStaff: labourSummary?.activeStaffCount ?? undefined,
      syncAgeMinutes: labourAgeMinutes,
      connected: labourConnected,
    },
    inventory: {
      criticalCount: inventoryIntel?.criticalItems.length ?? 0,
      lowCount: inventoryIntel?.lowItems.length ?? 0,
      noOpenPOCount: inventoryIntel?.noPOItems.length ?? 0,
      atRiskItems: inventoryIntel
        ? [...inventoryIntel.criticalItems, ...inventoryIntel.lowItems].slice(0, 5).map((item) => {
            const mi = (inventoryIntel.menuImpact ?? []).find((m) => m.ingredientId === item.id);
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

  const revenueVariance = (salesSnapshot.targetSales ?? 0) > 0
    ? ((salesSnapshot.netSales - salesSnapshot.targetSales!) / salesSnapshot.targetSales!) * 100
    : 0;

  // brain was already awaited above (before evaluateOperations)

  // ─── Duty tasks — inline drilldown for PriorityActionBoard ──────────────
  let dutiesData: DutiesData | undefined;
  try {
    const supabase = createServerClient() as any;
    const today_date_local = new Date().toLocaleDateString("en-CA");
    const { data: taskRows } = await supabase
      .from("daily_ops_tasks")
      .select("id, action_name, status, assigned_to, due_time")
      .eq("site_id", siteId)
      .eq("task_date", today_date_local)
      .order("sort_order", { ascending: true });

    if (taskRows && taskRows.length > 0) {
      // Resolve assigned_to names
      const userIds = Array.from(new Set(
        (taskRows as any[]).map((t: any) => t.assigned_to).filter(Boolean)
      )) as string[];
      const profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        for (const p of (profiles ?? []) as any[]) {
          profileMap[p.id] = p.full_name || p.email;
        }
      }
      const allTasks = (taskRows as any[]).map((t: any) => ({
        id:               t.id as string,
        action_name:      t.action_name as string,
        status:           t.status as string,
        assigned_to_name: t.assigned_to ? (profileMap[t.assigned_to] ?? null) : null,
        due_time:         t.due_time as string | null,
      }));
      const completedCount = allTasks.filter((t) => t.status === "completed").length;
      dutiesData = {
        tasks:          allTasks,
        totalCount:     allTasks.length,
        completedCount,
      };
    }
  } catch {
    // non-fatal — PriorityActionBoard degrades without dutiesData
  }

  // ─── Predictive signals for BusinessStatusRail ───────────────────────────
  const dutiesDriver   = brain?.systemHealth.allScoreDrivers.find((d) => d.module === "DUTIES");
  const dutiesCompPct  = dutiesDriver ? Math.round((dutiesDriver.pts / 20) * 100) : 100;

  const dinnerRisk: PredictiveSignals["dinnerRisk"] =
    (revenueVariance < -10 && dutiesCompPct < 70)  ? "High"   :
    (maintenance.serviceDisruptions > 0)            ? "High"   :
    (revenueVariance < -5  || dutiesCompPct < 80)   ? "Medium" : "Low";

  const bookingPace: PredictiveSignals["bookingPace"] =
    today.total >= 8 ? "Strong" :
    today.total >= 3 ? "Moderate" : "Slow";

  const staffOnFloor   = labourSummary?.activeStaffCount ?? 0;
  const forecastCovers = forecast?.forecast_covers ?? 0;
  const staffingPressure: PredictiveSignals["staffingPressure"] =
    (staffOnFloor > 0 && forecastCovers > staffOnFloor * 15) ? "High"   :
    (staffOnFloor > 0 && forecastCovers > staffOnFloor * 8)  ? "Medium" : "Low";

  const predictive: PredictiveSignals = {
    dinnerRisk,
    bookingPace,
    peakWindow: "19:00 – 21:00",
    staffingPressure,
  };

  // ─── FeedbackLoop props ──────────────────────────────────────────────────
  const gradeOrder    = ["D", "C", "B", "A"] as const;
  const feedScore     = brain?.systemHealth.score ?? scoreTotal;
  const feedGrade     = brain?.systemHealth.grade ?? "?";
  const feedNextGrade = gradeOrder.find((g) =>
    feedScore < ({ D: 50, C: 65, B: 80, A: 90 } as const)[g]
  ) ?? null;
  const feedPtsToNext = feedNextGrade
    ? ({ D: 50, C: 65, B: 80, A: 90 } as const)[feedNextGrade] - feedScore
    : 0;
  const feedbackProps: FeedbackLoopProps = {
    score:          feedScore,
    grade:          feedGrade,
    nextGrade:      feedNextGrade,
    ptsToNextGrade: feedPtsToNext,
    tradingTrend:   brain?.systemHealth.trend ?? "stable",
    gmTier:         brain?.gmSituation.tier ?? "Unknown",
    gmName:         brain?.gmSituation.name ?? "",
  };

  return (
    <div className="space-y-0">

      {/* ── LAYER 1 — Hero Strip (score · KPIs · sync) ── */}
      {brain && (
        <HeroStrip
          brain={brain}
          salesSnapshot={salesSnapshot}
          revenueVariance={revenueVariance}
          servicePeriod={servicePeriod}
          freshnessMinutes={salesAgeMinutes}
        />
      )}

      {/* ── LAYER 2 — Priority Action Board ── */}
      {brain && (
        <PriorityActionBoard brain={brain} siteId={siteId} dutiesData={dutiesData} />
      )}

      {/* ── LAYER 3 — Detail layer (below fold) ── */}
      <div className="space-y-4 pt-4">

        <AccountabilityAlert />

        {/* ── Main Grid: Primary + Secondary ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Primary Column */}
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
              dataSource={salesSnapshot.data_source}
            />
          </div>

          {/* Secondary Column */}
          <div className="lg:col-span-4 space-y-4">
            <BusinessStatusRail status={engineOutput.businessStatus} predictive={predictive} />
            <FeedbackLoop {...feedbackProps} />
          </div>
        </div>

        {/* ── Partial data gaps banner (below fold) ── */}
        <DataHealthWarning health={engineOutput.dataHealth} />

        {/* ── Secondary Drilldowns ── */}
        <SecondaryInsights
          reviews={reviews}
          maintenance={maintenance}
          hasReviews={reviews.totalReviews > 0}
        />
      </div>
    </div>
  );
}




