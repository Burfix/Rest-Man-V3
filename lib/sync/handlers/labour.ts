/**
 * lib/sync/handlers/labour.ts
 *
 * Unified handler for sync_type: 'labour'
 *
 * Consolidates runLabourFullSync / runLabourDeltaSync into the new
 * SyncRequest/SyncResult contract. Internally delegates to the existing
 * proven service — this is an adapter layer, not a rewrite.
 *
 * mode: 'backfill' = full sync for a specific business_date
 * mode: 'full'     = full sync for today
 * mode: 'delta'    = cursor-based since-last-changed sync
 */

import { type SyncContext, type SyncRequest, type SyncResult, deriveOutcome } from "../contract";
import { logSyncStart, logSyncComplete, logSyncFatal } from "../observability";
import { runLabourFullSync, runLabourDeltaSync } from "@/services/micros/labour/sync";
import { todayISO } from "@/lib/utils";

export async function runLabourHandler(
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
    sync_type: "labour",
    mode: req.mode,
    business_date,
  });

  const errors: SyncResult["errors"] = [];

  try {
    // dry_run: skip actual DB writes
    if (ctx.dry_run) {
      return {
        ok: true,
        outcome: "success",
        sync_type: "labour",
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
        errors: [],
      };
    }

    let inner: Awaited<ReturnType<typeof runLabourFullSync>>;

    if (req.mode === "delta") {
      inner = await runLabourDeltaSync();
    } else {
      // mode: 'full' or 'backfill' — pass the specific date
      inner = await runLabourFullSync(business_date);
    }

    const records_written = inner.timecardsUpserted ?? 0;
    const records_fetched = records_written; // LabourSyncResult only reports upserted
    const records_skipped = 0;

    if (!inner.success && inner.errors && inner.errors.length > 0) {
      for (const e of inner.errors) {
        errors.push({ code: "LABOUR_SYNC_ERROR", message: e, retryable: true });
      }
    }

    const outcome = deriveOutcome(
      records_fetched,
      records_written,
      errors,
    );

    const result: SyncResult = {
      ok: outcome !== "failed",
      outcome,
      sync_type: "labour",
      mode: req.mode,
      business_date,
      connection_id,
      records_fetched,
      records_written,
      records_skipped,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      trace_id,
      errors,
    };

    logSyncComplete({
      trace_id,
      connection_id,
      sync_type: "labour",
      mode: req.mode,
      business_date,
      outcome,
      duration_ms: result.duration_ms,
      records_fetched,
      records_written,
      records_skipped,
    });

    return result;
  } catch (err) {
    logSyncFatal(trace_id, connection_id, "labour", business_date, err);

    errors.push({
      code: "HANDLER_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    });

    return {
      ok: false,
      outcome: "failed",
      sync_type: "labour",
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
  }
}
