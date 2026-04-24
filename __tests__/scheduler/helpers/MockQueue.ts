/**
 * __tests__/scheduler/helpers/MockQueue.ts
 *
 * In-memory faithful simulation of the migration-063 scheduler SQL RPCs.
 *
 * Design goals:
 *   1. Exact 063 SQL semantics — not 062, not a simplified approximation.
 *      Every status guard, backoff formula, IF NOT FOUND check, and COALESCE
 *      matches the production SQL exactly.
 *   2. Controllable clock via setNow() / advanceMs() / advanceSecs().
 *      Allows deterministic lease-expiry testing without sleep().
 *   3. Synchronous internal mutations — no await in any critical path.
 *      Mirrors PostgreSQL's within-transaction atomicity.
 *      → Two concurrent JS Promise invocations will serialize correctly.
 *   4. Direct row access (syncRow / asyncRow / allSyncRows) for assertions.
 *   5. Schedule table support for enqueueDueSyncJobs integration tests.
 *
 * ── 063 design decisions implemented here ────────────────────────────────────
 *   DD1: attempts increments ONLY in mark_*_failed — never at claim time.
 *   DD2: release_stale_*_leases covers BOTH 'leased' AND 'running'.
 *   DD3: mark_*_running only accepts status='leased' (guard).
 *   DD4: mark_*_success / mark_*_failed guard on status IN ('leased','running').
 *   DD5: mark_*_failed returns early (IF NOT FOUND) when guard fails.
 *
 * ── Backoff formulas (must match SQL exactly) ─────────────────────────────────
 *   sync : LEAST(delay * 2^v_attempts, 14400)   v_attempts = pre-increment value
 *   async: LEAST(delay * 2^v_attempts,  7200)
 */

import { randomUUID } from "crypto";

// ── Internal row types ────────────────────────────────────────────────────────

export interface SyncJobRow {
  id: string;
  site_id: string;
  connection_id: string | null;
  loc_ref: string;
  sync_type: string;
  mode: string;
  business_date: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  leased_until: Date | null;
  lease_owner: string | null;
  trace_id: string;
  idempotency_key: string;
  last_error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface AsyncJobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  leased_until: Date | null;
  lease_owner: string | null;
  idempotency_key: string;
  last_error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface ScheduleRow {
  id: string;
  site_id: string;
  connection_id: string | null;
  loc_ref: string;
  sync_type: string;
  cadence_minutes: number;
  enabled: boolean;
  next_run_at: Date;
  last_run_at: Date | null;
  last_success_at: Date | null;
  created_at: Date;
}

// ── RPC result helpers ───────────────────────────────────────────────────────

type RpcResult<T> = { data: T; error: null } | { data: null; error: { message: string } };

function ok<T>(data: T): { data: T; error: null } {
  return { data, error: null };
}

function rpcErr(message: string): { data: null; error: { message: string } } {
  return { data: null, error: { message } };
}

// ── MockQueue ─────────────────────────────────────────────────────────────────

export class MockQueue {
  readonly syncJobs = new Map<string, SyncJobRow>();
  readonly asyncJobs = new Map<string, AsyncJobRow>();
  readonly schedules = new Map<string, ScheduleRow>();

  private clockMs: number = new Date("2026-04-23T10:00:00.000Z").getTime();

  // ── Clock control ─────────────────────────────────────────────────────────

  now(): Date {
    return new Date(this.clockMs);
  }

  setNow(date: Date | string): void {
    this.clockMs = new Date(date).getTime();
  }

  advanceMs(ms: number): void {
    this.clockMs += ms;
  }

  advanceSecs(secs: number): void {
    this.clockMs += secs * 1_000;
  }

  advanceMins(mins: number): void {
    this.clockMs += mins * 60 * 1_000;
  }

  // ── Row inspection ────────────────────────────────────────────────────────

  syncRow(id: string): SyncJobRow | undefined {
    return this.syncJobs.get(id);
  }

  asyncRow(id: string): AsyncJobRow | undefined {
    return this.asyncJobs.get(id);
  }

