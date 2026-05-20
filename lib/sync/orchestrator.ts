/**
 * lib/sync/orchestrator.ts
 *
 * The single chokepoint for all sync operations.
 *
 * Every sync call — from UI, cron, or admin backfill — goes through here.
 * It:
 * 1. Resolves connection_id from loc_ref (tenant-scoped, no hardcoded UUIDs)
 * 2. Starts a micros_sync_runs row with status='running'
 * 3. Builds a SyncContext and dispatches to the right handler
 * 4. Closes the run row with the full SyncResult
 * 5. If outcome === 'empty' and suspicious, emits a warning log
 * 6. Returns the typed SyncResult
 *
 * DRY_RUN=true: claims work, calls handlers, but writes only to the run log.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  type SyncRequest,
  type SyncResult,
  type SyncContext,
  type SyncOutcome,
  SyncTypeEnum,
} from "./contract";
import { logSuspiciousEmpty } from "./observability";
import { runSalesDailyHandler } from "./handlers/sales-daily";
import { runGuestChecksHandler } from "./handlers/guest-checks";
import { runIntervalsHandler } from "./handlers/intervals";
import { runLabourHandler } from "./handlers/labour";
import { todayISO } from "@/lib/utils";

const DRY_RUN = process.env.DRY_RUN === "true";

// ── Connection row shape from micros_connections ──────────────────────────────

interface MicrosConnection {
  id: string;
  loc_ref: string;
  site_id: string;
  auth_server_url: string;
  app_server_url: string;
  client_id: string;
  org_identifier: string;
  status: string;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Dispatch a sync request through the full orchestration pipeline.
 *
 * @param rawReq - The incoming SyncRequest (validated by caller)
 * @param callerSiteId - The site_id of the authenticated caller (for tenant isolation)
 * @param traceId - Correlation ID supplied by the scheduler or API route
 */
export async function dispatchSync(
  rawReq: SyncRequest,
  callerSiteId: string,
  traceId?: string,
): Promise<SyncResult> {
  const trace_id = traceId ?? rawReq.trace_id ?? crypto.randomUUID();
  const business_date = rawReq.business_date ?? todayISO();
  const req: SyncRequest = { ...rawReq, trace_id, business_date };

  const supabase = createServerClient();

  // ── Step 1: Resolve connection (tenant-scoped) ────────────────────────────
  // site_id added via migration — cast until Supabase types are regenerated
  const db = supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> };
  const { data: connection, error: connErr } = await (db.from("micros_connections") as ReturnType<typeof supabase.from>)
    .select(
      "id, loc_ref, site_id, auth_server_url, app_server_url, client_id, org_identifier, status",
    )
    .eq("loc_ref", req.loc_ref)
    .eq("site_id", callerSiteId) // <-- multi-tenant isolation
    .eq("status", "connected")
    .maybeSingle() as unknown as { data: MicrosConnection | null; error: { message: string } | null };

  if (connErr || !connection) {
    const msg = connErr?.message ?? `No connected Micros connection for loc_ref=${req.loc_ref}`;
    logger.error("orchestrator.connection_not_found", { trace_id, loc_ref: req.loc_ref, callerSiteId, msg });
    return failedResult(req, "00000000-0000-0000-0000-000000000000", business_date, trace_id, [
      { code: "CONNECTION_NOT_FOUND", message: msg, retryable: false },
    ]);
  }

  const typedConn = connection;

  // ── Step 2: Start run row ─────────────────────────────────────────────────
  const runId = await startRunRow(supabase, typedConn.id, req, trace_id);

  // ── Step 3: Build context ─────────────────────────────────────────────────
  const ctx: SyncContext = {
    supabase,
    trace_id,
    connection: {
      id: typedConn.id,
      loc_ref: typedConn.loc_ref,
      site_id: typedConn.site_id,
      auth_server_url: typedConn.auth_server_url,
      app_server_url: typedConn.app_server_url,
      client_id: typedConn.client_id,
      org_identifier: typedConn.org_identifier,
    },
    dry_run: DRY_RUN,
  };

  // ── Step 4: Dispatch ──────────────────────────────────────────────────────
  let result: SyncResult;
  try {
    result = await dispatch(ctx, req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("orchestrator.handler_crash", { trace_id, connection_id: typedConn.id, err: msg });
    result = failedResult(req, typedConn.id, business_date, trace_id, [
      { code: "HANDLER_CRASH", message: msg, retryable: true },
    ]);
  }

  // ── Step 5: Close run row ─────────────────────────────────────────────────
  if (runId) {
    await closeRunRow(supabase, runId, result);
  }

  // ── Step 6: Suspicious-empty check ───────────────────────────────────────
  if (result.outcome === "empty") {
    await checkSuspiciousEmpty(supabase, result, trace_id);
  }

  return result;
}

