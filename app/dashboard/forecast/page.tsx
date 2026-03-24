/**
 * ForgeStack Operating Brain v1 — GM Co-Pilot
 *
 * Daily briefing room for the General Manager.
 * Layout: TodayBrief → TopDecisions → ServicePulse → RisksAndBottlenecks
 *         → SuggestedPlaybook → RecommendedActions
 */

import { getTodayBookingsSummary } from "@/services/ops/bookingsSummary";
import { getLatestSalesSummary } from "@/services/ops/salesSummary";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { getDailyOperationsDashboardSummary } from "@/services/ops/dailyOperationsSummary";
import { getDataFreshnessSummary } from "@/services/ops/dataFreshness";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import { getMicrosStatus } from "@/services/micros/status";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { deriveMicrosIntegrationStatus, canUseMicrosLiveData } from "@/lib/integrations/status";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { getInventoryIntelligence } from "@/services/inventory/intelligence";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { evaluateOperations } from "@/services/decision-engine";

import TodayBrief          from "@/components/gm-copilot/TodayBrief";
import TopDecisions        from "@/components/gm-copilot/TopDecisions";
import ServicePulse        from "@/components/operating-brain/ServicePulse";
import RisksAndBottlenecks from "@/components/gm-copilot/RisksAndBottlenecks";
import SuggestedPlaybook   from "@/components/gm-copilot/SuggestedPlaybook";
import RecommendedActions  from "@/components/gm-copilot/RecommendedActions";

import type {
  TodayBookingsSummary,
  SalesSummary,
  MaintenanceSummary,
  DailyOperationsDashboardSummary,
  RevenueForecast,
  ComplianceSummary,
} from "@/types";
import type { MicrosStatusSummary } from "@/types/micros";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Settle helper ─────────────────────────────────────────────────────────

function settled<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): { value: T } {
  return result.status === "fulfilled"
    ? { value: result.value }
    : { value: fallback };
}

const EMPTY_TODAY: TodayBookingsSummary = {
  total: 0,
  totalCovers: 0,
  largeBookings: 0,
  eventLinked: 0,
  escalationsToday: 0,
  bookings: [],
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

export default async function GMCoPilotPage() {
  const [
    todayResult,
    salesResult,
    maintenanceResult,
    dailyOpsResult,
    freshnessResult,
    forecastResult,
    complianceResult,
    microsResult,
    inventoryResult,
    labourResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getLatestSalesSummary(),
    getMaintenanceSummary(),
    getDailyOperationsDashboardSummary(),
    getDataFreshnessSummary(),
    generateRevenueForecast(todayISO()),
    getComplianceSummary(),
    getMicrosStatus(),
    getInventoryIntelligence(),
    getStoredDailySummary(process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "manual"),
  ]);

  const { value: today }              = settled(todayResult, EMPTY_TODAY);
  const { value: maintenance }        = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const { value: dailyOps }           = settled(dailyOpsResult, EMPTY_DAILY_OPS);
  const { value: forecast }           = settled(forecastResult, null as RevenueForecast | null);
  const { value: complianceSummary }  = settled(complianceResult, EMPTY_COMPLIANCE);
  const { value: microsStatus }       = settled(microsResult, null);
  const { value: inventoryIntel }     = settled(inventoryResult, null);
  const { value: labourSummary }      = settled(labourResult, null);

  // ─── Unified sales snapshot ─────────────────────────────────────────────
  const today_iso = todayISO();
  const ms = microsStatus as MicrosStatusSummary | null;
  const salesSnapshot = await getCurrentSalesSnapshot(
    today_iso,
    ms,
    forecast,
    today.total,
    today.totalCovers,
  );

  // ─── Freshness ──────────────────────────────────────────────────────────
  const now = Date.now();
  const salesAgeMinutes = salesSnapshot.freshnessMinutes ?? undefined;
  const labourAgeMinutes = labourSummary?.lastSyncAt
    ? Math.round((now - new Date(labourSummary.lastSyncAt).getTime()) / 60_000)
    : undefined;
  const inventoryAgeMinutes = inventoryIntel?.lastSynced
    ? Math.round((now - new Date(inventoryIntel.lastSynced).getTime()) / 60_000)
    : undefined;
  const dailyOpsAgeDays = dailyOps.reportDate
    ? Math.round((now - new Date(dailyOps.reportDate).getTime()) / 86_400_000)
    : undefined;

  const labourPct = labourSummary?.labourPercentOfSales
    ?? salesSnapshot.labourCostPercent
    ?? dailyOps.latestReport?.labor_cost_percent
    ?? 0;

  // ─── Decision Engine ───────────────────────────────────────────────────
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
      targetPercent: 32,
      activeStaff: labourSummary?.activeStaffCount ?? undefined,
      syncAgeMinutes: labourAgeMinutes,
    },
    inventory: {
      criticalCount: inventoryIntel?.criticalItems.length ?? 0,
      lowCount: inventoryIntel?.lowItems.length ?? 0,
      noOpenPOCount: inventoryIntel?.noPOItems.length ?? 0,
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
      forecastSales: forecast?.forecast_sales ?? undefined,
      forecastCovers: forecast?.forecast_covers ?? undefined,
      actualVsForecastPercent: forecast?.sales_gap_pct != null ? -forecast.sales_gap_pct : undefined,
      confidence: forecast?.confidence,
    },
    bookings: {
      lunchBookings: today.total > 0 ? Math.floor(today.total * 0.4) : undefined,
      dinnerBookings: today.total > 0 ? Math.ceil(today.total * 0.6) : undefined,
    },
    freshness: {
      salesAgeMinutes,
      labourAgeMinutes,
      inventoryAgeMinutes,
      dailyOpsAgeDays,
    },
  });

  return (
    <div className="space-y-4">

      {/* 1. Today Brief — narrative opening */}
      <TodayBrief
        commandBar={engineOutput.operatingCommandBar}
        businessStatus={engineOutput.businessStatus}
        servicePulseInsights={engineOutput.servicePulseInsights}
        forecastSales={forecast?.forecast_sales}
        forecastCovers={forecast?.forecast_covers}
      />

      {/* 2. Top Decisions — max 3 */}
      <TopDecisions decisions={engineOutput.commandFeed.slice(0, 3)} />

      {/* 3. Service Pulse — revenue + pace */}
      <ServicePulse
        actual={salesSnapshot.netSales}
        target={salesSnapshot.targetSales ?? 0}
        variancePercent={
          (salesSnapshot.targetSales ?? 0) > 0
            ? ((salesSnapshot.netSales - salesSnapshot.targetSales!) / salesSnapshot.targetSales!) * 100
            : 0
        }
        covers={salesSnapshot.covers}
        avgSpend={salesSnapshot.covers > 0 ? salesSnapshot.netSales / salesSnapshot.covers : 0}
        forecastCovers={forecast?.forecast_covers}
        insights={engineOutput.servicePulseInsights}
        isLive={salesSnapshot.isLive}
      />

      {/* 4. Risks & Bottlenecks */}
      <RisksAndBottlenecks businessStatus={engineOutput.businessStatus} />

      {/* 5. Suggested Playbook */}
      <SuggestedPlaybook playbook={engineOutput.suggestedPlaybook} />

      {/* 6. Recommended Actions */}
      <RecommendedActions decisions={engineOutput.whatToDoNow} />
    </div>
  );
}