  allSyncRows(): SyncJobRow[] {
    return Array.from(this.syncJobs.values());
  }

  allAsyncRows(): AsyncJobRow[] {
    return Array.from(this.asyncJobs.values());
  }

  syncByStatus(status: string): SyncJobRow[] {
    return this.allSyncRows().filter((r) => r.status === status);
  }

  asyncByStatus(status: string): AsyncJobRow[] {
    return this.allAsyncRows().filter((r) => r.status === status);
  }

  reset(): void {
    this.syncJobs.clear();
    this.asyncJobs.clear();
    this.schedules.clear();
  }

  // ── Direct row insertion (test setup shortcuts) ───────────────────────────

  insertSync(
    overrides: Partial<SyncJobRow> & { site_id: string; loc_ref: string; sync_type: string },
  ): SyncJobRow {
    const id = randomUUID();
    const now = this.now();
    const row: SyncJobRow = {
      id,
      site_id: overrides.site_id,
      connection_id: overrides.connection_id ?? null,
      loc_ref: overrides.loc_ref,
      sync_type: overrides.sync_type,
      mode: overrides.mode ?? "delta",
      business_date: overrides.business_date ?? now.toISOString().slice(0, 10),
      status: overrides.status ?? "queued",
      priority: overrides.priority ?? 100,
      attempts: overrides.attempts ?? 0,
      max_attempts: overrides.max_attempts ?? 5,
      available_at: overrides.available_at ?? now,
      leased_until: overrides.leased_until ?? null,
      lease_owner: overrides.lease_owner ?? null,
      trace_id: overrides.trace_id ?? randomUUID(),
      idempotency_key: overrides.idempotency_key ?? randomUUID(),
      last_error: overrides.last_error ?? null,
      created_at: overrides.created_at ?? now,
      started_at: overrides.started_at ?? null,
      completed_at: overrides.completed_at ?? null,
    };
    this.syncJobs.set(id, row);
    return row;
  }

  insertAsync(overrides: Partial<AsyncJobRow> & { job_type: string }): AsyncJobRow {
    const id = randomUUID();
    const now = this.now();
    const row: AsyncJobRow = {
      id,
      job_type: overrides.job_type,
      payload: overrides.payload ?? {},
      status: overrides.status ?? "queued",
      priority: overrides.priority ?? 100,
      attempts: overrides.attempts ?? 0,
      max_attempts: overrides.max_attempts ?? 3,
      available_at: overrides.available_at ?? now,
      leased_until: overrides.leased_until ?? null,
      lease_owner: overrides.lease_owner ?? null,
      idempotency_key: overrides.idempotency_key ?? randomUUID(),
      last_error: overrides.last_error ?? null,
      created_at: overrides.created_at ?? now,
      started_at: overrides.started_at ?? null,
      completed_at: overrides.completed_at ?? null,
    };
    this.asyncJobs.set(id, row);
    return row;
  }

  insertSchedule(overrides: Partial<ScheduleRow> & { site_id: string; loc_ref: string; sync_type: string }): ScheduleRow {
    const id = randomUUID();
    const now = this.now();
    const row: ScheduleRow = {
      id,
      site_id: overrides.site_id,
      connection_id: overrides.connection_id ?? null,
      loc_ref: overrides.loc_ref,
      sync_type: overrides.sync_type,
      cadence_minutes: overrides.cadence_minutes ?? 60,
      enabled: overrides.enabled ?? true,
      next_run_at: overrides.next_run_at ?? new Date(now.getTime() - 1), // due by default
      last_run_at: overrides.last_run_at ?? null,
      last_success_at: overrides.last_success_at ?? null,
      created_at: overrides.created_at ?? now,
    };
    this.schedules.set(id, row);
    return row;
  }

  // ── Supabase-compatible RPC dispatcher ────────────────────────────────────
  //
  // The scheduler TS layer calls: dbAny(supabase).rpc(name, params)
  // We expose the same interface here.
  // Internal mutations are synchronous → atomic within each call.

