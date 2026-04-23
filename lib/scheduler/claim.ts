/**
 * lib/scheduler/claim.ts
 *
 * Claim sync and async jobs from the DB queues.
 *
 * Each claim call:
 * 1. Optionally releases stale leases first (abandoned by crashed workers)
 * 2. Calls the DB claim function (SKIP LOCKED — safe for concurrent workers)
 * 3. Returns typed job arrays
 *
 * No business logic here — only queue mechanics.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { ClaimedSyncJob, ClaimedAsyncJob } from "./types";

// Leases auto-expire after this many seconds if the worker dies mid-job.
const SYNC_LEASE_SECONDS = 120;
const ASYNC_LEASE_SECONDS = 300;

// ── Type-safe DB proxy ────────────────────────────────────────────────────────
// Tables and RPCs added in migration 062 are not yet in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbAny(supabase: ReturnType<typeof createServerClient>): any {
  return supabase;
}

// ── Stale lease recovery ──────────────────────────────────────────────────────

/**
 * Release jobs whose lease expired but were never completed.
 * Covers both queues.  Safe to call at the start of every tick.
 */
export async function releaseStaleLeases(
  supabase: ReturnType<typeof createServerClient>,
): Promise<number> {
  let total = 0;
  try {
    const { data: syncData, error: syncErr } = await dbAny(supabase).rpc("release_stale_sync_leases");
    if (syncErr) {
      logger.warn("scheduler.claim.stale_sync_release_failed", { error: syncErr.message });
    } else {
      total += (syncData as number | null) ?? 0;
    }

    const { data: asyncData, error: asyncErr } = await dbAny(supabase).rpc("release_stale_async_leases");
    if (asyncErr) {
      logger.warn("scheduler.claim.stale_async_release_failed", { error: asyncErr.message });
    } else {
      total += (asyncData as number | null) ?? 0;
    }

    if (total > 0) {
      logger.info("scheduler.claim.stale_leases_released", { released: total });
    }
    return total;
  } catch (err) {
    logger.warn("scheduler.claim.stale_release_exception", { err: String(err) });
    return 0;
  }
}

// ── Sync job claiming ─────────────────────────────────────────────────────────

/**
 * Atomically claim up to `limit` sync jobs.
 * Jobs are returned with an active lease owned by `workerId`.
 * If the worker does not mark them success/failed within SYNC_LEASE_SECONDS,
 * release_stale_sync_leases() will reclaim them.
 */
export async function claimSyncJobs(
  supabase: ReturnType<typeof createServerClient>,
  workerId: string,
  limit: number,
): Promise<ClaimedSyncJob[]> {
  try {
    const { data, error } = await dbAny(supabase).rpc("claim_sync_jobs", {
      p_worker_id:     workerId,
      p_limit:         limit,
      p_lease_seconds: SYNC_LEASE_SECONDS,
    });
    if (error) {
      logger.warn("scheduler.claim.sync_jobs_failed", { error: error.message });
      return [];
    }
    const rows = (data ?? []) as unknown[];
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id:            String(row.id),
        site_id:       String(row.site_id),
        connection_id: row.connection_id != null ? String(row.connection_id) : null,
        loc_ref:       String(row.loc_ref),
        sync_type:     String(row.sync_type),
        mode:          String(row.mode),
        business_date: String(row.business_date),
        priority:      Number(row.priority ?? 100),
        trace_id:      String(row.trace_id),
        attempts:      Number(row.attempts ?? 1),
      } satisfies ClaimedSyncJob;
    });
  } catch (err) {
    logger.warn("scheduler.claim.sync_jobs_exception", { err: String(err) });
    return [];
  }
}

// ── Async job claiming ────────────────────────────────────────────────────────

/**
 * Atomically claim up to `limit` async jobs (reports, scores, reviews).
 */
