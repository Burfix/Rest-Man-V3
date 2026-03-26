/**
 * services/micros/labour/sync.ts
 *
 * Labour sync orchestrator — pulls timecard and job code data from
 * Oracle MICROS BI API, normalizes, and upserts into Supabase.
 *
 * Supports:
 *   - Full sync by business date
 *   - Delta sync using changedSinceUTC (curUTC from previous response)
 *   - Open timecard handling (timecards without clock-out update on next sync)
 *   - Sync state persistence for cursor tracking
 */

import { createServerClient } from "@/lib/supabase/server";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { seedMicrosTokenCache, getCachedMicrosToken } from "@/lib/micros/auth";
import { todayISO } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { getTimeCardDetails, getJobCodeDimensions } from "./client";
import { normalizeTimecards, normalizeJobCodes } from "./normalize";
import { buildDailySummary } from "./summary";
import type { Database } from "@/types/database";
import type {
  NormalizedTimecard,
  NormalizedJobCode,
  LabourSyncResult,
  LabourSyncState,
  OracleTimeCard,
} from "@/types/labour";

type SyncStateRow = Database["public"]["Tables"]["labour_sync_state"]["Row"];

// ── Helper: flatten Oracle businessDates → flat timeCards array ───────────

function flattenTimeCards(
  res: { businessDates?: { busDt: string; timeCardDetails: OracleTimeCard[] | null }[] | null },
): OracleTimeCard[] {
  if (!res.businessDates) return [];
  const out: OracleTimeCard[] = [];
  for (const bucket of res.businessDates) {
    if (bucket.timeCardDetails) {
      for (const tc of bucket.timeCardDetails) {
        // Inject busDt from the bucket so normalizer has it
        if (!tc.busDt) tc.busDt = bucket.busDt;
        out.push(tc);
      }
    }
  }
  return out;
}

// ── Sync state helpers ────────────────────────────────────────────────────

async function getSyncState(locRef: string): Promise<LabourSyncState | null> {
  const sb = createServerClient();
  const { data } = await sb
    .from("labour_sync_state")
    .select("*")
    .eq("loc_ref", locRef)
    .returns<SyncStateRow[]>()
    .single();

  if (!data) return null;
  return {
    locRef: data.loc_ref,
    lastCurUTC: data.last_cur_utc,
    lastBusDt: data.last_bus_dt,
    lastSyncAt: data.last_sync_at,
    errorMessage: data.error_message,
  };
}

async function upsertSyncState(
  locRef: string,
  curUTC: string | null,
  busDt: string | null,
  errorMessage: string | null,
): Promise<void> {
  const sb = createServerClient();
  await sb.from("labour_sync_state").upsert(
    {
      loc_ref: locRef,
      last_cur_utc: curUTC,
      last_bus_dt: busDt,
      last_sync_at: new Date().toISOString(),
      error_message: errorMessage,
    },
    { onConflict: "loc_ref" },
  );
}

// ── Upsert timecards ─────────────────────────────────────────────────────

