/**
 * lib/scheduler/types.ts
 *
 * Shared types for the DB-backed scheduler / queue / worker layer.
 * These are distinct from lib/sync/contract.ts which covers sync-specific
 * protocol types. Scheduler types cover job lifecycle, claiming, and async
 * job dispatch.
 */

// ── Job statuses ──────────────────────────────────────────────────────────────

export type SyncJobStatus =
  | "queued"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";

export type AsyncJobStatus =
  | "queued"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled";

// ── Known async job types ─────────────────────────────────────────────────────

export type AsyncJobType =
  | "compute_accountability"
  | "send_daily_report"
  | "send_weekly_report"
  | "google_reviews_sync";

// ── Rows returned from DB claim functions ────────────────────────────────────

export interface ClaimedSyncJob {
  id: string;
  site_id: string;
  connection_id: string | null;
  loc_ref: string;
  sync_type: string;
  mode: string;
  business_date: string; // ISO date string from date column
  priority: number;
  trace_id: string;
  attempts: number;
}

export interface ClaimedAsyncJob {
  id: string;
  job_type: AsyncJobType;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  trace_id?: string;
}

// ── Schedule row ──────────────────────────────────────────────────────────────

export interface DueSyncSchedule {
  id: string;
  site_id: string;
  connection_id: string | null;
  loc_ref: string;
  sync_type: string;
  cadence_minutes: number;
}

// ── Worker tick summary ───────────────────────────────────────────────────────

export interface SchedulerTickSummary {
  tick_id: string;
  worker_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  /** How many sync_schedules rows were evaluated as due this tick */
  schedules_due: number;
  /** How many sync_job_queue rows were actually inserted (may be less than schedules_due due to idempotency) */
  sync_jobs_enqueued: number;
  sync_jobs_claimed: number;
  sync_jobs_succeeded: number;
  sync_jobs_failed: number;
  async_jobs_claimed: number;
  async_jobs_succeeded: number;
  async_jobs_failed: number;
  stale_leases_released: number;
  bailed_early: boolean;
}

// ── Worker context ────────────────────────────────────────────────────────────

export interface SchedulerWorkerContext {
  worker_id: string;
  tick_id: string;
  trace_id: string;
  deadline_ms: number;        // epoch millis; worker must stop by this time
  max_sync_jobs: number;
  max_async_jobs: number;
  dry_run: boolean;
  started_at: string;         // ISO timestamp, for logging
}
