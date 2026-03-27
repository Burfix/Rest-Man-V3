/**
 * services/micros/labour/summary.ts
 *
 * Server-side summary calculations for labour data.
 * Reads from Supabase tables and computes dashboard metrics.
 */

import { createServerClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/utils";
import type { Database } from "@/types/database";
import type {
  LabourDashboardSummary,
  LabourRoleSummary,
  LabourCategorySummary,
  LabourRvcSummary,
  NormalizedJobCode,
} from "@/types/labour";

type TimecardRow = Database["public"]["Tables"]["labour_timecards"]["Row"];
type JobCodeDbRow = Database["public"]["Tables"]["labour_job_codes"]["Row"];
type SyncStateRow = Database["public"]["Tables"]["labour_sync_state"]["Row"];
type DailySummaryRow = Database["public"]["Tables"]["labour_daily_summary"]["Row"];

// ── Thresholds (TODO: move to settings / env) ────────────────────────────

const LABOUR_PCT_TARGET = 30;          // alert if labour % > 30
const OVERTIME_THRESHOLD_HOURS = 8;    // alert if total OT hrs > 8
const OPEN_TIMECARD_AGE_HOURS = 10;    // alert if open card > 10h old

// ── Build summary from DB timecards ───────────────────────────────────────

export async function buildDailySummary(
  locRef: string,
  businessDate?: string,
): Promise<LabourDashboardSummary> {
  const sb = createServerClient();
  const date = businessDate ?? todayISO();

  // Fetch timecards for this date
  const { data: timecards } = await sb
    .from("labour_timecards")
    .select("*")
    .eq("loc_ref", locRef)
    .eq("business_date", date)
    .returns<TimecardRow[]>();

  // Fetch job codes for role/category mapping
  const { data: jobCodes } = await sb
    .from("labour_job_codes")
    .select("*")
    .eq("loc_ref", locRef)
    .returns<JobCodeDbRow[]>();

  // Fetch sync state
  const { data: syncState } = await sb
    .from("labour_sync_state")
    .select("*")
    .eq("loc_ref", locRef)
    .returns<SyncStateRow[]>()
    .single();

  // Fetch today's net sales for labour % calculation.
  // Priority: MICROS live sync → manual upload for the day.
  let netSales: number | null = null;
  const { data: salesRow } = await sb
    .from("micros_sales_daily")
    .select("net_sales")
    .eq("loc_ref", locRef)
    .eq("business_date", date)
    .single();
  if (salesRow?.net_sales != null) {
    netSales = salesRow.net_sales;
  }

  // Fallback: manual upload when MICROS daily is not yet synced for today
  if (netSales == null) {
    const { data: manualRow } = await (sb.from("manual_sales_uploads" as any) as any)
      .select("net_sales, gross_sales")
      .eq("business_date", date)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = manualRow as { net_sales: number | null; gross_sales: number } | null;
    netSales = row?.net_sales ?? row?.gross_sales ?? null;
  }

  const cards = timecards ?? [];
  const jcMap = buildJobCodeMap(jobCodes ?? []);

  // Aggregate totals
  let totalHours = 0, totalPay = 0;
  let regHours = 0, regPay = 0;
  let ovtHours = 0, ovtPay = 0;
  let premHours = 0, premPay = 0;
  let openCount = 0;
  const empSet = new Set<string>();
  const now = Date.now();

  // Group by role / category / rvc
  const roleMap = new Map<string, { hours: number; pay: number; emps: Set<string> }>();
  const catMap = new Map<string, { name: string; hours: number; pay: number; emps: Set<string> }>();
  const rvcMap = new Map<string, { hours: number; pay: number; emps: Set<string> }>();

  let openOlderThanThreshold = 0;
  const unmappedJcRefs = new Set<string>();

  for (const tc of cards) {
    totalHours += Number(tc.total_hours ?? 0);
    totalPay   += Number(tc.total_pay ?? 0);
    regHours   += Number(tc.reg_hrs ?? 0);
    regPay     += Number(tc.reg_pay ?? 0);
    ovtHours   += Number(tc.ovt1_hrs ?? 0) + Number(tc.ovt2_hrs ?? 0) + Number(tc.ovt3_hrs ?? 0) + Number(tc.ovt4_hrs ?? 0);
    ovtPay     += Number(tc.ovt1_pay ?? 0) + Number(tc.ovt2_pay ?? 0) + Number(tc.ovt3_pay ?? 0) + Number(tc.ovt4_pay ?? 0);
    premHours  += Number(tc.prem_hrs ?? 0);
    premPay    += Number(tc.prem_pay ?? 0);

    const empId = tc.emp_num ?? "";
    if (empId) empSet.add(empId);

    const isOpen = !tc.clk_out_utc;
    if (isOpen) {
      openCount++;
      if (tc.clk_in_utc) {
        const ageMs = now - new Date(tc.clk_in_utc).getTime();
        if (ageMs > OPEN_TIMECARD_AGE_HOURS * 3600_000) {
          openOlderThanThreshold++;
        }
      }
    }

    // Role grouping (by jc_num from timecard → map to job code name)
    const jcKey = String(tc.jc_num ?? "");
    const jc = jcMap.get(jcKey);
    const roleName = jc?.name || `Job ${jcKey || "Unknown"}`;
    if (jcKey && !jc) unmappedJcRefs.add(jcKey);

    if (!roleMap.has(jcKey)) {
      roleMap.set(jcKey, { hours: 0, pay: 0, emps: new Set() });
    }
    const rr = roleMap.get(jcKey)!;
    rr.hours += Number(tc.total_hours ?? 0);
    rr.pay += Number(tc.total_pay ?? 0);
    if (empId) rr.emps.add(empId);

    // Category grouping
    const catNum = jc?.lbrCatNum ?? "";
    const catName = jc?.lbrCatName ?? "Uncategorised";
    const catKey = catNum || "uncategorised";
    if (!catMap.has(catKey)) {
      catMap.set(catKey, { name: catName, hours: 0, pay: 0, emps: new Set() });
    }
    const cc = catMap.get(catKey)!;
    cc.hours += Number(tc.total_hours ?? 0);
    cc.pay += Number(tc.total_pay ?? 0);
    if (empId) cc.emps.add(empId);

    // Revenue center grouping
    const rvcNum = String(tc.rvc_num ?? "");
    if (!rvcMap.has(rvcNum)) {
      rvcMap.set(rvcNum, { hours: 0, pay: 0, emps: new Set() });
    }
    const rv = rvcMap.get(rvcNum)!;
    rv.hours += Number(tc.total_hours ?? 0);
    rv.pay += Number(tc.total_pay ?? 0);
    if (empId) rv.emps.add(empId);
  }

  // Labour % of sales
  const labourPct = netSales != null && netSales > 0
    ? round2((totalPay / netSales) * 100)
    : null;

  // Build role summaries
  const byRole: LabourRoleSummary[] = Array.from(roleMap.entries())
    .map(([key, v]) => ({
      jobCodeRef: key,
      roleName: jcMap.get(key)?.name || `Job ${key || "Unknown"}`,
      hours: round2(v.hours),
      pay: round2(v.pay),
      staffCount: v.emps.size,
    }))
    .sort((a, b) => b.pay - a.pay);

  const byCategory: LabourCategorySummary[] = Array.from(catMap.entries())
    .map(([num, v]) => ({
      categoryNum: num,
      categoryName: v.name,
      hours: round2(v.hours),
      pay: round2(v.pay),
      staffCount: v.emps.size,
    }))
    .sort((a, b) => b.pay - a.pay);

  const byRevenueCenter: LabourRvcSummary[] = Array.from(rvcMap.entries())
    .map(([num, v]) => ({
      rvcNum: num,
      hours: round2(v.hours),
      pay: round2(v.pay),
      staffCount: v.emps.size,
    }))
    .sort((a, b) => b.pay - a.pay);

  // Stale detection: if last sync > 30 min ago
  const lastSyncAt = syncState?.last_sync_at ?? null;
  const isStale = !lastSyncAt ||
    (Date.now() - new Date(lastSyncAt).getTime()) > 30 * 60_000;

  return {
    businessDate: date,
    locRef,
    totalLabourCost: round2(totalPay),
    totalLabourHours: round2(totalHours),
    overtimeCost: round2(ovtPay),
    overtimeHours: round2(ovtHours),
    regularCost: round2(regPay),
    regularHours: round2(regHours),
    premiumCost: round2(premPay),
    premiumHours: round2(premHours),
    activeStaffCount: empSet.size,
    openTimecardCount: openCount,
    labourPercentOfSales: labourPct,
    netSales,
    byRole,
    byCategory,
    byRevenueCenter,
    lastSyncAt,
    isStale,
    alerts: {
      labourAboveTarget: labourPct != null && labourPct > LABOUR_PCT_TARGET,
      overtimeAboveThreshold: ovtHours > OVERTIME_THRESHOLD_HOURS,
      unmappedJobCodes: unmappedJcRefs.size,
      openTimecardsOlderThanThreshold: openOlderThanThreshold,
    },
  };
}

// ── Get stored summary from DB (faster for dashboard) ─────────────────────

export async function getStoredDailySummary(
  locRef: string,
  businessDate?: string,
): Promise<LabourDashboardSummary | null> {
  const sb = createServerClient();
  const date = businessDate ?? todayISO();

  const { data } = await sb
    .from("labour_daily_summary")
    .select("*")
    .eq("loc_ref", locRef)
    .eq("business_date", date)
    .returns<DailySummaryRow[]>()
    .single();

  if (!data) return null;

  // Fetch sync state for stale check
  const { data: syncState } = await sb
    .from("labour_sync_state")
    .select("*")
    .eq("loc_ref", locRef)
    .returns<SyncStateRow[]>()
    .single();

  const lastSyncAt = syncState?.last_sync_at ?? data.synced_at ?? null;
  const isStale = !lastSyncAt ||
    (Date.now() - new Date(lastSyncAt).getTime()) > 30 * 60_000;

  const labourPct = data.labour_pct != null ? Number(data.labour_pct) : null;
  const ovtHours = Number(data.ovt_hours ?? 0);

  return {
    businessDate: date,
    locRef,
    totalLabourCost: Number(data.total_pay ?? 0),
    totalLabourHours: Number(data.total_hours ?? 0),
    overtimeCost: Number(data.ovt_pay ?? 0),
    overtimeHours: ovtHours,
    regularCost: Number(data.reg_pay ?? 0),
    regularHours: Number(data.reg_hours ?? 0),
    premiumCost: Number(data.prem_pay ?? 0),
    premiumHours: Number(data.prem_hours ?? 0),
    activeStaffCount: data.active_staff_count ?? 0,
    openTimecardCount: data.open_timecard_count ?? 0,
    labourPercentOfSales: labourPct,
    netSales: data.net_sales != null ? Number(data.net_sales) : null,
    byRole: (data.by_role_json as unknown as LabourRoleSummary[]) ?? [],
    byCategory: (data.by_category_json as unknown as LabourCategorySummary[]) ?? [],
    byRevenueCenter: (data.by_rvc_json as unknown as LabourRvcSummary[]) ?? [],
    lastSyncAt,
    isStale,
    alerts: {
      labourAboveTarget: labourPct != null && labourPct > 30,
      overtimeAboveThreshold: ovtHours > 8,
      unmappedJobCodes: 0, // Not tracked in stored summary
      openTimecardsOlderThanThreshold: 0,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildJobCodeMap(
  rows: JobCodeDbRow[],
): Map<string, NormalizedJobCode> {
  const map = new Map<string, NormalizedJobCode>();
  for (const r of rows) {
    // Map by num (job code number) to match jc_num on timecards
    map.set(r.num, {
      locRef: r.loc_ref,
      num: r.num,
      name: r.name,
      mstrNum: r.mstr_num,
      mstrName: r.mstr_name,
      lbrCatNum: r.lbr_cat_num,
      lbrCatName: r.lbr_cat_name,
      lbrCatMstrNum: r.lbr_cat_mstr_num,
      lbrCatMstrName: r.lbr_cat_mstr_name,
    });
  }
  return map;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
