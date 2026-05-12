/**
 * services/micros/location-sync.ts
 *
 * Per-location sync orchestrator for Oracle MICROS BIAPI.
 *
 * Supports all registered location keys (si-cantina, primi-camps-bay, …).
 * Syncs sales (guest checks → micros_sales_daily) and labour
 * (timecards → labour_timecards → labour_daily_summary) for a given
 * business date and location.
 *
 * SECURITY: Server-side only. Never import in client components.
 */

import { createServerClient }           from "@/lib/supabase/server";
import { buildLocationClient }          from "@/lib/micros/location-client";
import type { LocationConfig }          from "@/lib/micros/micros-location-registry";
import { aggregateGuestChecksToDailySales } from "./normalize";
import { normalizeTimecards, normalizeJobCodes } from "./labour/normalize";
import { logger }                       from "@/lib/logger";
import type { Database }                from "@/types/database";
import type {
  OracleTimeCard,
  OracleTimeCardResponse,
  OracleJobCodeResponse,
  NormalizedTimecard,
  NormalizedJobCode,
} from "@/types/labour";

const ZOMBIE_THRESHOLD_MS = 5 * 60 * 1_000;

export interface LocationSyncResult {
  success:           boolean;
  locationKey:       string;
  businessDate:      string;
  message:           string;
  salesSynced:       boolean;
  labourSynced:      boolean;
  salesChecks?:      number;
  labourTimecards?:  number;
  errors:            string[];
}

// ── Helper: flatten Oracle businessDates → flat timeCards array ───────────

function flattenTimeCards(
  res: { businessDates?: { busDt: string; timeCardDetails: OracleTimeCard[] | null }[] | null },
): OracleTimeCard[] {
  if (!res.businessDates) return [];
  const out: OracleTimeCard[] = [];
  for (const bucket of res.businessDates) {
    if (bucket.timeCardDetails) {
      for (const tc of bucket.timeCardDetails) {
        if (!tc.busDt) tc.busDt = bucket.busDt;
        out.push(tc);
      }
    }
  }
  return out;
}

// ── Sales sync (guest checks → micros_sales_daily) ────────────────────────

