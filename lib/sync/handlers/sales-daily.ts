/**
 * lib/sync/handlers/sales-daily.ts
 *
 * Handler for sync_type: 'intraday_sales' and 'daily_sales'
 *
 * Strategy:
 * - Fetches guest checks from Oracle Simphony
 * - Aggregates to a single daily sales row (net sales, check count, covers)
 * - Upserts into micros_sales_daily keyed on (connection_id, business_date)
 * - Returns empty outcome when Oracle returns zero checks on a likely-trading day
 */

import { type SyncContext, type SyncRequest, type SyncResult, deriveOutcome } from "../contract";
import { buildSimphonyClient, SimphonyError } from "../simphony-client";
import { logSyncStart, logSyncComplete, logSyncFatal } from "../observability";
import { todayISO } from "@/lib/utils";

interface DailySalesRow {
  connection_id: string;
  loc_ref: string;
  business_date: string;
  net_sales: number;
  gross_sales: number;
  guest_count: number;
  check_count: number;
  discounts: number;
  service_charge: number;
  tax_total: number;
  voids: number;
  synced_at: string;
  sync_mode: string;
  trace_id: string;
}

export async function runSalesDailyHandler(
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
    sync_type: req.sync_type,
    mode: req.mode,
    business_date,
  });

  const errors: SyncResult["errors"] = [];
  let records_fetched = 0;
  let records_written = 0;

  try {
    const client = buildSimphonyClient(ctx.connection);

    // Fetch guest checks — this is the source of truth for daily revenue
    const response = await client.getGuestChecks(ctx.connection.loc_ref, business_date);

    const checks = response.guestChecks ?? [];
    records_fetched = checks.length;

    // Aggregate from guest checks (not Oracle's summary endpoint)
    // This catches POS reporting drift
    let net_sales = 0;
    let gross_sales = 0;
    let guest_count = 0;
    let discounts = 0;
    let service_charge = 0;
    let tax_total = 0;
    let voids = 0;

    for (const check of checks) {
      const chkTotal = check.chkTtl ?? 0;
      const dscTotal = check.dscTtl ?? 0;
      const svcChg = check.svcChgTtl ?? 0;
      const tax = check.totTax ?? 0;
      const guests = check.guestCnt ?? 0;

      gross_sales += chkTotal;
      net_sales += chkTotal - dscTotal;
      discounts += dscTotal;
      service_charge += svcChg;
      tax_total += tax;
      guest_count += guests;
    }

    const row: DailySalesRow = {
      connection_id,
      loc_ref: ctx.connection.loc_ref,
      business_date,
      net_sales: round2(net_sales),
      gross_sales: round2(gross_sales),
      guest_count,
      check_count: checks.length,
      discounts: round2(discounts),
      service_charge: round2(service_charge),
      tax_total: round2(tax_total),
      voids: round2(voids),
      synced_at: new Date().toISOString(),
      sync_mode: req.mode,
      trace_id,
    };

    if (!ctx.dry_run && records_fetched > 0) {
      const { error } = await ctx.supabase
        .from("micros_sales_daily")
        .upsert(row, { onConflict: "connection_id,business_date" });

      if (error) {
        errors.push({
          code: "DB_UPSERT_FAILED",
          message: error.message,
          retryable: true,
        });
      } else {
        records_written = 1;
      }
    } else if (ctx.dry_run && records_fetched > 0) {
      records_written = 0; // dry run — would have written
    }

    const outcome = deriveOutcome(records_fetched, records_written, errors);
    const result: SyncResult = {
      ok: outcome !== "failed",
      outcome,
      sync_type: req.sync_type,
      mode: req.mode,
      business_date,
      connection_id,
      records_fetched,
      records_written,
      records_skipped: 0,
      net_sales_captured: records_fetched > 0 ? net_sales : undefined,
      check_count_captured: records_fetched > 0 ? checks.length : undefined,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      trace_id,
      errors,
    };

    logSyncComplete({
      trace_id,
      connection_id,
      sync_type: req.sync_type,
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
    logSyncFatal(trace_id, connection_id, req.sync_type, business_date, err);

    const isSimphony = err instanceof SimphonyError;
    errors.push({
      code: isSimphony ? err.code : "HANDLER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: isSimphony ? err.retryable : true,
    });

    return {
      ok: false,
      outcome: "failed",
      sync_type: req.sync_type,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