async function upsertTimecards(cards: NormalizedTimecard[]): Promise<number> {
  if (cards.length === 0) return 0;
  const sb = createServerClient();

  type TimecardInsert = Database["public"]["Tables"]["labour_timecards"]["Insert"];

  const rows: TimecardInsert[] = cards.map((c) => ({
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
    adjustments_json: c.adjustmentsJson as Database["public"]["Tables"]["labour_timecards"]["Insert"]["adjustments_json"],
    synced_at:        new Date().toISOString(),
  }));

  // Batch in chunks of 200 to avoid payload limits
  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await sb
      .from("labour_timecards")
      .upsert(chunk, { onConflict: "tc_id" });
    if (error) throw new Error(`Timecard upsert failed: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

// ── Upsert job codes ─────────────────────────────────────────────────────

async function upsertJobCodes(codes: NormalizedJobCode[]): Promise<number> {
  if (codes.length === 0) return 0;
  const sb = createServerClient();

  const rows = codes.map((c) => ({
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

  const { error } = await sb
    .from("labour_job_codes")
    .upsert(rows, { onConflict: "loc_ref,num" });

  if (error) throw new Error(`Job code upsert failed: ${error.message}`);
  return rows.length;
}

// ── Full sync ─────────────────────────────────────────────────────────────

export async function runLabourFullSync(
  date?: string,
): Promise<LabourSyncResult> {
  const cfg = getMicrosEnvConfig();
  const locRef = cfg.locRef;
  const businessDate = date ?? todayISO();
  const errors: string[] = [];

  // Seed in-memory token cache from DB to avoid PKCE on cold-starts
  try {
    const sb = createServerClient();
    const { data: tokenRow } = await sb
      .from("micros_connections")
      .select("id, access_token, token_expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tokenRow?.access_token && tokenRow?.token_expires_at) {
      const expiresAt = new Date(tokenRow.token_expires_at).getTime();
      const refreshToken = (tokenRow as Record<string, unknown>)?.refresh_token as string | undefined;
      if (expiresAt > Date.now()) {
        seedMicrosTokenCache(tokenRow.access_token, expiresAt, refreshToken);
      }
    }
  } catch {
    // Non-fatal — refresh_token column may not exist yet
  }

  try {
    // 1. Sync job codes
    let jobCodeCount = 0;
    try {
      const jcRes = await getJobCodeDimensions({ locRef });
      const normalized = normalizeJobCodes(jcRes.jobCodes, locRef);
      jobCodeCount = await upsertJobCodes(normalized);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Job codes: ${msg}`);
      // Non-fatal — continue with timecard sync
    }

    // 2. Fetch timecards
    const tcRes = await getTimeCardDetails({ busDt: businessDate, locRef });
    const rawCards = flattenTimeCards(tcRes);
    const cards = normalizeTimecards(rawCards, tcRes.locRef || locRef);
    const upserted = await upsertTimecards(cards);

    // 3. Build and upsert daily summary
    try {
      await buildAndStoreDailySummary(locRef, businessDate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Summary: ${msg}`);
    }

    // 4. Save sync cursor
    await upsertSyncState(
      locRef,
      tcRes.curUTC ?? null,
      businessDate,
      errors.length > 0 ? errors.join("; ") : null,
    );

    // 5. Persist token to DB for cold-start resilience
    try {
      const tokenInfo = getCachedMicrosToken();
      if (tokenInfo) {
        const sb = createServerClient();
        const update: Record<string, unknown> = {
          access_token: tokenInfo.idToken,
          token_expires_at: new Date(tokenInfo.expiresAt).toISOString(),
        };
        if (tokenInfo.refreshToken) update.refresh_token = tokenInfo.refreshToken;
        await sb.from("micros_connections").update(update).order("created_at", { ascending: false }).limit(1);
      }
    } catch { /* non-fatal — refresh_token column may not exist */ }

    logger.info("Labour full sync completed", {
      businessDate, timecards: upserted, jobCodes: jobCodeCount,
      errors: errors.length > 0 ? errors : undefined,
    });

    return {
      success: true,
      mode: "full",
      message: `Full sync: ${upserted} timecards, ${jobCodeCount} job codes for ${businessDate}`,
      businessDate,
      timecardsUpserted: upserted,
      jobCodesSynced: jobCodeCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Labour full sync failed", { businessDate, error: msg });
    await upsertSyncState(locRef, null, businessDate, msg).catch(() => {});
    return {
      success: false,
      mode: "full",
      message: msg,
      businessDate,
      errors: [msg, ...errors],
    };
  }
}

// ── Delta sync ────────────────────────────────────────────────────────────

export async function runLabourDeltaSync(): Promise<LabourSyncResult> {
  const cfg = getMicrosEnvConfig();
  const locRef = cfg.locRef;
  const errors: string[] = [];

  // Seed in-memory token cache from DB (same as full sync)
  try {
    const sb = createServerClient();
    const { data: tokenRow } = await sb
      .from("micros_connections")
      .select("id, access_token, token_expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tokenRow?.access_token && tokenRow?.token_expires_at) {
      const expiresAt = new Date(tokenRow.token_expires_at).getTime();
      const refreshToken = (tokenRow as Record<string, unknown>)?.refresh_token as string | undefined;
      if (expiresAt > Date.now()) {
        seedMicrosTokenCache(tokenRow.access_token, expiresAt, refreshToken);
      }
    }
  } catch {
    // Non-fatal — refresh_token column may not exist yet
  }

  try {
    const state = await getSyncState(locRef);

    // If no previous sync state, fall back to full sync for today
    if (!state?.lastCurUTC) {
      return runLabourFullSync();
    }

    // Fetch timecards changed since last curUTC
    const tcRes = await getTimeCardDetails({
      changedSinceUTC: state.lastCurUTC,
      locRef,
    });

    const cards = normalizeTimecards(flattenTimeCards(tcRes), tcRes.locRef || locRef);
    const upserted = await upsertTimecards(cards);

    // Re-build daily summary for all affected dates
    const affectedDates = Array.from(new Set(cards.map((c) => c.businessDate)));
    for (const dt of affectedDates) {
      try {
        await buildAndStoreDailySummary(locRef, dt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Summary ${dt}: ${msg}`);
      }
    }

    // Update sync cursor
    await upsertSyncState(
      locRef,
      tcRes.curUTC ?? state.lastCurUTC,
      state.lastBusDt,
      errors.length > 0 ? errors.join("; ") : null,
    );

    logger.info("Labour delta sync completed", {
      timecards: upserted, affectedDates: affectedDates.length,
      errors: errors.length > 0 ? errors : undefined,
    });

    return {
      success: true,
      mode: "delta",
      message: `Delta sync: ${upserted} timecards updated since ${state.lastCurUTC}`,
      timecardsUpserted: upserted,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Labour delta sync failed", { error: msg });
    await upsertSyncState(locRef, null, null, msg).catch(() => {});
    return {
      success: false,
      mode: "delta",
      message: msg,
      errors: [msg, ...errors],
    };
  }
}

