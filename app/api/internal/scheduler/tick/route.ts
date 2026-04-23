/**
 * POST /api/internal/scheduler/tick
 *
 * The single entrypoint that drives the entire scheduler loop.
 * Called by the Vercel cron job (/api/cron/sync-orchestrator) every tick.
 *
 * Flow:
 * 1. Release stale leases
 * 2. Enqueue due sync jobs from sync_schedules
 * 3. Claim + run sync jobs
 * 4. Claim + run async jobs
 * 5. Return SchedulerTickSummary as JSON
 *
 * Auth: Bearer CRON_SECRET  (same as all other internal routes)
 * No session / user context required — runs as the system worker.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { releaseStaleLeases, claimSyncJobs, claimAsyncJobs } from "@/lib/scheduler/claim";
import { enqueueDueSyncJobs } from "@/lib/scheduler/sync-scheduler";
import { runSyncJobBatch } from "@/lib/scheduler/worker";
import { runAsyncJobBatch } from "@/lib/scheduler/async-scheduler";
import type { SchedulerTickSummary, SchedulerWorkerContext } from "@/lib/scheduler/types";

export const dynamic    = "force-dynamic";
export const runtime    = "nodejs";
export const maxDuration = 60;

const MAX_SYNC_JOBS_PER_TICK  = 10;
const MAX_ASYNC_JOBS_PER_TICK = 5;
/** Leave 8 s headroom before the maxDuration hard kill */
const DEADLINE_BUFFER_MS = 8_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader  = req.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
  const tickId    = crypto.randomUUID();
  const startedAt = Date.now();

  const ctx: SchedulerWorkerContext = {
    tick_id:     tickId,
    trace_id:    tickId,
    started_at:  new Date(startedAt).toISOString(),
    deadline_ms: startedAt + (maxDuration * 1000) - DEADLINE_BUFFER_MS,
    dry_run:     req.nextUrl.searchParams.get("dry_run") === "true",
    worker_id:   `tick:${tickId}`,
    max_sync_jobs:  MAX_SYNC_JOBS_PER_TICK,
    max_async_jobs: MAX_ASYNC_JOBS_PER_TICK,
  };

  logger.info("scheduler.tick.start", {
    tick_id: tickId,
    dry_run: ctx.dry_run,
  });

  const supabase = createServerClient();

  try {
    // ── 1. Release stale leases ───────────────────────────────────────────
    const staleReleased = await releaseStaleLeases(supabase);

    // ── 2. Enqueue sync jobs from due schedules ───────────────────────────
    const jobsEnqueued = await enqueueDueSyncJobs(supabase, {
      dryRun:  ctx.dry_run,
      traceId: ctx.trace_id,
    });

    // ── 3. Claim + execute sync jobs ──────────────────────────────────────
    const syncJobs   = await claimSyncJobs(supabase, ctx.worker_id, MAX_SYNC_JOBS_PER_TICK);
    const syncResult = await runSyncJobBatch(supabase, syncJobs, ctx);

    // ── 4. Claim + execute async jobs ─────────────────────────────────────
    const asyncJobs   = await claimAsyncJobs(supabase, ctx.worker_id, MAX_ASYNC_JOBS_PER_TICK);
    const asyncResult = await runAsyncJobBatch(supabase, asyncJobs, ctx);

    // ── 5. Build + return summary ─────────────────────────────────────────
    const summary: SchedulerTickSummary = {
      tick_id:              tickId,
      worker_id:            ctx.worker_id,
      started_at:           new Date(startedAt).toISOString(),
      completed_at:         new Date().toISOString(),
      duration_ms:          Date.now() - startedAt,
      schedules_evaluated:  jobsEnqueued, // enqueueDueSyncJobs returns count enqueued (proxy for evaluated)
      stale_leases_released: staleReleased,
      sync_jobs_enqueued:   jobsEnqueued,
      sync_jobs_claimed:    syncJobs.length,
      sync_jobs_succeeded:  syncResult.succeeded,
      sync_jobs_failed:     syncResult.failed,
      async_jobs_claimed:   asyncJobs.length,
      async_jobs_succeeded: asyncResult.succeeded,
      async_jobs_failed:    asyncResult.failed,
      bailed_early:         false,
    };

    logger.info("scheduler.tick.complete", summary as unknown as Record<string, unknown>);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("scheduler.tick.unhandled_error", { tick_id: tickId, err: msg });
    return NextResponse.json(
      { error: "Tick failed", detail: msg, tick_id: tickId },
      { status: 500 },
    );
  }
}
