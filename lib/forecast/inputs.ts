/**
 * lib/forecast/inputs.ts — Gather all forecast inputs from the database
 *
 * Collects historical sales, covers, bookings, compliance, maintenance,
 * and event data into a single ForecastInput object.
 */

import { createServerClient } from "@/lib/supabase/server";
import { todayISO, getDayName, toNum } from "@/lib/utils";
import { DEFAULT_ORG_ID, DEFAULT_AVG_SPEND_ZAR } from "@/lib/constants";
import {
  getSameDayLastYearSales,
  getRecentWeekdayAverageSales,
  getSameDayLastYearCovers,
  getRecentWeekdayAverageCovers,
  getConfirmedCoversForDate,
  getHistoricalAvgSpendPerGuest,
  getEventMultiplierForDate,
  getSalesTarget,
} from "@/services/revenue/forecast";
import { getMaintenanceSummary } from "@/services/ops/maintenanceSummary";
import { getComplianceSummary } from "@/services/ops/complianceSummary";
import type { ForecastInput } from "@/types/forecast";

/**
 * Fetch the latest labour % from daily_operations_reports (last 7 days).
 */
async function getLatestLabourPct(): Promise<number | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("daily_operations_reports")
    .select("labor_cost_percentage")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return toNum((data as { labor_cost_percentage?: unknown } | null)?.labor_cost_percentage) ?? null;
}

async function getLatestMarginPct(): Promise<number | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("daily_operations_reports")
    .select("gross_margin_percentage")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return toNum((data as { gross_margin_percentage?: unknown } | null)?.gross_margin_percentage) ?? null;
}

/**
 * Gather all inputs needed to generate a forecast for a given date.
 */
export async function getForecastInputs(
  storeId: string = DEFAULT_ORG_ID,
  date: string = todayISO(),
): Promise<ForecastInput> {
  const [
    sameDayLastYearSales,
    recentWeekdayAvgSales,
    sameDayLastYearCovers,
    recentWeekdayAvgCovers,
    confirmedCovers,
    historicalAvgSpend,
    eventInfo,
    salesTarget,
    latestLabourPct,
    latestMarginPct,
    maintenance,
    compliance,
  ] = await Promise.all([
    getSameDayLastYearSales(date),
    getRecentWeekdayAverageSales(date),
    getSameDayLastYearCovers(date),
    getRecentWeekdayAverageCovers(date),
    getConfirmedCoversForDate(date),
    getHistoricalAvgSpendPerGuest(date),
    getEventMultiplierForDate(date),
    getSalesTarget(date),
    getLatestLabourPct(),
    getLatestMarginPct(),
    getMaintenanceSummary().catch(() => null),  // forecast doesn't need site-scoping
    getComplianceSummary().catch(() => null),
  ]);

  return {
    storeId,
    date,
    dayName: getDayName(date),
    confirmedCovers,
    recentWeekdayAvgSales,
    sameDayLastYearSales,
    recentWeekdayAvgCovers,
    sameDayLastYearCovers,
    historicalAvgSpend: historicalAvgSpend ?? DEFAULT_AVG_SPEND_ZAR,
    eventMultiplier: eventInfo.multiplier,
    eventName: eventInfo.eventName,
    latestLabourPct,
    latestMarginPct,
    outOfServiceCount: maintenance?.outOfService ?? 0,
    salesTarget: toNum(salesTarget?.target_sales) ?? null,
    complianceDueSoon: compliance?.due_soon ?? 0,
    complianceExpired: compliance?.expired ?? 0,
    maintenanceOverdue: maintenance?.openRepairs ?? 0,
    maintenanceUrgent: maintenance?.urgentIssues?.length ?? 0,
    activePromos: [],  // TODO: integrate with promos table when available
  };
}
