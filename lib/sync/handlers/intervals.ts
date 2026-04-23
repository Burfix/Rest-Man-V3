/**
 * lib/sync/handlers/intervals.ts
 *
 * Handler for sync_type: 'intervals'
 *
 * Persists hourly/sub-hourly sales interval data to micros_sales_intervals.
 * This is currently zero-populated in production despite the schema existing.
 *
 * Intervals enable:
 * - Pace-adjusted revenue evaluation (brain/revenue-evaluator.ts)
 * - Historical hourly curve computation for forecast
 * - Peak service window detection
 * - 6pm-7pm pace analysis ("what was our dinner burst?")
 */

import { type SyncContext, type SyncRequest, type SyncResult, deriveOutcome } from "../contract";
import { buildSimphonyClient, SimphonyError, type SimphonySalesInterval } from "../simphony-client";
import { logSyncStart, logSyncComplete, logSyncFatal } from "../observability";
import { todayISO } from "@/lib/utils";

interface SalesIntervalRow {
  connection_id: string;
  loc_ref: string;
  business_date: string;
  interval_start: string;
  interval_end: string;
  hour_of_day: number;
  net_sales: number;
  guest_count: number;
  transaction_count: number;
  synced_at: string;
  trace_id: string;
}

export async function runIntervalsHandler(
  ctx: SyncContext,
  req: SyncRequest,
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const business_date = req.business_date ?? todayISO();
  const trace_id = req.trace_id ?? crypto.randomUUID();
  const connection_id = ctx.connection.id;

  logSyncStart({
    trace_id,
    connection_id,
    sync_type: "intervals",
    mode: req.mode,
    business_date,
  });

  const errors: SyncResult["errors"] = [];
  let records_fetched = 0;
  let records_written = 0;

  try {
    const client = buildSimphonyClient(ctx.connection);
    const response = await client.getSalesIntervals(ctx.connection.loc_ref, business_date, 60);
    const intervals = response.intervals ?? [];
    records_fetched = intervals.length;

    if (records_fetched === 0) {
      const outcome = deriveOutcome(0, 0, errors);
      const result: SyncResult = {
        ok: true,
        outcome,
        sync_type: "intervals",
        mode: req.mode,
        business_date,
        connection_id,
        records_fetched: 0,
        records_written: 0,
        records_skipped: 0,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        trace_id,
        errors,
      };
      logSyncComplete({ ...result, outcome });
      return result;
    }

    const rows: SalesIntervalRow[] = intervals
      .filter((i) => i.intervalStart != null)
      .map((i) => normalizeInterval(i, connection_id, business_date, trace_id));

    if (!ctx.dry_run && rows.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error, count } = await ctx.supabase
          .from("micros_sales_intervals")
          .upsert(chunk, { onConflict: "connection_id,business_date,interval_start" })
          .select("interval_start");

        if (error) {
          errors.push({
            code: "DB_UPSERT_BATCH_FAILED",
            message: `Batch ${Math.floor(i / CHUNK) + 1}: ${error.message}`,
            retryable: true,
          });
        } else {
          records_written += count ?? chunk.length;
        }
      }
    }

    const outcome = deriveOutcome(records_fetched, records_written, errors);
    const result: SyncResult = {
      ok: outcome !== "failed",
      outcome,
      sync_type: "intervals",
      mode: req.mode,
      business_date,
      connection_id,
      records_fetched,
      records_written,
      records_skipped: 0,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      trace_id,
      errors,
    };

    logSyncComplete({
      trace_id,
      connection_id,
      sync_type: "intervals",
      mode: req.mode,
      business_date,
      outcome,
      duration_ms: result.duration_ms,
      records_fetched,
      records_written,
      records_skipped: 0,
    });

    return result;
  } catch (err) {
    logSyncFatal(trace_id, connection_id, "intervals", business_date, err);

    const isSimphony = err instanceof SimphonyError;
    errors.push({
      code: isSimphony ? err.code : "HANDLER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: isSimphony ? err.retryable : true,
    });

    return {
      ok: false,
      outcome: "failed",
      sync_type: "intervals",
      mode: req.mode,
      business_date,
      connection_id,
      records_fetched,
      records_written: 0,
      records_skipped: 0,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      trace_id,
      errors,
    };
  }
}

function normalizeInterval(
  i: SimphonySalesInterval,
  connection_id: string,
  business_date: string,
  trace_id: string,
): SalesIntervalRow {
  const intervalStart = i.intervalStart ?? `${business_date}T${String(i.hour ?? 0).padStart(2, "0")}:00:00`;
  const intervalEnd = i.intervalEnd ?? addHour(intervalStart);
  const hour = i.hour ?? extractHour(intervalStart);

  return {
    connection_id,
    loc_ref: i.locRef ?? "",
    business_date,
    interval_start: intervalStart,
    interval_end: intervalEnd,
    hour_of_day: hour,
    net_sales: round2(i.netSales ?? 0),
    guest_count: i.guestCnt ?? 0,
    transaction_count: i.transactionCount ?? 0,
    synced_at: new Date().toISOString(),
    trace_id,
  };
}

function extractHour(isoOrTime: string): number {
  const match = isoOrTime.match(/T?(\d{1,2}):/);
  return match ? parseInt(match[1], 10) : 0;
}

function addHour(isoOrTime: string): string {
  try {
    const d = new Date(isoOrTime);
    d.setHours(d.getHours() + 1);
    return d.toISOString();
  } catch {
    return isoOrTime;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