async function syncSales(
  cfg: LocationConfig,
  businessDate: string,
  connectionId: string,
): Promise<{ checkCount: number }> {
  const client = buildLocationClient(cfg);

  const raw = await client.post<{ curUTC: string; locRef: string; guestChecks: unknown[] | null }>(
    "getGuestChecks",
    { busDt: businessDate, locRef: cfg.locationRef },
  );

  if (!raw || typeof raw !== "object") {
    throw new Error(`Oracle returned invalid getGuestChecks response: ${typeof raw}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const daily = aggregateGuestChecksToDailySales(raw as any, businessDate);
  if (!daily) {
    throw new Error("Failed to normalize guest checks into daily totals");
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("micros_sales_daily")
    .upsert(
      {
        connection_id:   connectionId,
        loc_ref:         daily.loc_ref || cfg.locationRef,
        business_date:   daily.business_date,
        net_sales:       daily.net_sales,
        gross_sales:     daily.gross_sales,
        tax_collected:   daily.tax_collected,
        service_charges: daily.service_charges,
        discounts:       daily.discounts,
        voids:           daily.voids,
        returns:         daily.returns,
        check_count:     daily.check_count,
        guest_count:     daily.guest_count,
        avg_check_value: daily.avg_check_value,
        avg_guest_spend: daily.avg_guest_spend,
        labor_cost:      daily.labor_cost,
        labor_pct:       daily.labor_pct,
        synced_at:       new Date().toISOString(),
      },
      { onConflict: "connection_id,loc_ref,business_date" },
    );

  if (error) throw new Error(`micros_sales_daily upsert failed: ${error.message}`);

  return { checkCount: raw.guestChecks?.length ?? 0 };
}

// ── Labour sync (timecards → labour_timecards → labour_daily_summary) ──────

async function syncLabour(
  cfg: LocationConfig,
  businessDate: string,
): Promise<{ timecardCount: number }> {
  const client  = buildLocationClient(cfg);
  const locRef  = cfg.locationRef;
  const errors: string[] = [];

  // 1. Sync job codes (non-fatal if it fails)
  let jobCodes: NormalizedJobCode[] = [];
  try {
    const jcRes = await client.post<OracleJobCodeResponse>("getJobCodeDimensions", { locRef });
    jobCodes = normalizeJobCodes((jcRes as OracleJobCodeResponse).jobCodes ?? [], locRef);
    if (jobCodes.length > 0) {
      const supabase = createServerClient();
      const rows = jobCodes.map((c) => ({
        loc_ref:           c.locRef,
        num:               c.num,
        name:              c.name,
        mstr_num:          c.mstrNum,
        mstr_name:         c.mstrName,
        lbr_cat_num:       c.lbrCatNum,
        lbr_cat_name:      c.lbrCatName,
        lbr_cat_mstr_num:  c.lbrCatMstrNum,
        lbr_cat_mstr_name: c.lbrCatMstrName,
        synced_at:         new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("labour_job_codes")
        .upsert(rows, { onConflict: "loc_ref,num" });
      if (error) errors.push(`Job codes upsert: ${error.message}`);
    }
  } catch (err) {
    errors.push(`Job codes: ${err instanceof Error ? err.message : String(err)}`);
    // Non-fatal — continue with timecards
  }

  // 2. Fetch timecards for the business date
  const tcRes = await client.post<OracleTimeCardResponse>(
    "getTimeCardDetails",
    { busDt: businessDate, locRef },
  );

  const rawCards = flattenTimeCards(tcRes as OracleTimeCardResponse);
  const cards    = normalizeTimecards(rawCards, tcRes.locRef || locRef);

  // 3. Upsert timecards in batches
  const supabase = createServerClient();
  const BATCH = 200;
  let upserted = 0;
  type TimecardInsert = Database["public"]["Tables"]["labour_timecards"]["Insert"];

  const tcRows: TimecardInsert[] = cards.map((c) => ({
    tc_id:            c.tcId,
    business_date:    c.businessDate,
    loc_ref:          c.locRef,
    emp_num:          c.empNum,
    payroll_id:       c.payrollID,
    ext_payroll_id:   c.extPayrollID,
    job_code_ref:     c.jobCodeRef,
    jc_num:           c.jcNum,
    rvc_num:          c.rvcNum,
    shft_num:         c.shftNum,
    clk_in_lcl:       c.clkInLcl,
    clk_out_lcl:      c.clkOutLcl,
    clk_in_utc:       c.clkInUTC,
    clk_out_utc:      c.clkOutUTC,
    reg_hrs:          c.regHrs,
    reg_pay:          c.regPay,
    ovt1_hrs:         c.ovt1Hrs,
    ovt1_pay:         c.ovt1Pay,
    ovt2_hrs:         c.ovt2Hrs,
    ovt2_pay:         c.ovt2Pay,
    ovt3_hrs:         c.ovt3Hrs,
    ovt3_pay:         c.ovt3Pay,
    ovt4_hrs:         c.ovt4Hrs,
    ovt4_pay:         c.ovt4Pay,
    prem_hrs:         c.premHrs,
    prem_pay:         c.premPay,
    total_hours:      c.totalHours,
    total_pay:        c.totalPay,
    gross_rcpts:      c.grossRcpts,
    chrg_rcpts:       c.chrgRcpts,
    chrg_tips:        c.chrgTips,
    drct_tips:        c.drctTips,
    indir_tips:       c.indirTips,
    svc_tips:         c.svcTips,
    tips_pd:          c.tipsPd,
    last_updated_utc: c.lastUpdatedUTC,
    added_utc:        c.addedUTC,
    has_adjustments:  c.hasAdjustments,
    adjustments_json: c.adjustmentsJson as TimecardInsert["adjustments_json"],
    synced_at:        new Date().toISOString(),
  }));

  for (let i = 0; i < tcRows.length; i += BATCH) {
    const chunk = tcRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("labour_timecards")
      .upsert(chunk, { onConflict: "tc_id" });
    if (error) throw new Error(`Timecard upsert failed: ${error.message}`);
    upserted += chunk.length;
  }

  // 4. Build and upsert labour_daily_summary
  await buildAndStoreDailySummary(locRef, businessDate);

  // 5. Update labour_sync_state
  await supabase.from("labour_sync_state").upsert(
    {
      loc_ref:       locRef,
      last_cur_utc:  (tcRes as OracleTimeCardResponse).curUTC ?? null,
      last_bus_dt:   businessDate,
      last_sync_at:  new Date().toISOString(),
      error_message: errors.length > 0 ? errors.join("; ") : null,
    },
    { onConflict: "loc_ref" },
  );

  return { timecardCount: upserted };
}

// ── Labour daily summary builder ──────────────────────────────────────────

async function buildAndStoreDailySummary(locRef: string, businessDate: string): Promise<void> {
  const supabase = createServerClient();

  // Fetch timecards for the date
  const { data: timecards } = await supabase
    .from("labour_timecards")
    .select("total_hours, total_pay, emp_num, jc_num, clk_in_utc, clk_out_utc")
    .eq("loc_ref", locRef)
    .eq("business_date", businessDate);

  if (!timecards || timecards.length === 0) return;

  let totalHours = 0;
  let totalPay   = 0;
  const empSet   = new Set<string>();

  for (const tc of timecards) {
    totalHours += Number(tc.total_hours ?? 0);
    totalPay   += Number(tc.total_pay   ?? 0);
    if (tc.emp_num) empSet.add(tc.emp_num);
  }

  // Fetch net sales for labour % calculation
  const { data: salesRow } = await supabase
    .from("micros_sales_daily")
    .select("net_sales")
    .eq("loc_ref", locRef)
    .eq("business_date", businessDate)
    .maybeSingle();

  const netSales = salesRow?.net_sales ? Number(salesRow.net_sales) : null;
  const labourPct = netSales && netSales > 0
    ? Math.round((totalPay / netSales) * 10000) / 100
    : null;

  type SummaryInsert = Database["public"]["Tables"]["labour_daily_summary"]["Insert"];
  const row: SummaryInsert = {
    loc_ref:             locRef,
    business_date:       businessDate,
    total_pay:           Math.round(totalPay   * 100) / 100,
    total_hours:         Math.round(totalHours * 100) / 100,
    active_staff_count:  empSet.size,
    labour_pct:          labourPct,
    net_sales:           netSales,
    synced_at:           new Date().toISOString(),
  };

  const { error } = await supabase
    .from("labour_daily_summary")
    .upsert(row, { onConflict: "loc_ref,business_date" });

  if (error) {
    logger.warn("labour_daily_summary upsert failed", { locRef, businessDate, err: error.message });
  }
}

// ── Zombie cleanup (stale "running" sync run rows) ────────────────────────

async function cleanupZombies(connectionId: string): Promise<void> {
  const supabase = createServerClient();
  const cutoff   = new Date(Date.now() - ZOMBIE_THRESHOLD_MS).toISOString();
  try {
    await supabase
      .from("micros_sync_runs")
      .update({
        status:        "error",
        completed_at:  new Date().toISOString(),
        error_message: "Sync run timed out (zombie cleanup)",
      })
      .eq("status",        "running")
      .eq("connection_id", connectionId)
      .lt("started_at",    cutoff);
  } catch { /* non-fatal */ }
}

// ── Main public function ──────────────────────────────────────────────────

/**
 * Syncs sales and labour data for a specific location and business date.
 *
 * Uses the multi-location registry and location-client — works for both
 * Si Cantina (PKCE) and Primi Camps Bay (client_credentials).
 *
 * This function must only be called from server-side code (API routes, cron).
 */
export async function runLocationSync(
  cfg: LocationConfig,
  businessDate: string,
): Promise<LocationSyncResult> {
  const locationKey = cfg.key;
  const errors: string[] = [];
  let salesSynced    = false;
  let labourSynced   = false;
  let salesChecks    = 0;
  let labourTimecards = 0;

  const supabase = createServerClient();

  // Fetch DB connection row (needed for connection_id)
  const { data: conn } = await supabase
    .from("micros_connections")
    .select("id, status")
    .eq("location_key", locationKey)
    .maybeSingle();

  if (!conn?.id) {
    return {
      success:      false,
      locationKey,
      businessDate,
      message:      `No micros_connections row found for location_key='${locationKey}'. Run migration 081.`,
      salesSynced:  false,
      labourSynced: false,
      errors:       [`Missing DB connection row for ${locationKey}`],
    };
  }

  await cleanupZombies(conn.id);

  const syncRunId = crypto.randomUUID();
  await supabase.from("micros_sync_runs").insert({
    id:               syncRunId,
    connection_id:    conn.id,
    sync_type:        "full",
    started_at:       new Date().toISOString(),
    status:           "running",
    records_fetched:  0,
    records_inserted: 0,
  });

  await supabase
    .from("micros_connections")
    .update({ status: "syncing" })
    .eq("id", conn.id);

  const t0 = Date.now();

  // ── Sales sync ────────────────────────────────────────────────────────
  try {
    const salesResult = await syncSales(cfg, businessDate, conn.id);
    salesChecks = salesResult.checkCount;
    salesSynced = true;
    logger.info("Location sales sync complete", { locationKey, businessDate, checkCount: salesChecks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Sales: ${msg}`);
    logger.error("Location sales sync failed", { locationKey, businessDate, err: msg });
  }

  // ── Labour sync ────────────────────────────────────────────────────────
  try {
    const labResult = await syncLabour(cfg, businessDate);
    labourTimecards = labResult.timecardCount;
    labourSynced    = true;
    logger.info("Location labour sync complete", { locationKey, businessDate, timecards: labourTimecards });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Labour: ${msg}`);
    logger.error("Location labour sync failed", { locationKey, businessDate, err: msg });
  }

  const success  = salesSynced || labourSynced;
  const elapsed  = Date.now() - t0;
  const now      = new Date().toISOString();
  const errorStr = errors.length > 0 ? errors.join("; ") : null;

  // Update sync run row
  await supabase
    .from("micros_sync_runs")
    .update({
      completed_at:     now,
      status:           success ? "success" : "error",
      records_fetched:  salesChecks + labourTimecards,
      records_inserted: (salesSynced ? 1 : 0) + labourTimecards,
      error_message:    errorStr,
    })
    .eq("id", syncRunId);

  // Update connection row
  await supabase
    .from("micros_connections")
    .update({
      status:                  success ? "connected" : "error",
      last_sync_at:            now,
      last_successful_sync_at: success ? now : undefined,
      last_sync_error:         errorStr,
      // Persist the loc_ref from env var in case the row was seeded with empty string
      loc_ref:                 cfg.locationRef || undefined,
    })
    .eq("id", conn.id);

  const message = success
    ? `Sync complete in ${elapsed}ms — ${salesChecks} guest checks, ${labourTimecards} timecards`
    : `Sync failed after ${elapsed}ms: ${errors.join("; ")}`;

  return {
    success,
    locationKey,
    businessDate,
    message,
    salesSynced,
    labourSynced,
    salesChecks,
    labourTimecards,
    errors,
  };
}
