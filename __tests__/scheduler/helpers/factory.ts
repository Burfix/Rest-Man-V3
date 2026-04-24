/**
 * __tests__/scheduler/helpers/factory.ts
 *
 * Stable test-fixture UUIDs and parameter builder functions.
 *
 * Using well-known UUIDs (not random) means failures are reproducible —
 * a log line mentioning 00000000-...-0a01 always means "site A in tests".
 */

import type { SyncJobRow, AsyncJobRow } from "./MockQueue";

// ── Well-known tenant IDs ─────────────────────────────────────────────────────

export const SITE_A = "00000000-0000-0000-0000-000000000a01";
export const SITE_B = "00000000-0000-0000-0000-000000000b01";
export const SITE_C = "00000000-0000-0000-0000-000000000c01";

// ── Well-known worker IDs ─────────────────────────────────────────────────────

export const WORKER_1 = "worker-torturer-1";
export const WORKER_2 = "worker-torturer-2";
export const WORKER_3 = "worker-torturer-3";

// ── Default business date ─────────────────────────────────────────────────────

export const BIZ_DATE = "2026-04-23";
export const BIZ_DATE_NEXT = "2026-04-24";

// ── Minimum insertSync overrides for common scenarios ────────────────────────

export const queuedJob = (overrides: Partial<SyncJobRow> = {}): Partial<SyncJobRow> & { site_id: string; loc_ref: string; sync_type: string } => ({
  site_id: SITE_A,
  loc_ref: "LOC001",
  sync_type: "daily_sales",
  business_date: BIZ_DATE,
  mode: "delta",
  status: "queued",
  ...overrides,
});

export const queuedAsyncJob = (overrides: Partial<AsyncJobRow> = {}): Partial<AsyncJobRow> & { job_type: string } => ({
  job_type: "compute_accountability",
  payload: { site_id: SITE_A, date: BIZ_DATE },
  status: "queued",
  ...overrides,
});

// ── enqueue_sync_job RPC params ───────────────────────────────────────────────

export function syncJobRpcParams(overrides: Partial<{
  site_id: string;
  loc_ref: string;
  sync_type: string;
  mode: string;
  business_date: string;
  priority: number;
  idempotency_key: string | null;
}> = {}): Record<string, unknown> {
  const site_id = overrides.site_id ?? SITE_A;
  const loc_ref = overrides.loc_ref ?? "LOC001";
  const sync_type = overrides.sync_type ?? "daily_sales";
  const mode = overrides.mode ?? "delta";
  const business_date = overrides.business_date ?? BIZ_DATE;

  return {
    p_site_id: site_id,
    p_connection_id: null,
    p_loc_ref: loc_ref,
    p_sync_type: sync_type,
    p_mode: mode,
    p_business_date: business_date,
    p_priority: overrides.priority ?? 100,
    p_idempotency_key: overrides.idempotency_key !== undefined
      ? overrides.idempotency_key
      : null, // null → use deterministic formula
  };
}

// ── enqueue_async_job RPC params ──────────────────────────────────────────────

export function asyncJobRpcParams(overrides: Partial<{
  job_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  priority: number;
  available_at: string;
}> = {}): Record<string, unknown> {
  return {
    p_job_type: overrides.job_type ?? "compute_accountability",
    p_payload: overrides.payload ?? { site_id: SITE_A, date: BIZ_DATE },
    p_idempotency_key: overrides.idempotency_key ?? `compute_accountability|${SITE_A}|${BIZ_DATE}`,
    p_priority: overrides.priority ?? 100,
    p_available_at: overrides.available_at ?? new Date().toISOString(),
  };
}

// ── Claim RPC params ──────────────────────────────────────────────────────────

export function claimSyncParams(workerId: string, limit = 10, leaseSeconds = 120): Record<string, unknown> {
  return { p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds };
}

export function claimAsyncParams(workerId: string, limit = 10, leaseSeconds = 300): Record<string, unknown> {
  return { p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds };
}

// ── SchedulerWorkerContext factory ────────────────────────────────────────────

export function makeWorkerCtx(overrides: Partial<{
  worker_id: string;
  tick_id: string;
  deadline_ms: number;
  dry_run: boolean;
}> = {}) {
  const tickId = overrides.tick_id ?? "tick-test-00000000";
  return {
    worker_id: overrides.worker_id ?? WORKER_1,
    tick_id: tickId,
    trace_id: tickId,
    started_at: new Date().toISOString(),
    deadline_ms: overrides.deadline_ms ?? Date.now() + 60_000,
    max_sync_jobs: 10,
    max_async_jobs: 5,
    dry_run: overrides.dry_run ?? false,
  };
}
