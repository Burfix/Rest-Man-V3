/**
 * Daily Operations service — reads and writes the daily_operations_reports,
 * daily_operations_labor, and daily_operations_revenue_centers tables.
 */

import { createServerClient } from "@/lib/supabase/server";
import {
  DailyOperationsReport,
  DailyOperationsDetail,
  DailyOperationsDashboardSummary,
} from "@/types";
import { ParsedDailyOps } from "@/lib/parsers/dailyOperationsCsv";

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getLatestDailyOperationsReport(): Promise<DailyOperationsDetail | null> {
  const supabase = createServerClient();

  const { data: report, error } = await supabase
    .from("daily_operations_reports")
    .select("*")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getLatestDailyOperationsReport: ${error.message}`);
  if (!report) return null;

  return fetchDetail(report as DailyOperationsReport);
}

export async function getDailyOperationsHistory(limit = 30): Promise<DailyOperationsReport[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("daily_operations_reports")
    .select("*")
    .order("report_date", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getDailyOperationsHistory: ${error.message}`);
  return (data ?? []) as DailyOperationsReport[];
}

export async function getDailyOperationsDashboardSummary(): Promise<DailyOperationsDashboardSummary> {
  const detail = await getLatestDailyOperationsReport();
  if (!detail) {
    return { latestReport: null, reportDate: null, uploadedAt: null };
  }
  return {
    latestReport: detail.report,
    reportDate: detail.report.report_date,
    uploadedAt: detail.report.created_at,
  };
}

export async function getDailyOperationsDetail(id: string): Promise<DailyOperationsDetail> {
  const supabase = createServerClient();

  const { data: report, error } = await supabase
    .from("daily_operations_reports")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !report) {
    throw new Error(`getDailyOperationsDetail: ${error?.message ?? "not found"}`);
  }

  return fetchDetail(report as DailyOperationsReport);
}

export async function getDailyOperationsDetailByDate(date: string): Promise<DailyOperationsDetail | null> {
  const supabase = createServerClient();

  const { data: report, error } = await supabase
    .from("daily_operations_reports")
    .select("*")
    .eq("report_date", date)
    .maybeSingle();

  if (error) throw new Error(`getDailyOperationsDetailByDate: ${error.message}`);
  if (!report) return null;

  return fetchDetail(report as DailyOperationsReport);
}

async function fetchDetail(report: DailyOperationsReport): Promise<DailyOperationsDetail> {
  const supabase = createServerClient();

  const [{ data: laborData }, { data: rcData }] = await Promise.all([
    supabase
      .from("daily_operations_labor")
      .select("*")
      .eq("daily_report_id", report.id)
      .order("total_pay", { ascending: false }),
    supabase
      .from("daily_operations_revenue_centers")
      .select("*")
      .eq("daily_report_id", report.id)
      .order("sales_net_vat", { ascending: false }),
  ]);

  return {
    report,
    laborRows: (laborData ?? []) as DailyOperationsDetail["laborRows"],
    revenueCenters: (rcData ?? []) as DailyOperationsDetail["revenueCenters"],
  };
}

// ─── Write helper ─────────────────────────────────────────────────────────────

