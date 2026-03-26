/**
 * ForgeStack Operating Brain v1 — Actions
 *
 * Execution queue: shift summary → time-horizon groups → mutation board.
 * Server component fetches actions + runs decision engine for context.
 */

import { createServerClient } from "@/lib/supabase/server";
import ActionsBoard from "@/components/dashboard/actions/ActionsBoard";
import ShiftSummaryBanner from "@/components/actions/ShiftSummaryBanner";
import ActionQueueGroup from "@/components/actions/ActionQueueGroup";
import type { Action } from "@/types/actions";

import { getTodayBookingsSummary } from "@/services/ops/bookingsSummary";
import { getLatestSalesSummary } from "@/services/ops/salesSummary";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import { getMicrosStatus } from "@/services/micros/status";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { getInventoryIntelligence } from "@/services/inventory/intelligence";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { evaluateOperations } from "@/services/decision-engine";
import { getSiteConfig } from "@/lib/config/site";

import type {
  TodayBookingsSummary,
  SalesSummary,
  MaintenanceSummary,
  RevenueForecast,
  ComplianceSummary,
} from "@/types";
import type { MicrosStatusSummary } from "@/types/micros";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Settle helper ──────────────────────────────────────────────────────────

function settled<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): { value: T } {
  return result.status === "fulfilled"
    ? { value: result.value }
    : { value: fallback };
}

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
  outOfService: 0, urgentIssues: [], resolvedThisWeek: 0,
  avgFixTimeDays: null, monthlyActualCost: null, topProblemAsset: null,
  foodSafetyRisks: 0, serviceDisruptions: 0, complianceRisks: 0,
};

// ─── Time horizon grouping ──────────────────────────────────────────────────

function groupByHorizon(actions: Action[]) {
  const now = new Date();
  const endOfShift = new Date();
  endOfShift.setHours(23, 59, 59, 999);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const urgent: Action[] = [];
  const thisShift: Action[] = [];
  const today: Action[] = [];
  const thisWeek: Action[] = [];

  for (const a of actions) {
    if (a.status === "completed") continue;
    const isOverdue = a.due_at && new Date(a.due_at) < now;
    const isCritical = a.impact_weight === "critical" || a.impact_weight === "high";

    if (isOverdue || a.impact_weight === "critical") {
      urgent.push(a);
    } else if (a.due_at && new Date(a.due_at) <= endOfShift && isCritical) {
      thisShift.push(a);
    } else if (a.due_at && new Date(a.due_at) <= endOfDay) {
      today.push(a);
    } else {
      thisWeek.push(a);
    }
  }

  return { urgent, thisShift, today, thisWeek };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function ActionsPage() {
  // Fetch actions from Supabase
  let actions: Action[] = [];
  let loadError: string | null = null;

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("actions")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    actions = (data ?? []) as Action[];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error";
  }

  // Fetch operational context for the banner
  const [
    todayResult,
    maintenanceResult,
    forecastResult,
    complianceResult,
    microsResult,
    inventoryResult,
    labourResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getMaintenanceSummary(),
    generateRevenueForecast(todayISO()),
    getComplianceSummary(),
    getMicrosStatus(),
    getInventoryIntelligence(),
    getStoredDailySummary(process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "manual"),
  ]);

  const { value: today }              = settled(todayResult, EMPTY_TODAY);
  const { value: maintenance }        = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const { value: forecast }           = settled(forecastResult, null as RevenueForecast | null);
  const { value: complianceSummary }  = settled(complianceResult, EMPTY_COMPLIANCE);
  const { value: microsStatus }       = settled(microsResult, null);
  const { value: inventoryIntel }     = settled(inventoryResult, null);
  const { value: labourSummary }      = settled(labourResult, null);

  const today_iso = todayISO();
  const ms = microsStatus as MicrosStatusSummary | null;
  const salesSnapshot = await getCurrentSalesSnapshot(
    today_iso, ms, forecast, today.total, today.totalCovers,
  );

  const now = Date.now();
  const salesAgeMinutes = salesSnapshot.freshnessMinutes ?? undefined;
  const labourAgeMinutes = labourSummary?.lastSyncAt
    ? Math.round((now - new Date(labourSummary.lastSyncAt).getTime()) / 60_000)
    : undefined;
  const inventoryAgeMinutes = inventoryIntel?.lastSynced
    ? Math.round((now - new Date(inventoryIntel.lastSynced).getTime()) / 60_000)
    : undefined;
  const labourPct = labourSummary?.labourPercentOfSales
    ?? salesSnapshot.labourCostPercent
    ?? 0;

  const siteConfig = await getSiteConfig();

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
    labour: { labourPercent: labourPct, targetPercent: siteConfig.target_labour_pct, syncAgeMinutes: labourAgeMinutes },
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
    freshness: { salesAgeMinutes, labourAgeMinutes, inventoryAgeMinutes },
  });

  // Group active actions by time horizon
  const activeActions = actions.filter((a) => a.status !== "completed");
  const overdueCount = activeActions.filter(
    (a) => a.due_at && new Date(a.due_at) < new Date(),
  ).length;
  const urgentCount = activeActions.filter(
    (a) => a.impact_weight === "critical" || (a.due_at && new Date(a.due_at) < new Date()),
  ).length;
  const groups = groupByHorizon(actions);

  return (
    <div className="space-y-4">

      {/* Shift Summary Banner — operational context */}
      <ShiftSummaryBanner
        commandBar={engineOutput.operatingCommandBar}
        totalActions={activeActions.length}
        urgentCount={urgentCount}
        overdueCount={overdueCount}
      />

      {/* Error banner */}
      {loadError && (
        <div className="rounded-lg border border-red-800/30 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          Could not load actions: {loadError}
        </div>
      )}

      {/* Time-horizon groups — execution queue view */}
      {!loadError && (
        <div className="space-y-3">
          <ActionQueueGroup title="Now — Urgent" actions={groups.urgent} />
          <ActionQueueGroup title="This Shift" actions={groups.thisShift} />
          <ActionQueueGroup title="Today" actions={groups.today} />
          <ActionQueueGroup title="This Week" actions={groups.thisWeek} />
        </div>
      )}

      {/* Full board — mutations + assignment */}
      {!loadError && <ActionsBoard initial={actions} />}
    </div>
  );
}
