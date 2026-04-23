/**
 * lib/scheduler/worker.ts
 *
 * The sync job worker.
 *
 * Converts a ClaimedSyncJob into a SyncRequest, calls dispatchSync(), and
 * writes the outcome back to sync_job_queue.
 *
 * Responsibilities:
 * - Type-validate the job fields before dispatching
 * - Never catch errors silently — always mark job failed with error detail
 * - Enqueue dependent async jobs after success where appropriate
 * - Respect the deadline so we don't overrun the Vercel function timeout
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { dispatchSync } from "@/lib/sync/orchestrator";
import { SyncTypeEnum, SyncModeEnum } from "@/lib/sync/contract";
import { markSyncJobSuccess, markSyncJobFailed } from "./claim";
import type { ClaimedSyncJob, SchedulerWorkerContext } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbAny(supabase: ReturnType<typeof createServerClient>): any {
  return supabase;
}

// ── Single-job executor ───────────────────────────────────────────────────────

/**
 * Execute a single claimed sync job.
 * Returns true if the job succeeded.
 */
export async function executeSyncJob(
  supabase: ReturnType<typeof createServerClient>,
  job: ClaimedSyncJob,
  ctx: SchedulerWorkerContext,
): Promise<boolean> {
  const logBase = {
    job_id:    job.id,
    site_id:   job.site_id,
    loc_ref:   job.loc_ref,
    sync_type: job.sync_type,
    mode:      job.mode,
    trace_id:  job.trace_id,
    attempt:   job.attempts,
  };

  // ── Validate sync_type and mode ───────────────────────────────────────────
  const parsedType = SyncTypeEnum.safeParse(job.sync_type);
  const parsedMode = SyncModeEnum.safeParse(job.mode);

  if (!parsedType.success || !parsedMode.success) {
    const err = `Invalid job fields: sync_type=${job.sync_type}, mode=${job.mode}`;
    logger.error("worker.invalid_job", { ...logBase, err });
    await markSyncJobFailed(supabase, job.id, err, /* non-retryable */ 99999);
    return false;
  }

  if (ctx.dry_run) {
    logger.info("worker.dry_run_skip", { ...logBase });
    await markSyncJobSuccess(supabase, job.id);
    return true;
  }

  logger.info("worker.sync_start", { ...logBase });

  try {
    const result = await dispatchSync(
      {
        loc_ref:       job.loc_ref,
        sync_type:     parsedType.data,
        mode:          parsedMode.data,
        business_date: job.business_date,
        trace_id:      job.trace_id,
      },
      job.site_id,
      job.trace_id,
    );

    if (result.ok) {
      await markSyncJobSuccess(supabase, job.id);
      logger.info("worker.sync_success", {
        ...logBase,
        outcome:         result.outcome,
        records_written: result.records_written,
        duration_ms:     result.duration_ms,
      });

      // ── Enqueue dependent downstream jobs on success ────────────────────
      await enqueueDependentJobs(supabase, job, ctx);

      return true;
    } else {
      const errMsg = result.errors.map((e) => e.message).join("; ");
      const retryable = result.errors.some((e) => e.retryable);
      const retryDelay = retryable ? 60 : 99999;

      await markSyncJobFailed(supabase, job.id, errMsg, retryDelay);
      logger.warn("worker.sync_failed", {
        ...logBase,
        outcome:  result.outcome,
        errMsg,
        retryable,
      });
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("worker.sync_exception", { ...logBase, err: msg });
    await markSyncJobFailed(supabase, job.id, msg, 60);
    return false;
  }
}

// ── Batch job loop ────────────────────────────────────────────────────────────

/**
 * Execute all claimed sync jobs, respecting the tick deadline.
 * Returns { succeeded, failed } counts.
 */
export async function runSyncJobBatch(
  supabase: ReturnType<typeof createServerClient>,
  jobs: ClaimedSyncJob[],
  ctx: SchedulerWorkerContext,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    if (Date.now() > ctx.deadline_ms) {
      logger.warn("worker.batch_bailed_early", {
        tick_id:   ctx.tick_id,
        remaining: jobs.length - succeeded - failed,
      });
      break;
    }

    const ok = await executeSyncJob(supabase, job, ctx);
    if (ok) { succeeded++; } else { failed++; }
  }

  return { succeeded, failed };
}

// ── Dependent job enqueuer ────────────────────────────────────────────────────

/**
 * After a sync succeeds, enqueue downstream async jobs if appropriate.
 *
 * Policy:
 * - After daily_sales success → enqueue compute_accountability for that site/date
 * - After intraday_sales success → no downstream (scores compute nightly)
 * - After labour success → no downstream
 */
async function enqueueDependentJobs(
  supabase: ReturnType<typeof createServerClient>,
  job: ClaimedSyncJob,
  ctx: SchedulerWorkerContext,
): Promise<void> {
  if (ctx.dry_run) return;

  try {
    const db = dbAny(supabase);

    if (job.sync_type === "daily_sales") {
      // Enqueue accountability score compute for this date + site
      const isoDate = typeof job.business_date === "string"
        ? job.business_date
        : new Date(job.business_date).toISOString().slice(0, 10);

      const idempotencyKey = `compute_accountability|${job.site_id}|${isoDate}`;

      await db.rpc("enqueue_async_job", {
        p_job_type:        "compute_accountability",
        p_payload:         { site_id: job.site_id, date: isoDate },
        p_idempotency_key: idempotencyKey,
        p_available_at:    new Date().toISOString(),
        p_priority:        200,
      });

      logger.info("worker.dependent_job_enqueued", {
        parent_job:  job.id,
        job_type:    "compute_accountability",
        site_id:     job.site_id,
        date:        isoDate,
        trace_id:    ctx.trace_id,
      });
    }
  } catch (err) {
    // Non-fatal — log but don't fail the parent job
    logger.warn("worker.dependent_enqueue_failed", {
      job_id: job.id,
      err:    String(err),
    });
  }
}