// ── Handler dispatch table ────────────────────────────────────────────────────

async function dispatch(ctx: SyncContext, req: SyncRequest): Promise<SyncResult> {
  switch (req.sync_type) {
    case "intraday_sales":
    case "daily_sales":
      return runSalesDailyHandler(ctx, req);
    case "guest_checks":
      return runGuestChecksHandler(ctx, req);
    case "intervals":
      return runIntervalsHandler(ctx, req);
    case "labour":
      return runLabourHandler(ctx, req);
    default: {
      // exhaustive check
      const exhaustive: never = req.sync_type;
      throw new Error(`Unknown sync_type: ${String(exhaustive)}`);
    }
  }
}

// ── Run row helpers ───────────────────────────────────────────────────────────

async function startRunRow(
  supabase: ReturnType<typeof createServerClient>,
  connectionId: string,
  req: SyncRequest,
  traceId: string,
): Promise<string | null> {
  const runId = crypto.randomUUID();
  const { error } = await supabase.from("micros_sync_runs").insert({
    id: runId,
    connection_id: connectionId,
    sync_type: req.sync_type,
    mode: req.mode,
    status: "running",
    business_date: req.business_date,
    trace_id: traceId,
    started_at: new Date().toISOString(),
  });

  if (error) {
    logger.warn("orchestrator.run_row_start_failed", { runId, connectionId, error: error.message });
    return null;
  }
  return runId;
}

async function closeRunRow(
  supabase: ReturnType<typeof createServerClient>,
  runId: string,
  result: SyncResult,
): Promise<void> {
  const { error } = await supabase
    .from("micros_sync_runs")
    .update({
      status: outcomeToStatus(result.outcome),
      outcome: result.outcome,
      records_fetched: result.records_fetched,
      records_written: result.records_written,
      records_skipped: result.records_skipped,
      net_sales_captured: result.net_sales_captured ?? null,
      error_message:
        result.errors.length > 0 ? result.errors.map((e) => e.message).join("; ").slice(0, 500) : null,
      completed_at: result.completed_at,
      duration_ms: result.duration_ms,
    })
    .eq("id", runId);

  if (error) {
    logger.warn("orchestrator.run_row_close_failed", { runId, error: error.message });
  }
}

function outcomeToStatus(outcome: SyncOutcome): string {
  if (outcome === "success" || outcome === "empty") return "success";
  if (outcome === "partial") return "partial";
  return "error";
}

// ── Suspicious-empty detection ────────────────────────────────────────────────

async function checkSuspiciousEmpty(
  supabase: ReturnType<typeof createServerClient>,
  result: SyncResult,
  trace_id: string,
): Promise<void> {
  try {
    // Query the suspicious_sync_runs view (already exists in Supabase)
    const { data } = await supabase
      .from("suspicious_sync_runs")
      .select("connection_id, business_date, sync_type")
      .eq("connection_id", result.connection_id)
      .eq("business_date", result.business_date)
      .eq("sync_type", result.sync_type)
      .maybeSingle();

    if (data) {
      logSuspiciousEmpty({
        trace_id,
        connection_id: result.connection_id,
        sync_type: result.sync_type,
        business_date: result.business_date,
        note: "Zero records returned on a likely trading day — check POS connectivity",
      });

      // Alert hook — import lazily to avoid circular deps
      const { maybeSendSuspiciousEmptyAlert } = await import("@/lib/alerts/slack");
      await maybeSendSuspiciousEmptyAlert({
        connection_id: result.connection_id,
        sync_type: result.sync_type,
        business_date: result.business_date,
        trace_id,
      });
    }
  } catch (err) {
    logger.warn("orchestrator.suspicious_check_failed", { trace_id, err: String(err) });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function failedResult(
  req: SyncRequest,
  connection_id: string,
  business_date: string,
  trace_id: string,
  errors: SyncResult["errors"],
): SyncResult {
  const now = new Date().toISOString();
  return {
    ok: false,
    outcome: "failed",
    sync_type: req.sync_type,
    mode: req.mode,
    business_date,
    connection_id,
    records_fetched: 0,
    records_written: 0,
    records_skipped: 0,
    started_at: now,
    completed_at: now,
    duration_ms: 0,
    trace_id,
    errors,
  };
}