// ── Daily summary builder ─────────────────────────────────────────────────

async function buildAndStoreDailySummary(
  locRef: string,
  businessDate: string,
): Promise<void> {
  const summary = await buildDailySummary(locRef, businessDate);
  const sb = createServerClient();

  type SummaryInsert = Database["public"]["Tables"]["labour_daily_summary"]["Insert"];

  const row: SummaryInsert = {
    loc_ref:            locRef,
    business_date:      businessDate,
    total_hours:        summary.totalLabourHours,
    total_pay:          summary.totalLabourCost,
    reg_hours:          summary.regularHours,
    reg_pay:            summary.regularCost,
    ovt_hours:          summary.overtimeHours,
    ovt_pay:            summary.overtimeCost,
    prem_hours:         summary.premiumHours,
    prem_pay:           summary.premiumCost,
    active_staff_count: summary.activeStaffCount,
    open_timecard_count: summary.openTimecardCount,
    net_sales:          summary.netSales,
    labour_pct:         summary.labourPercentOfSales,
    by_role_json:       JSON.parse(JSON.stringify(summary.byRole)),
    by_category_json:   JSON.parse(JSON.stringify(summary.byCategory)),
    by_rvc_json:        JSON.parse(JSON.stringify(summary.byRevenueCenter)),
    synced_at:          new Date().toISOString(),
  };

  const { error } = await sb.from("labour_daily_summary").upsert(
    row,
    { onConflict: "loc_ref,business_date" },
  );

  if (error) throw new Error(`Daily summary upsert: ${error.message}`);
}
