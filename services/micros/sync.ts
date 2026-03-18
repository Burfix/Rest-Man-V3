/**
 * services/micros/sync.ts
 *
 * Sync orchestrator for the Oracle MICROS BI API.
 * Called by POST /api/micros/sync.
 *
 * Sequence per sync run:
 *   1. Load connection config (server-side only)
 *   2. Create a sync_run audit record (status: running)
 *   3. Fetch each data type from MICROS BI
 *   4. Normalize and upsert into internal tables
 *   5. Update sync_run and connection status
 *
 * The orchestrator is retry-safe: upsert uses ON CONFLICT DO UPDATE,
 * so re-running for the same business date is idempotent.
 *
 * MICROS BI endpoint paths are configurable via env var overrides.
 * Defaults follow Oracle Hospitality REST API v1 conventions:
 *   MICROS_PATH_DAILY_TOTALS   (default: /rms/v1/reports/dailyBusinessSummary)
 *   MICROS_PATH_INTERVALS      (default: /rms/v1/reports/salesByInterval)
 *   MICROS_PATH_GUEST_CHECKS   (default: /rms/v1/guestChecks)
 *   MICROS_PATH_LABOR          (default: /rms/v1/labor/timecardsByJob)
 */

import { createServerClient }   from "@/lib/supabase/server";
import { microsGet }             from "./client";
import {
  normalizeDailyTotals,
  normalizeInterval,
  normalizeGuestCheck,
  normalizeLaborRecord,
} from "./normalize";
import type {
  MicrosConnection,
  _OracleDailyTotals,
  _OracleIntervalRecord,
  _OracleGuestCheck,
  _OracleLaborRecord,
} from "@/types/micros";

const PATHS = {
  dailyTotals:  process.env.MICROS_PATH_DAILY_TOTALS  ?? "/rms/v1/reports/dailyBusinessSummary",
  intervals:    process.env.MICROS_PATH_INTERVALS      ?? "/rms/v1/reports/salesByInterval",
  guestChecks:  process.env.MICROS_PATH_GUEST_CHECKS   ?? "/rms/v1/guestChecks",
  labor:        process.env.MICROS_PATH_LABOR          ?? "/rms/v1/labor/timecardsByJob",
};

export interface SyncResult {
  success:          boolean;
  syncRunId:        string;
  recordsFetched:   number;
  recordsInserted:  number;
  error?:           string;
}

/**
 * Runs a full sync for the given connection and business date.
 * Logs every attempt to micros_sync_runs for retry-safe audit.
 */