export async function claimAsyncJobs(
  supabase: ReturnType<typeof createServerClient>,
  workerId: string,
  limit: number,
): Promise<ClaimedAsyncJob[]> {
  try {
    const { data, error } = await dbAny(supabase).rpc("claim_async_jobs", {
      p_worker_id:     workerId,
      p_limit:         limit,
      p_lease_seconds: ASYNC_LEASE_SECONDS,
    });
    if (error) {
      logger.warn("scheduler.claim.async_jobs_failed", { error: error.message });
      return [];
    }
    const rows = (data ?? []) as unknown[];
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id:              String(row.id),
        job_type:        String(row.job_type) as ClaimedAsyncJob["job_type"],
        payload:         (row.payload ?? {}) as Record<string, unknown>,
        idempotency_key: String(row.idempotency_key),
        attempts:        Number(row.attempts ?? 1),
      } satisfies ClaimedAsyncJob;
    });
  } catch (err) {
    logger.warn("scheduler.claim.async_jobs_exception", { err: String(err) });
    return [];
  }
}

// ── Running transition ────────────────────────────────────────────────────────

/**
 * Transition a leased sync job to 'running'. Call immediately before dispatch
 * so monitoring queries can distinguish "lease held" from "execution in progress".
 */
export async function markSyncJobRunning(
  supabase: ReturnType<typeof createServerClient>,
  jobId: string,
  workerId: string,
): Promise<void> {
  const { error } = await dbAny(supabase).rpc("mark_sync_job_running", {
    p_job_id:    jobId,
    p_worker_id: workerId,
  });
  if (error) {
    logger.warn("scheduler.claim.mark_sync_running_failed", { jobId, error: error.message });
  }
}

/**
 * Transition a leased async job to 'running'. Call immediately before handler execution.
 */
export async function markAsyncJobRunning(
  supabase: ReturnType<typeof createServerClient>,
  jobId: string,
  workerId: string,
): Promise<void> {
  const { error } = await dbAny(supabase).rpc("mark_async_job_running", {
    p_job_id:    jobId,
    p_worker_id: workerId,
  });
  if (error) {
    logger.warn("scheduler.claim.mark_async_running_failed", { jobId, error: error.message });
  }
}

// ── Job outcome marking ───────────────────────────────────────────────────────

export async function markSyncJobSuccess(
  supabase: ReturnType<typeof createServerClient>,
  jobId: string,
): Promise<void> {
  const { error } = await dbAny(supabase).rpc("mark_sync_job_success", {
    p_job_id: jobId,
  });
  if (error) {
    logger.warn("scheduler.claim.mark_sync_success_failed", { jobId, error: error.message });
  }
}

export async function markSyncJobFailed(
  supabase: ReturnType<typeof createServerClient>,
  jobId: string,
  errorMsg: string,
  retryDelaySecs = 60,
): Promise<void> {
  const { error } = await dbAny(supabase).rpc("mark_sync_job_failed", {
    p_job_id:           jobId,
    p_error_msg:        errorMsg.slice(0, 500),
    p_retry_delay_secs: retryDelaySecs,
  });
  if (error) {
    logger.warn("scheduler.claim.mark_sync_failed_rpc_failed", { jobId, error: error.message });
  }
}

export async function markAsyncJobSuccess(
  supabase: ReturnType<typeof createServerClient>,
  jobId: string,
): Promise<void> {
  const { error } = await dbAny(supabase).rpc("mark_async_job_success", {
    p_job_id: jobId,
  });
  if (error) {
    logger.warn("scheduler.claim.mark_async_success_failed", { jobId, error: error.message });
  }
}

export async function markAsyncJobFailed(
  supabase: ReturnType<typeof createServerClient>,
  jobId: string,
  errorMsg: string,
  retryDelaySecs = 120,
): Promise<void> {
  const { error } = await dbAny(supabase).rpc("mark_async_job_failed", {
    p_job_id:           jobId,
    p_error_msg:        errorMsg.slice(0, 500),
    p_retry_delay_secs: retryDelaySecs,
  });
  if (error) {
    logger.warn("scheduler.claim.mark_async_failed_rpc_failed", { jobId, error: error.message });
  }
}