  async rpc(name: string, params: Record<string, unknown> = {}): Promise<RpcResult<unknown>> {
    // All internal methods are synchronous — no await in any critical section.
    // This guarantees atomicity identical to a single PostgreSQL statement.
    try {
      switch (name) {
        case "enqueue_sync_job":
          return ok(this._enqueueSyncJob(params));
        case "enqueue_async_job":
          return ok(this._enqueueAsyncJob(params));
        case "claim_sync_jobs":
          return ok(this._claimSyncJobs(params));
        case "claim_async_jobs":
          return ok(this._claimAsyncJobs(params));
        case "mark_sync_job_running":
          this._markSyncJobRunning(params);
          return ok(null);
        case "mark_async_job_running":
          this._markAsyncJobRunning(params);
          return ok(null);
        case "mark_sync_job_success":
          this._markSyncJobSuccess(params);
          return ok(null);
        case "mark_async_job_success":
          this._markAsyncJobSuccess(params);
          return ok(null);
        case "mark_sync_job_failed":
          this._markSyncJobFailed(params);
          return ok(null);
        case "mark_async_job_failed":
          this._markAsyncJobFailed(params);
          return ok(null);
        case "release_stale_sync_leases":
          return ok(this._releaseStaleSyncLeases());
        case "release_stale_async_leases":
          return ok(this._releaseStaleAsyncLeases());
        case "get_due_sync_schedules":
          return ok(this._getDueSyncSchedules(params));
        case "bump_schedule_next_run":
          this._bumpScheduleNextRun(params);
          return ok(null);
        default:
          return rpcErr(`MockQueue: unknown RPC "${name}"`);
      }
    } catch (e) {
      return rpcErr(e instanceof Error ? e.message : String(e));
    }
  }

  // ── RPC implementations — exact 063 semantics ─────────────────────────────

  private _enqueueSyncJob(p: Record<string, unknown>): string {
    const site_id = String(p.p_site_id);
    const loc_ref = String(p.p_loc_ref);
    const sync_type = String(p.p_sync_type);
    const mode = String(p.p_mode ?? "delta");
    const business_date = String(
      p.p_business_date ?? this.now().toISOString().slice(0, 10),
    );
    const priority = Number(p.p_priority ?? 100);
    const connection_id = p.p_connection_id != null ? String(p.p_connection_id) : null;
    const trace_id = p.p_trace_id != null ? String(p.p_trace_id) : randomUUID();

    // Deterministic idempotency key (mirrors 062 SQL formula)
    const key =
      p.p_idempotency_key != null
        ? String(p.p_idempotency_key)
        : `${site_id}|${loc_ref}|${sync_type}|${business_date}|${mode}`;

    // ON CONFLICT (idempotency_key) DO NOTHING → return existing id
    for (const row of this.syncJobs.values()) {
      if (row.idempotency_key === key) return row.id;
    }

    const id = randomUUID();
    const now = this.now();
    this.syncJobs.set(id, {
      id,
      site_id,
      connection_id,
      loc_ref,
      sync_type,
      mode,
      business_date,
      status: "queued",
      priority,
      attempts: 0,
      max_attempts: 5,
      available_at: now,
      leased_until: null,
      lease_owner: null,
      trace_id,
      idempotency_key: key,
      last_error: null,
      created_at: now,
      started_at: null,
      completed_at: null,
    });
    return id;
  }

  private _enqueueAsyncJob(p: Record<string, unknown>): string {
    const job_type = String(p.p_job_type);
    const payload = (p.p_payload ?? {}) as Record<string, unknown>;
    const priority = Number(p.p_priority ?? 100);
    const max_attempts = Number(p.p_max_attempts ?? 3);
    const available_at =
      p.p_available_at ? new Date(String(p.p_available_at)) : this.now();

    // If no idempotency key provided, use non-idempotent default (matches 062 SQL)
    const key =
      p.p_idempotency_key != null
        ? String(p.p_idempotency_key)
        : `${job_type}|${this.clockMs}`;

    // ON CONFLICT DO NOTHING
    for (const row of this.asyncJobs.values()) {
      if (row.idempotency_key === key) return row.id;
    }

    const id = randomUUID();
    const now = this.now();
    this.asyncJobs.set(id, {
      id,
      job_type,
      payload,
      status: "queued",
      priority,
      attempts: 0,
      max_attempts,
      available_at,
      leased_until: null,
      lease_owner: null,
      idempotency_key: key,
      last_error: null,
      created_at: now,
      started_at: null,
      completed_at: null,
    });
    return id;
  }