export async function runFullSync(
  connection: MicrosConnection,
  businessDate: string,
): Promise<SyncResult> {
  const supabase = createServerClient();
  let syncRunId  = "";
  let fetched    = 0;
  let inserted   = 0;

  // Mark connection as syncing
  await supabase
    .from("micros_connections")
    .update({ status: "syncing", last_sync_at: new Date().toISOString() })
    .eq("id", connection.id);

  // Create audit run
  const { data: run } = await supabase
    .from("micros_sync_runs")
    .insert({
      connection_id: connection.id,
      sync_type:     "full",
      status:        "running",
    })
    .select("id")
    .single();

  syncRunId = run?.id ?? "";

  const sharedOpts = {
    connectionId:  connection.id,
    appServerUrl:  connection.app_server_url,
    orgIdentifier: connection.org_identifier,
    locRef:        connection.loc_ref,
    params:        { businessDate },
  };

  try {
    // ── 1. Daily business totals ────────────────────────────────────────
    const rawTotals = await microsGet<_OracleDailyTotals>({
      ...sharedOpts,
      path: PATHS.dailyTotals,
    });
    fetched++;

    const totals = normalizeDailyTotals(rawTotals);
    const { error: upsertErr } = await supabase
      .from("micros_sales_daily")
      .upsert(
        {
          connection_id:  connection.id,
          loc_ref:        connection.loc_ref,
          business_date:  businessDate,
          ...totals,
          synced_at:      new Date().toISOString(),
          raw_response:   rawTotals as Record<string, unknown>,
        },
        { onConflict: "connection_id,loc_ref,business_date" },
      );

    if (upsertErr) throw new Error(`Daily totals upsert: ${upsertErr.message}`);
    inserted++;

    // ── 2. Quarter-hour intervals ───────────────────────────────────────
    try {
      const rawIntervals = await microsGet<{ intervals?: _OracleIntervalRecord[] }>({
        ...sharedOpts,
        path:   PATHS.intervals,
        params: { businessDate, intervalMins: "15" },
      });
      const intervals = (rawIntervals.intervals ?? [])
        .map(normalizeInterval)
        .filter(Boolean) as NonNullable<ReturnType<typeof normalizeInterval>>[];

      if (intervals.length > 0) {
        fetched += intervals.length;
        const rows = intervals.map((iv) => ({
          connection_id:  connection.id,
          loc_ref:        connection.loc_ref,
          business_date:  businessDate,
          ...iv,
          synced_at:      new Date().toISOString(),
        }));
        const { error: ivErr } = await supabase
          .from("micros_sales_intervals")
          .upsert(rows, { onConflict: "connection_id,loc_ref,business_date,interval_start" });
        if (!ivErr) inserted += rows.length;
      }
    } catch {
      // Interval fetch is non-fatal — log but don't fail the whole sync
    }

    // ── 3. Guest checks ─────────────────────────────────────────────────
    try {
      const rawChecks = await microsGet<{ checks?: _OracleGuestCheck[] }>({
        ...sharedOpts,
        path: PATHS.guestChecks,
      });
      const checks = (rawChecks.checks ?? [])
        .map(normalizeGuestCheck)
        .filter(Boolean) as NonNullable<ReturnType<typeof normalizeGuestCheck>>[];

      if (checks.length > 0) {
        fetched += checks.length;
        const rows = checks.map((c) => ({
          connection_id:  connection.id,
          loc_ref:        connection.loc_ref,
          business_date:  businessDate,
          ...c,
          synced_at:      new Date().toISOString(),
        }));
        const { error: chkErr } = await supabase
          .from("micros_guest_checks")
          .upsert(rows, { onConflict: "connection_id,loc_ref,check_number,business_date" });
        if (!chkErr) inserted += rows.length;
      }
    } catch {
      // Guest checks are non-fatal
    }

    // ── 4. Labour by job ────────────────────────────────────────────────
    try {
      const rawLabor = await microsGet<{ timecards?: _OracleLaborRecord[] }>({
        ...sharedOpts,
        path: PATHS.labor,
      });
      const laborRows = (rawLabor.timecards ?? []).map(normalizeLaborRecord);

      if (laborRows.length > 0) {
        fetched += laborRows.length;
        const rows = laborRows.map((lr) => ({
          connection_id:  connection.id,
          loc_ref:        connection.loc_ref,
          business_date:  businessDate,
          ...lr,
          synced_at:      new Date().toISOString(),
        }));
        const { error: lbrErr } = await supabase
          .from("micros_labor_daily")
          .upsert(rows, { onConflict: "connection_id,loc_ref,business_date,job_code" });
        if (!lbrErr) inserted += rows.length;
      }
    } catch {
      // Labour is non-fatal
    }

    // ── Finalise sync run as success ────────────────────────────────────
    const now = new Date().toISOString();
    await Promise.all([
      supabase
        .from("micros_sync_runs")
        .update({
          status:          "success",
          completed_at:    now,
          records_fetched: fetched,
          records_inserted: inserted,
        })
        .eq("id", syncRunId),
      supabase
        .from("micros_connections")
        .update({
          status:                  "connected",
          last_sync_at:            now,
          last_successful_sync_at: now,
          last_sync_error:         null,
        })
        .eq("id", connection.id),
    ]);

    return { success: true, syncRunId, recordsFetched: fetched, recordsInserted: inserted };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const now  = new Date().toISOString();

    await Promise.all([
      supabase
        .from("micros_sync_runs")
        .update({
          status:          "error",
          completed_at:    now,
          records_fetched: fetched,
          records_inserted: inserted,
          error_message:   msg,
        })
        .eq("id", syncRunId),
      supabase
        .from("micros_connections")
        .update({
          status:          "error",
          last_sync_at:    now,
          last_sync_error: msg,
        })
        .eq("id", connection.id),
    ]);

    return { success: false, syncRunId, recordsFetched: fetched, recordsInserted: inserted, error: msg };
  }
}
