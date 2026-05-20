/**
 * lib/sync/handlers/guest-checks.ts
 *
 * Handler for sync_type: 'guest_checks'
 *
 * Persists individual guest check rows to micros_guest_checks.
 * This is currently zero-populated in production — this handler fixes that.
 *
 * Guest check data enables:
 * - Per-table/cover analysis
 * - Check average trending
 * - Service time calculations
 * - Daily reconciliation vs POS summary (drift detection)
 */

import { type SyncContext, type SyncRequest, type SyncResult, deriveOutcome } from "../contract";
import { buildSimphonyClient, SimphonyError, type SimphonyGuestCheck } from "../simphony-client";
import { logSyncStart, logSyncComplete, logSyncFatal } from "../observability";
import { todayISO } from "@/lib/utils";

interface GuestCheckRow {
  connection_id: string;
  loc_ref: string;
  business_date: string;
  check_id: string;
  check_number: string;  // non-null in DB schema
  table_name: string | null;
  opened_at: string | null;
  guest_count: number;
  sub_total: number;
  discounts: number;
  service_charge: number;
  tax_total: number;
  check_total: number;
  total_paid: number;
  is_closed: boolean;
  closed_at: string | null;
  raw_payload: Record<string, unknown>;
  synced_at: string;
  trace_id: string;
}

export async function runGuestChecksHandler(
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
    sync_type: "guest_checks",
    mode: req.mode,
    business_date,
  });

  const errors: SyncResult["errors"] = [];
  let records_fetched = 0;
  let records_written = 0;
  let records_skipped = 0;

  try {
    const client = buildSimphonyClient(ctx.connection);
    const response = await client.getGuestChecks(ctx.connection.loc_ref, business_date);
    const checks = response.guestChecks ?? [];
    records_fetched = checks.length;

    if (records_fetched === 0) {
      const outcome = deriveOutcome(0, 0, errors);
      const result: SyncResult = {
        ok: true,
        outcome,
        sync_type: "guest_checks",
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

    const rows: GuestCheckRow[] = checks.map((c) => normalizeCheck(c, connection_id, business_date, trace_id));

    if (!ctx.dry_run) {
      // Batch upsert in chunks of 200
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error, count } = await ctx.supabase
          .from("micros_guest_checks")
          .upsert(chunk, { onConflict: "connection_id,check_id" })
          .select("check_id");

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
      records_skipped = records_fetched - records_written - errors.length;
    }

    const outcome = deriveOutcome(records_fetched, records_written, errors);
    const result: SyncResult = {
      ok: outcome !== "failed",
      outcome,
      sync_type: "guest_checks",
      mode: req.mode,
      business_date,
      connection_id,
      records_fetched,
      records_written,
      records_skipped: Math.max(0, records_skipped),
      check_count_captured: records_fetched,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      trace_id,
      errors,
    };

    logSyncComplete({
      trace_id,
      connection_id,
      sync_type: "guest_checks",
      mode: req.mode,
      business_date,
      outcome,
      duration_ms: result.duration_ms,
      records_fetched,
      records_written,
      records_skipped: result.records_skipped,
    });

    return result;
  } catch (err) {
    logSyncFatal(trace_id, connection_id, "guest_checks", business_date, err);

    const isSimphony = err instanceof SimphonyError;
    errors.push({
      code: isSimphony ? err.code : "HANDLER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: isSimphony ? err.retryable : true,
    });

    return {
      ok: false,
      outcome: "failed",
      sync_type: "guest_checks",
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

function normalizeCheck(
  c: SimphonyGuestCheck,
  connection_id: string,
  business_date: string,
  trace_id: string,
): GuestCheckRow {
  const checkId = c.guestCheckId ?? `${c.locRef ?? ""}_${c.checkNum ?? ""}_${business_date}`;
  return {
    connection_id,
    loc_ref: c.locRef ?? "",
    business_date,
    check_id: checkId,
    check_number: c.checkNum != null ? String(c.checkNum) : "",
    table_name: c.tableName ?? null,
    opened_at: null, // opnUtc not available in SimphonyGuestCheck response
    guest_count: c.guestCnt ?? 0,
    sub_total: round2(c.subTtl ?? 0),
    discounts: round2(c.dscTtl ?? 0),
    service_charge: round2(c.svcChgTtl ?? 0),
    tax_total: round2(c.totTax ?? 0),
    check_total: round2(c.chkTtl ?? 0),
    total_paid: round2(c.ttlPmtAmt ?? 0),
    is_closed: c.clsdFlag ?? false,
    closed_at: c.clsdUtc ?? null,
    raw_payload: c as unknown as Record<string, unknown>,
    synced_at: new Date().toISOString(),
    trace_id,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