  // ── claim_sync_jobs (063) ─────────────────────────────────────────────────
  //
  // Selection criteria (single WHERE, not UNION ALL):
  //   • queued AND available_at <= now
  //   • (leased OR running) AND leased_until < now   ← stale recovery
  // AND attempts < max_attempts
  // SKIP LOCKED semantics: rows already processed by this call are NOT visible
  //   to a concurrent call → implemented here by the fact that the Map is
  //   mutated synchronously before the Promise resolves.
  //
  // CRITICAL: attempts NOT incremented. started_at NOT set.

  private _claimSyncJobs(p: Record<string, unknown>): object[] {
    const worker_id = String(p.p_worker_id);
    const limit = Number(p.p_limit ?? 5);
    const lease_secs = Number(p.p_lease_seconds ?? 120);
    const now = this.now();
    const leased_until = new Date(now.getTime() + lease_secs * 1_000);

    const eligible = Array.from(this.syncJobs.values())
      .filter((row) => {
        const fresh = row.status === "queued" && row.available_at <= now;
        const stale =
          (row.status === "leased" || row.status === "running") &&
          row.leased_until !== null &&
          row.leased_until < now;
        return (fresh || stale) && row.attempts < row.max_attempts;
      })
      .sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : a.available_at.getTime() - b.available_at.getTime(),
      )
      .slice(0, limit);

    return eligible.map((row) => {
      // Mutate in-place (atomic — no await)
      row.status = "leased";
      row.lease_owner = worker_id;
      row.leased_until = leased_until;
      // attempts: NOT touched (DD1)
      // started_at: NOT touched (set by mark_*_running)
      return {
        id: row.id,
        site_id: row.site_id,
        connection_id: row.connection_id,
        loc_ref: row.loc_ref,
        sync_type: row.sync_type,
        mode: row.mode,
        business_date: row.business_date,
        priority: row.priority,
        trace_id: row.trace_id,
        attempts: row.attempts,
      };
    });
  }

  // ── claim_async_jobs (063) ────────────────────────────────────────────────

  private _claimAsyncJobs(p: Record<string, unknown>): object[] {
    const worker_id = String(p.p_worker_id);
    const limit = Number(p.p_limit ?? 5);
    const lease_secs = Number(p.p_lease_seconds ?? 300);
    const now = this.now();
    const leased_until = new Date(now.getTime() + lease_secs * 1_000);

    const eligible = Array.from(this.asyncJobs.values())
      .filter((row) => {
        const fresh = row.status === "queued" && row.available_at <= now;
        const stale =
          (row.status === "leased" || row.status === "running") &&
          row.leased_until !== null &&
          row.leased_until < now;
        return (fresh || stale) && row.attempts < row.max_attempts;
      })
      .sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : a.available_at.getTime() - b.available_at.getTime(),
      )
      .slice(0, limit);

