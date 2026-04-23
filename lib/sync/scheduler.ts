/**
 * lib/sync/scheduler.ts
 *
 * The tick() function — called by the 5-minute intraday cron.
 *
 * Each tick:
 * 1. Opens a sync_scheduler_ticks row
 * 2. Calls get_due_intraday_syncs() — on-schedule jobs
 * 3. Calls claim_sync_work(worker_id, limit, ttl) — backfill queue items
 * 4. Merges and dispatches through the orchestrator
 * 5. Calls record_scheduled_sync_run() for intraday items
 * 6. Calls complete_sync_work() for queue items
 * 7. Closes the tick row with aggregate counts
 * 8. Bails out at max_duration_ms - 3000ms to avoid Vercel cold-kill mid-write
 *
 * Multi-tenant: every dispatched job is scoped to its own site_id via the
 * orchestrator's connection resolution.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { logSchedulerTick } from "./observability";
import { dispatchSync } from "./orchestrator";
import {
  type TickConfig,
  type TickResult,
  type DueSync,
  type ClaimedWork,
  DueSync as DueSyncSchema,
  ClaimedWork as ClaimedWorkSchema,
} from "./contract";
import { todayISO } from "@/lib/utils";

const WORKER_ID = `vercel-${process.env.VERCEL_REGION ?? "cpt1"}-${process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 8) ?? "local"}`;
const CLAIM_TTL_SECONDS = 120; // 2 minutes — orphaned claims self-release

export async function tick(config: TickConfig): Promise<TickResult> {
  const t0 = Date.now();
  const tickId = crypto.randomUUID();
  const supabase = createServerClient();
  const deadline = t0 + config.max_duration_ms - 3_000; // 3s safety margin

  let intraday_dispatched = 0;
  let backfill_dispatched = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let bailed_early = false;

  // ── Step 1: Open tick row ─────────────────────────────────────────────────
  await openTickRow(supabase, tickId, config);

  try {
    // ── Step 2: Intraday syncs ──────────────────────────────────────────────
    const dueSyncs = await getDueSyncs(supabase);

    for (const due of dueSyncs) {
      if (Date.now() > deadline) { bailed_early = true; break; }
      if (intraday_dispatched + backfill_dispatched >= config.max_jobs_per_tick) break;

      intraday_dispatched++;
      const result = await dispatchOne(due.connection_id, {
        loc_ref: due.loc_ref,
        sync_type: due.sync_type,
        mode: "delta",
        business_date: todayISO(),
        trace_id: config.trace_id,
      }, due.site_id, config.dry_run);

      if (result.ok) { succeeded++; } else { failed++; }

      // Record the scheduled sync outcome back to the DB
      if (!config.dry_run) {
        await recordScheduledRun(supabase, due.connection_id, due.sync_type, result.ok, result.errors?.[0]?.message);
      }
    }

    if (bailed_early) {
      logger.warn("scheduler.bailed_intraday", { tickId, reason: "deadline exceeded" });
    }

    // ── Step 3: Backfill queue ──────────────────────────────────────────────
    const remaining = config.max_jobs_per_tick - (intraday_dispatched + backfill_dispatched);
    if (remaining > 0 && !bailed_early) {
      const claimed = await claimWork(supabase, remaining);

      for (const work of claimed) {
        if (Date.now() > deadline) { bailed_early = true; break; }

        backfill_dispatched++;
        const result = await dispatchOne(work.connection_id, {
          loc_ref: work.loc_ref,
          sync_type: work.sync_type,
          mode: "backfill",
          business_date: work.business_date,
          trace_id: config.trace_id,
        }, work.site_id, config.dry_run);

        if (result.ok) { succeeded++; } else { failed++; }

        // Release or requeue
        if (!config.dry_run) {
          await completeWork(supabase, work.queue_id, result.ok, result.errors?.[0]?.message);
        }
      }
    }
  } catch (err) {
    logger.error("scheduler.tick_error", { tickId, err: String(err) });
    failed++;
  }

  const duration_ms = Date.now() - t0;

  // ── Step 7: Close tick row ────────────────────────────────────────────────
  await closeTickRow(supabase, tickId, {
    intraday_dispatched,
    backfill_dispatched,
    succeeded,
    failed,
    skipped,
    duration_ms,
    bailed_early,
  });

  const result: TickResult = {
    tick_id: tickId,
    trace_id: config.trace_id,
    invocation_source: config.invocation_source,
    intraday_dispatched,
    backfill_dispatched,
    succeeded,
    failed,
    skipped,
    duration_ms,
    dry_run: config.dry_run,
    bailed_early,
  };

  logSchedulerTick({
    tick_id: tickId,
    trace_id: config.trace_id,
    invocation_source: config.invocation_source,
    intraday_count: intraday_dispatched,
    backfill_count: backfill_dispatched,
    duration_ms,
    dry_run: config.dry_run,
  });

  return result;
}

// ── Supabase RPC wrappers ─────────────────────────────────────────────────────

async function getDueSyncs(supabase: ReturnType<typeof createServerClient>): Promise<DueSync[]> {
  const { data, error } = await supabase.rpc("get_due_intraday_syncs");
  if (error) {
    logger.warn("scheduler.get_due_syncs_failed", { error: error.message });
    return [];
  }
  const rows = (data ?? []) as unknown[];
  return rows
    .map((r) => {
      const parsed = DueSyncSchema.safeParse(r);
      if (!parsed.success) {
        logger.warn("scheduler.due_sync_parse_failed", { row: r, issues: parsed.error.issues });
        return null;
      }
      return parsed.data;
    })
    .filter((r): r is DueSync => r !== null);
}

async function claimWork(
  supabase: ReturnType<typeof createServerClient>,
  limit: number,
): Promise<ClaimedWork[]> {
  const { data, error } = await supabase.rpc("claim_sync_work", {
    worker_id: WORKER_ID,
    p_limit: limit,
    ttl_seconds: CLAIM_TTL_SECONDS,
  });
  if (error) {
    logger.warn("scheduler.claim_work_failed", { error: error.message });
    return [];
  }
  const rows = (data ?? []) as unknown[];
  return rows
    .map((r) => {
      const parsed = ClaimedWorkSchema.safeParse(r);
      if (!parsed.success) {
        logger.warn("scheduler.claimed_work_parse_failed", { row: r, issues: parsed.error.issues });
        return null;
      }
      return parsed.data;
    })
    .filter((r): r is ClaimedWork => r !== null);
}

async function recordScheduledRun(
  supabase: ReturnType<typeof createServerClient>,
  connectionId: string,
  syncType: string,
  success: boolean,
  errorMsg?: string,
): Promise<void> {
  const { error } = await supabase.rpc("record_scheduled_sync_run", {
    p_connection_id: connectionId,
    p_sync_type: syncType,
    p_success: success,
    p_error: errorMsg ?? null,
  });
  if (error) {
    logger.warn("scheduler.record_scheduled_run_failed", { connectionId, error: error.message });
  }
}

async function completeWork(
  supabase: ReturnType<typeof createServerClient>,
  queueId: string,
  success: boolean,
  errorMsg?: string,
): Promise<void> {
  const { error } = await supabase.rpc("complete_sync_work", {
    p_queue_id: queueId,
    p_success: success,
    p_error: errorMsg ?? null,
  });
  if (error) {
    logger.warn("scheduler.complete_work_failed", { queueId, error: error.message });
  }
}

// ── Tick row helpers ──────────────────────────────────────────────────────────

async function openTickRow(
  supabase: ReturnType<typeof createServerClient>,
  tickId: string,
  config: TickConfig,
): Promise<void> {
  const { error } = await supabase.from("sync_scheduler_ticks").insert({
    id: tickId,
    trace_id: config.trace_id,
    invocation_source: config.invocation_source,
    dry_run: config.dry_run,
    status: "running",
    started_at: new Date().toISOString(),
  });
  if (error) {
    logger.warn("scheduler.open_tick_failed", { tickId, error: error.message });
  }
}

async function closeTickRow(
  supabase: ReturnType<typeof createServerClient>,
  tickId: string,
  stats: {
    intraday_dispatched: number;
    backfill_dispatched: number;
    succeeded: number;
    failed: number;
    skipped: number;
    duration_ms: number;
    bailed_early: boolean;
  },
): Promise<void> {
  const { error } = await supabase
    .from("sync_scheduler_ticks")
    .update({
      status: "complete",
      intraday_dispatched: stats.intraday_dispatched,
      backfill_dispatched: stats.backfill_dispatched,
      succeeded: stats.succeeded,
      failed: stats.failed,
      skipped: stats.skipped,
      duration_ms: stats.duration_ms,
      bailed_early: stats.bailed_early,
      completed_at: new Date().toISOString(),
    })
    .eq("id", tickId);
  if (error) {
    logger.warn("scheduler.close_tick_failed", { tickId, error: error.message });
  }
}

// ── Dispatch helper ───────────────────────────────────────────────────────────

async function dispatchOne(
  connectionId: string,
  req: {
    loc_ref: string;
    sync_type: DueSync["sync_type"];
    mode: "delta" | "backfill";
    business_date: string;
    trace_id: string;
  },
  siteId: string,
  dryRun: boolean,
): Promise<{ ok: boolean; errors: Array<{ code: string; message: string; retryable: boolean }> }> {
  try {
    const result = await dispatchSync(
      {
        loc_ref: req.loc_ref,
        sync_type: req.sync_type,
        mode: req.mode,
        business_date: req.business_date,
        trace_id: req.trace_id,
      },
      siteId,
      req.trace_id,
    );
    return { ok: result.ok, errors: result.errors };
  } catch (err) {
    logger.error("scheduler.dispatch_crash", { connectionId, req, err: String(err) });
    return {
      ok: false,
      errors: [{ code: "DISPATCH_CRASH", message: String(err), retryable: true }],
    };
  }
}