export async function saveDailyOperationsReport(
  parsed: ParsedDailyOps,
  filename: string,
  reportDate: string
): Promise<{
  report: DailyOperationsReport;
  laborCount: number;
  revenueCenterCount: number;
  duplicate: boolean;
}> {
  const supabase = createServerClient();

  // Check for duplicate
  const { data: existing } = await supabase
    .from("daily_operations_reports")
    .select("id")
    .eq("report_date", reportDate)
    .maybeSingle();

  if (existing) {
    const { data: existingReport } = await supabase
      .from("daily_operations_reports")
      .select("*")
      .eq("id", existing.id)
      .single();
    return {
      report: existingReport as DailyOperationsReport,
      laborCount: 0,
      revenueCenterCount: 0,
      duplicate: true,
    };
  }

  const { tm, fc, ct, sp, tips } = {
    tm: parsed.topMetrics,
    fc: parsed.financialControl,
    ct: parsed.checksTopic,
    sp: parsed.servicePerformance,
    tips: parsed.tips,
  };

  const { data: report, error: reportError } = await supabase
    .from("daily_operations_reports")
    .insert({
      report_date: reportDate,
      source_file_name: filename,
      // top metrics
      sales_net_vat:       tm.salesNetVat,
      margin_percent:      tm.marginPercent,
      cogs_percent:        tm.cogsPercent,
      labor_cost_percent:  tm.laborCostPercent,
      guest_count:         tm.guestCount,
      check_count:         tm.checkCount,
      // financial control
      gross_sales_before_discounts: fc.grossSalesBeforeDiscounts,
      total_discounts:              fc.totalDiscounts,
      gross_sales_after_discounts:  fc.grossSalesAfterDiscounts,
      tax_collected:                fc.taxCollected,
      service_charges:              fc.serviceCharges,
      non_revenue_total:            fc.nonRevenueTotal,
      cost_of_goods_sold:           fc.costOfGoodsSold,
      labor_cost:                   fc.laborCost,
      operating_margin:             fc.operatingMargin,
      cash_in:                      fc.cashIn,
      paid_in:                      fc.paidIn,
      paid_out:                     fc.paidOut,
      cash_due:                     fc.cashDue,
      deposits:                     fc.deposits,
      over_short:                   fc.overShort,
      // checks topic
      returns_count:         ct.returnsCount,
      returns_amount:        ct.returnsAmount,
      voids_count:           ct.voidsCount,
      voids_amount:          ct.voidsAmount,
      manager_voids_count:   ct.managerVoidsCount,
      manager_voids_amount:  ct.managerVoidsAmount,
      error_corrects_count:  ct.errorCorrectsCount,
      error_corrects_amount: ct.errorCorrectsAmount,
      cancels_count:         ct.cancelsCount,
      cancels_amount:        ct.cancelsAmount,
      // service performance
      guests_average_spend:       sp.guestsAverageSpend,
      checks_average_spend:       sp.checksAverageSpend,
      table_turns_count:          sp.tableturnsCount,
      table_turns_average_spend:  sp.tableturnsAverageSpend,
      average_dining_time_hours:  sp.averageDiningTimeHours,
      // tips
      direct_charged_tips: tips.directChargedTips,
      direct_cash_tips:    tips.directCashTips,
      indirect_tips:       tips.indirectTips,
      total_tips:          tips.totalTips,
      tips_paid:           tips.tipsPaid,
    })
    .select()
    .single();

  if (reportError || !report) {
    throw new Error(`saveDailyOperationsReport: ${reportError?.message ?? "insert failed"}`);
  }

  const savedReport = report as unknown as DailyOperationsReport;

  // Insert labor rows
  let laborCount = 0;
  if (parsed.laborRows.length > 0) {
    const { error: laborError } = await supabase
      .from("daily_operations_labor")
      .insert(
        parsed.laborRows.map((r) => ({
          daily_report_id:   savedReport.id,
          job_code_name:     r.jobCodeName,
          regular_hours:     r.regularHours,
          overtime_hours:    r.overtimeHours,
          total_hours:       r.totalHours,
          regular_pay:       r.regularPay,
          overtime_pay:      r.overtimePay,
          total_pay:         r.totalPay,
          labor_cost_percent: r.laborCostPercent,
        }))
      );
    if (laborError) {
      throw new Error(`saveDailyOperationsReport labor: ${laborError.message}`);
    }
    laborCount = parsed.laborRows.length;
  }

  // Insert revenue center rows
  let revenueCenterCount = 0;
  if (parsed.revenueCenterRows.length > 0) {
    const { error: rcError } = await supabase
      .from("daily_operations_revenue_centers")
      .insert(
        parsed.revenueCenterRows.map((r) => ({
          daily_report_id:             savedReport.id,
          revenue_center_name:          r.revenueCenterName,
          sales_net_vat:                r.salesNetVat,
          percent_of_total_sales:       r.percentOfTotalSales,
          guests:                       r.guests,
          percent_of_total_guests:      r.percentOfTotalGuests,
          average_spend_per_guest:      r.averageSpendPerGuest,
          checks:                       r.checks,
          percent_of_total_checks:      r.percentOfTotalChecks,
          average_spend_per_check:      r.averageSpendPerCheck,
          table_turns:                  r.tableTurns,
          percent_of_total_table_turns: r.percentOfTotalTableTurns,
          average_spend_per_table_turn: r.averageSpendPerTableTurn,
          average_turn_time:            r.averageTurnTime,
        }))
      );
    if (rcError) {
      throw new Error(`saveDailyOperationsReport revenue centers: ${rcError.message}`);
    }
    revenueCenterCount = parsed.revenueCenterRows.length;
  }

  return {
    report: savedReport,
    laborCount,
    revenueCenterCount,
    duplicate: false,
  };
}