    return eligible.map((row) => {
      row.status = "leased";
      row.lease_owner = worker_id;
      row.leased_until = leased_until;
      // attempts: NOT touched (DD1)
      return {
        id: row.id,
        job_type: row.job_type,
        payload: row.payload,
        idempotency_key: row.idempotency_key,
        attempts: row.attempts,
      };
    });
  }

  // ── mark_sync_job_running (063) ───────────────────────────────────────────
  //
  // Guard: WHERE id=X AND status='leased'
  // Sets started_at = COALESCE(started_at, now())
  // Sets lease_owner = COALESCE(p_worker_id, lease_owner)

  private _markSyncJobRunning(p: Record<string, unknown>): void {
    const job_id = String(p.p_job_id);
    const worker_id = p.p_worker_id != null ? String(p.p_worker_id) : null;
    const row = this.syncJobs.get(job_id);
    if (!row || row.status !== "leased") return; // DD3: guard
    row.status = "running";
    row.started_at = row.started_at ?? this.now();
    row.lease_owner = worker_id ?? row.lease_owner;
  }

  // ── mark_async_job_running (063) ──────────────────────────────────────────

  private _markAsyncJobRunning(p: Record<string, unknown>): void {
    const job_id = String(p.p_job_id);
    const worker_id = p.p_worker_id != null ? String(p.p_worker_id) : null;
    const row = this.asyncJobs.get(job_id);
    if (!row || row.status !== "leased") return;
    row.status = "running";
    row.started_at = row.started_at ?? this.now();
    row.lease_owner = worker_id ?? row.lease_owner;
  }

  // ── mark_sync_job_success (063) ───────────────────────────────────────────
  //
  // Guard: WHERE id=X AND status IN ('leased','running')
  // A stale ack from a recovered worker won't corrupt a new job.

  private _markSyncJobSuccess(p: Record<string, unknown>): void {
    const job_id = String(p.p_job_id);
    const completed_at =
      p.p_completed_at != null ? new Date(String(p.p_completed_at)) : this.now();
    const row = this.syncJobs.get(job_id);
    if (!row || !["leased", "running"].includes(row.status)) return; // DD4: guard
    row.status = "succeeded";
    row.completed_at = completed_at;
    row.lease_owner = null;
    row.leased_until = null;
  }

  // ── mark_async_job_success (063) ──────────────────────────────────────────

  private _markAsyncJobSuccess(p: Record<string, unknown>): void {
    const job_id = String(p.p_job_id);
    const row = this.asyncJobs.get(job_id);
    if (!row || !["leased", "running"].includes(row.status)) return;
    row.status = "succeeded";
    row.completed_at = this.now();
    row.lease_owner = null;
    row.leased_until = null;
  }

  // ── mark_sync_job_failed (063) ────────────────────────────────────────────
  //
  // Guard: SELECT WHERE id=X AND status IN ('leased','running') → IF NOT FOUND RETURN
  // Increments attempts (DD1: only here, not at claim time).
  // Backoff: LEAST(delay * 2^v_attempts, 14400)  where v_attempts is pre-increment.

  private _markSyncJobFailed(p: Record<string, unknown>): void {
    const job_id = String(p.p_job_id);
    const error_msg = p.p_error_msg != null ? String(p.p_error_msg) : null;
    const retry_delay = Number(p.p_retry_delay_secs ?? 60);

    const row = this.syncJobs.get(job_id);
    // DD5: IF NOT FOUND (or wrong status) → RETURN
    if (!row || !["leased", "running"].includes(row.status)) return;

    const v_attempts = row.attempts; // pre-increment value (used for backoff exponent)
    const v_new_attempts = v_attempts + 1;
    // LEAST(delay * 2^v_attempts, 14400)
    const backoff_s = Math.min(
      Math.floor(retry_delay * Math.pow(2, v_attempts)),
      14400,
    );

    row.attempts = v_new_attempts;
    row.last_error = error_msg;
    row.lease_owner = null;
    row.leased_until = null;

    if (v_new_attempts >= row.max_attempts) {
      row.status = "dead_letter";
      row.completed_at = this.now();
      // available_at unchanged for dead_letter
    } else {
      row.status = "queued";
      row.available_at = new Date(this.now().getTime() + backoff_s * 1_000);
      row.completed_at = null;
    }
  }

  // ── mark_async_job_failed (063) ───────────────────────────────────────────
  //
  // Async cap is 7200 (2 hours), not 14400.

  private _markAsyncJobFailed(p: Record<string, unknown>): void {
    const job_id = String(p.p_job_id);
    const error_msg = p.p_error_msg != null ? String(p.p_error_msg) : null;
    const retry_delay = Number(p.p_retry_delay_secs ?? 120);

    const row = this.asyncJobs.get(job_id);
    if (!row || !["leased", "running"].includes(row.status)) return;

    const v_attempts = row.attempts;
    const v_new_attempts = v_attempts + 1;
    const backoff_s = Math.min(
      Math.floor(retry_delay * Math.pow(2, v_attempts)),
      7200,
    );

    row.attempts = v_new_attempts;
    row.last_error = error_msg;
    row.lease_owner = null;
    row.leased_until = null;

    if (v_new_attempts >= row.max_attempts) {
      row.status = "dead_letter";
      row.completed_at = this.now();
    } else {
      row.status = "queued";
      row.available_at = new Date(this.now().getTime() + backoff_s * 1_000);
      row.completed_at = null;
    }
  }

  // ── release_stale_sync_leases (063) ───────────────────────────────────────
  //
  // Covers BOTH 'leased' AND 'running' — the key fix from 063.
  // Does NOT increment attempts (DD1).
  // Skips jobs with attempts >= max_attempts (they'd become dead_letter on next fail anyway).

  private _releaseStaleSyncLeases(): number {
    const now = this.now();
    let count = 0;
    for (const row of this.syncJobs.values()) {
      if (
        (row.status === "leased" || row.status === "running") &&
        row.leased_until !== null &&
        row.leased_until < now &&
        row.attempts < row.max_attempts
      ) {
        row.status = "queued";
        row.lease_owner = null;
        row.leased_until = null;
        // started_at: intentionally NOT reset — preserve execution history
        // attempts: intentionally NOT modified (DD1)
        count++;
      }
    }
    return count;
  }

  // ── release_stale_async_leases (063) ─────────────────────────────────────
  //
  // New in 063 — the async queue had no stale-release function before.

  private _releaseStaleAsyncLeases(): number {
    const now = this.now();
    let count = 0;
    for (const row of this.asyncJobs.values()) {
      if (
        (row.status === "leased" || row.status === "running") &&
        row.leased_until !== null &&
        row.leased_until < now &&
        row.attempts < row.max_attempts
      ) {
        row.status = "queued";
        row.lease_owner = null;
        row.leased_until = null;
        count++;
      }
    }
    return count;
  }

  // ── get_due_sync_schedules ─────────────────────────────────────────────────

  private _getDueSyncSchedules(p: Record<string, unknown>): object[] {
    const now_ts = p.now_ts ? new Date(String(p.now_ts)) : this.now();
    const max_rows = Number(p.max_rows ?? 50);

    return Array.from(this.schedules.values())
      .filter((s) => s.enabled && s.next_run_at <= now_ts)
      .sort((a, b) => a.next_run_at.getTime() - b.next_run_at.getTime())
      .slice(0, max_rows)
      .map((s) => ({
        id: s.id,
        site_id: s.site_id,
        connection_id: s.connection_id,
        loc_ref: s.loc_ref,
        sync_type: s.sync_type,
        cadence_minutes: s.cadence_minutes,
      }));
  }

  // ── bump_schedule_next_run ────────────────────────────────────────────────

  private _bumpScheduleNextRun(p: Record<string, unknown>): void {
    const schedule_id = String(p.p_schedule_id);
    const success = Boolean(p.p_success ?? true);
    const row = this.schedules.get(schedule_id);
    if (!row) return;
    const now = this.now();
    row.last_run_at = now;
    if (success) row.last_success_at = now;
    row.next_run_at = new Date(now.getTime() + row.cadence_minutes * 60 * 1_000);
  }
}

// ── MockSupabase factory ──────────────────────────────────────────────────────
//
// Wraps MockQueue in an object that satisfies the `ReturnType<typeof createServerClient>`
// shape expected by lib/scheduler/claim.ts and friends.
// The scheduler code casts to `any` via dbAny(), so we only need `.rpc()`.

export function createMockSupabase(queue: MockQueue) {
  return {
    rpc: (name: string, params?: Record<string, unknown>) =>
      queue.rpc(name, params ?? {}),
  } as unknown as ReturnType<typeof import("@/lib/supabase/server").createServerClient>;
}
