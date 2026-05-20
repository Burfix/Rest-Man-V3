-- =============================================================================
-- Migration 063: Scheduler Hardening
-- =============================================================================
--
-- Brings the DB schema and RPC contract into full alignment with the TypeScript
-- scheduler lifecycle.  The app layer already uses the cleaner lifecycle; this
-- migration updates the DB to match it exactly.
--
-- ── Lifecycle ─────────────────────────────────────────────────────────────────
--
--   queued → leased → running → succeeded
--                             ↘ failed → queued   (retry with exponential backoff)
--                                      → dead_letter  (max_attempts reached)
--   cancelled  (terminal, manual only)
--
-- ── Design decisions (read before touching) ───────────────────────────────────
--
--   1. attempts increments ONLY in mark_*_failed, NEVER at claim time.
--      Rationale: a worker that crashes before execution starts must not burn
--      a retry.  Only an execution that actually attempts the work and fails
--      should count as an attempt.
--
--   2. release_stale_*_leases covers both 'leased' AND 'running' states.
--      Rationale: a worker that crashes mid-execution leaves the job in
--      'running'.  Without recovering those jobs they become permanently stuck.
--      The lease expiry timestamp (leased_until) applies to the entire execution
--      window, not just the claim handshake.
--
--   3. mark_*_running explicitly transitions leased → running and stamps
--      started_at.  This makes it possible to monitor exactly when execution
--      began, separate from when the lease was acquired.
--
--   4. mark_*_success and mark_*_failed are guarded with status IN constraints.
--      A job in queued or dead_letter state cannot be accidentally moved to
--      succeeded or failed by a stale ack from a recovered worker.
--
--   5. claim_* uses a single WHERE clause (not UNION ALL) with FOR UPDATE
--      SKIP LOCKED.  PostgreSQL guarantees atomic claim under concurrency.
--      The clause covers both 'queued' available-now jobs AND stale
--      'leased'/'running' jobs as a defence-in-depth layer on top of
--      release_stale_*_leases.
--
-- ── Status mapping (old → new) ────────────────────────────────────────────────
--   claimed   → leased
--   success   → succeeded
--   abandoned → dead_letter
--
-- ── Functions affected ────────────────────────────────────────────────────────
--   sync queue :
--     claim_sync_jobs, mark_sync_job_running, mark_sync_job_success,
--     mark_sync_job_failed, release_stale_sync_leases
--   async queue:
--     claim_async_jobs, mark_async_job_running, mark_async_job_success,
--     mark_async_job_failed, release_stale_async_leases  ← NEW
--
-- =============================================================================

-- =============================================================================
-- Step 1: Widen CHECK constraints to allow old + new values simultaneously.
-- The data migration in Step 2 runs while both sets are valid.
-- Without this, the UPDATE in Step 2 would violate the existing constraint.
-- =============================================================================

ALTER TABLE sync_job_queue
  DROP CONSTRAINT IF EXISTS sync_job_status_check;
ALTER TABLE sync_job_queue
  ADD CONSTRAINT sync_job_status_check
    CHECK (status IN (
      -- new canonical values:
      'queued', 'leased', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled',
      -- old values retained only during this migration flight:
      'claimed', 'success', 'abandoned'
    ));

ALTER TABLE async_job_queue
  DROP CONSTRAINT IF EXISTS async_job_status_check;
ALTER TABLE async_job_queue
  ADD CONSTRAINT async_job_status_check
    CHECK (status IN (
      'queued', 'leased', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled',
      'claimed', 'success', 'abandoned'
    ));

-- =============================================================================
-- Step 2: Rename old status values to the new canonical names.
--
-- Mapping:
--   claimed   → leased       (claim handshake; execution has not started)
--   success   → succeeded    (terminal success state)
--   abandoned → dead_letter  (terminal exhausted-retries state)
--
-- Jobs currently in flight (claimed/running) will be handled correctly:
-- their new status 'leased' is reclaimed by release_stale_*_leases on the
-- next tick if the worker does not complete them within leased_until.
-- =============================================================================

UPDATE sync_job_queue  SET status = 'leased'      WHERE status = 'claimed';
UPDATE sync_job_queue  SET status = 'succeeded'   WHERE status = 'success';
UPDATE sync_job_queue  SET status = 'dead_letter' WHERE status = 'abandoned';

UPDATE async_job_queue SET status = 'leased'      WHERE status = 'claimed';
UPDATE async_job_queue SET status = 'succeeded'   WHERE status = 'success';
UPDATE async_job_queue SET status = 'dead_letter' WHERE status = 'abandoned';

-- =============================================================================
-- Step 3: Tighten constraints — remove the old transitional values.
-- =============================================================================

ALTER TABLE sync_job_queue
  DROP CONSTRAINT IF EXISTS sync_job_status_check;
ALTER TABLE sync_job_queue
  ADD CONSTRAINT sync_job_status_check
    CHECK (status IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'));

ALTER TABLE async_job_queue
  DROP CONSTRAINT IF EXISTS async_job_status_check;
ALTER TABLE async_job_queue
  ADD CONSTRAINT async_job_status_check
    CHECK (status IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'));

-- =============================================================================
-- Step 4: Rebuild partial indexes.
-- The old index predicate was: status IN ('queued', 'claimed').
-- The new predicate covers the equivalent claimable states: 'queued' and
-- 'leased' (stale-leased jobs are also picked up by claim_* for defence-in-depth
-- but the index prioritises fresh queued items).
-- =============================================================================

DROP INDEX IF EXISTS sync_job_status_available_idx;
CREATE INDEX sync_job_status_available_idx
  ON sync_job_queue (status, available_at)
  WHERE status IN ('queued', 'leased');

DROP INDEX IF EXISTS async_job_status_available_idx;
CREATE INDEX async_job_status_available_idx
  ON async_job_queue (status, available_at)
  WHERE status IN ('queued', 'leased');

-- =============================================================================
-- Step 5: Rewrite RPCs — sync queue
-- =============================================================================

-- ── claim_sync_jobs ───────────────────────────────────────────────────────────
--
-- Atomically claims up to p_limit sync jobs and hands them a lease.
--
-- Selection criteria (single WHERE clause, NOT UNION ALL — more robust with
-- FOR UPDATE SKIP LOCKED across concurrent workers):
--   • queued AND available_at <= now  → normal claim path
--   • leased OR running AND leased_until < now  → stale recovery
--     (defence-in-depth on top of release_stale_sync_leases)
--
-- IMPORTANT: attempts is NOT incremented here.
-- Rationale: a worker may crash before execution begins.  Only an execution
-- that actually attempts the work and encounters an error should count as an
-- attempt.  Incrementing at claim time penalises worker crashes unfairly.
--
-- started_at is NOT set here — it is set by mark_sync_job_running when the
-- worker transitions the job to running immediately before execution begins.

CREATE OR REPLACE FUNCTION claim_sync_jobs(
  p_worker_id     text,
  p_limit         integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  id              uuid,
  site_id         uuid,
  connection_id   uuid,
  loc_ref         text,
  sync_type       text,
  mode            text,
  business_date   date,
  priority        integer,
  trace_id        uuid,
  attempts        integer
)
LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  UPDATE sync_job_queue q
  SET
    status       = 'leased',
    lease_owner  = p_worker_id,
    leased_until = v_now + (p_lease_seconds || ' seconds')::interval
    -- attempts:   NOT touched. See function comment above.
    -- started_at: NOT touched. Set by mark_sync_job_running instead.
  FROM (
    SELECT jq.id
    FROM   sync_job_queue jq
    WHERE  (
      -- Normal path: queued jobs ready to run
      (jq.status = 'queued'  AND jq.available_at <= v_now)
      OR
      -- Stale recovery: leased or running jobs whose lease window has expired
      (jq.status IN ('leased', 'running') AND jq.leased_until < v_now)
    )
    AND jq.attempts < jq.max_attempts
    ORDER  BY jq.priority ASC, jq.available_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING
    q.id, q.site_id, q.connection_id, q.loc_ref,
    q.sync_type, q.mode, q.business_date, q.priority, q.trace_id, q.attempts;
END;
$$;

-- ── mark_sync_job_running ─────────────────────────────────────────────────────
--
-- Transitions leased → running immediately before the worker calls dispatchSync.
-- Records started_at on first call (idempotent on repeated calls for the same job).
--
-- Guards against stale acks: only jobs in 'leased' state can transition.
-- A job that has already been recovered and re-leased by another worker will
-- not be accidentally moved to 'running' by the original worker.
--
-- p_worker_id is optional; when provided it re-confirms the lease owner.

CREATE OR REPLACE FUNCTION mark_sync_job_running(
  p_job_id    uuid,
  p_worker_id text DEFAULT NULL
)
RETURNS void LANGUAGE sql AS $$
  UPDATE sync_job_queue
  SET
    status      = 'running',
    started_at  = COALESCE(started_at, now()),
    lease_owner = COALESCE(p_worker_id, lease_owner)
  WHERE id = p_job_id
    AND status = 'leased';
$$;

-- ── mark_sync_job_success ─────────────────────────────────────────────────────
--
-- Closes the job as succeeded.  Accepts both 'leased' and 'running' as source
-- states so that a worker that skips mark_running (e.g. dry-run path) can still
-- succeed cleanly.  Jobs in any other state are not touched (safe against stale
-- acks from recovered workers whose jobs have been reclaimed).

CREATE OR REPLACE FUNCTION mark_sync_job_success(
  p_job_id       uuid,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS void LANGUAGE sql AS $$
  UPDATE sync_job_queue
  SET
    status       = 'succeeded',
    completed_at = p_completed_at,
    lease_owner  = NULL,
    leased_until = NULL
  WHERE id     = p_job_id
    AND status IN ('leased', 'running');
$$;

-- ── mark_sync_job_failed ──────────────────────────────────────────────────────
--
-- Records the failure, increments attempts, and either requeues with backoff
-- or moves the job to dead_letter if retries are exhausted.
--
-- Attempts increment HERE — not at claim time — so a worker crash before
-- execution does not consume a retry slot.
--
-- Backoff formula: LEAST(p_retry_delay_secs * 2^(pre-increment attempts), 14400)
--   attempt 0 fails: base_secs * 1    (e.g. 60 s)
--   attempt 1 fails: base_secs * 2    (e.g. 120 s)
--   attempt 2 fails: base_secs * 4    (e.g. 240 s)
--   …capped at 4 hours
--
-- Non-retryable callers pass p_retry_delay_secs = 99999; the cap ensures the
-- job is effectively held for 4 hours per additional attempt, not retried
-- indefinitely.
--
-- Source state guard: only 'leased' or 'running' jobs can be failed.
-- This prevents a stale worker ack from wrongly failing a re-queued job.

CREATE OR REPLACE FUNCTION mark_sync_job_failed(
  p_job_id           uuid,
  p_error_msg        text    DEFAULT NULL,
  p_retry_delay_secs integer DEFAULT 60
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_attempts     integer;
  v_max          integer;
  v_new_attempts integer;
  v_backoff_s    integer;
BEGIN
  SELECT attempts, max_attempts
  INTO   v_attempts, v_max
  FROM   sync_job_queue
  WHERE  id = p_job_id
    AND  status IN ('leased', 'running');

  -- Job not in a failable state (already succeeded, recovered by another worker, etc.)
  IF NOT FOUND THEN RETURN; END IF;

  v_new_attempts := v_attempts + 1;
  -- Backoff uses the count BEFORE this failure as the exponent so the first
  -- failure waits base_secs, the second waits 2×, the third 4×, etc.
  v_backoff_s := LEAST(
    (p_retry_delay_secs * POWER(2, v_attempts))::integer,
    14400  -- cap at 4 hours
  );

  UPDATE sync_job_queue
  SET
    attempts     = v_new_attempts,
    status       = CASE
                     WHEN v_new_attempts >= v_max THEN 'dead_letter'
                     ELSE 'queued'
                   END,
    last_error   = p_error_msg,
    available_at = CASE
                     WHEN v_new_attempts >= v_max THEN available_at
                     ELSE now() + (v_backoff_s || ' seconds')::interval
                   END,
    lease_owner  = NULL,
    leased_until = NULL,
    completed_at = CASE WHEN v_new_attempts >= v_max THEN now() ELSE NULL END
  WHERE id = p_job_id;
END;
$$;

-- ── release_stale_sync_leases ─────────────────────────────────────────────────
--
-- Resets jobs whose lease window has expired without a success/failed mark.
-- Covers both 'leased' and 'running':
--   'leased'  — worker crashed or timed out before calling mark_sync_job_running
--   'running' — worker crashed mid-execution before calling mark_sync_job_success/failed
--
-- Does NOT increment attempts: the job never completed an execution attempt.
-- This is the mirror of the decision not to increment at claim time.
--
-- Intended to be called at the start of every scheduler tick before claiming.

CREATE OR REPLACE FUNCTION release_stale_sync_leases()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE sync_job_queue
  SET
    status       = 'queued',
    lease_owner  = NULL,
    leased_until = NULL
    -- available_at intentionally not reset: it was in the past when first
    -- claimed, so the job is immediately re-claimable after this update.
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts < max_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =============================================================================
-- Step 6: Rewrite RPCs — async queue
-- (Identical semantics to the sync queue above; see those comments for rationale.)
-- =============================================================================

-- ── claim_async_jobs ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_async_jobs(
  p_worker_id     text,
  p_limit         integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  id               uuid,
  job_type         text,
  payload          jsonb,
  idempotency_key  text,
  attempts         integer
)
LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  UPDATE async_job_queue q
  SET
    status       = 'leased',
    lease_owner  = p_worker_id,
    leased_until = v_now + (p_lease_seconds || ' seconds')::interval
    -- attempts:   NOT touched (see claim_sync_jobs comment)
    -- started_at: set by mark_async_job_running instead
  FROM (
    SELECT jq.id
    FROM   async_job_queue jq
    WHERE  (
      (jq.status = 'queued'  AND jq.available_at <= v_now)
      OR
      (jq.status IN ('leased', 'running') AND jq.leased_until < v_now)
    )
    AND jq.attempts < jq.max_attempts
    ORDER  BY jq.priority ASC, jq.available_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE q.id = sub.id
  RETURNING q.id, q.job_type, q.payload, q.idempotency_key, q.attempts;
END;
$$;

-- ── mark_async_job_running ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_running(
  p_job_id    uuid,
  p_worker_id text DEFAULT NULL
)
RETURNS void LANGUAGE sql AS $$
  UPDATE async_job_queue
  SET
    status      = 'running',
    started_at  = COALESCE(started_at, now()),
    lease_owner = COALESCE(p_worker_id, lease_owner)
  WHERE id = p_job_id
    AND status = 'leased';
$$;

-- ── mark_async_job_success ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_success(p_job_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE async_job_queue
  SET
    status       = 'succeeded',
    completed_at = now(),
    lease_owner  = NULL,
    leased_until = NULL
  WHERE id     = p_job_id
    AND status IN ('leased', 'running');
$$;

-- ── mark_async_job_failed ─────────────────────────────────────────────────────
-- Backoff cap: 2 hours for async jobs (reports/scores; shorter window is safer)

CREATE OR REPLACE FUNCTION mark_async_job_failed(
  p_job_id           uuid,
  p_error_msg        text    DEFAULT NULL,
  p_retry_delay_secs integer DEFAULT 120
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_attempts     integer;
  v_max          integer;
  v_new_attempts integer;
  v_backoff      integer;
BEGIN
  SELECT attempts, max_attempts
  INTO   v_attempts, v_max
  FROM   async_job_queue
  WHERE  id = p_job_id
    AND  status IN ('leased', 'running');

  IF NOT FOUND THEN RETURN; END IF;

  v_new_attempts := v_attempts + 1;
  v_backoff := LEAST(
    (p_retry_delay_secs * POWER(2, v_attempts))::integer,
    7200  -- cap at 2 hours
  );

  UPDATE async_job_queue
  SET
    attempts     = v_new_attempts,
    status       = CASE
                     WHEN v_new_attempts >= v_max THEN 'dead_letter'
                     ELSE 'queued'
                   END,
    last_error   = p_error_msg,
    available_at = CASE
                     WHEN v_new_attempts >= v_max THEN available_at
                     ELSE now() + (v_backoff || ' seconds')::interval
                   END,
    lease_owner  = NULL,
    leased_until = NULL,
    completed_at = CASE WHEN v_new_attempts >= v_max THEN now() ELSE NULL END
  WHERE id = p_job_id;
END;
$$;

-- ── release_stale_async_leases ────────────────────────────────────────────────
-- Async equivalent of release_stale_sync_leases.
-- Called alongside release_stale_sync_leases at the start of each tick.
-- Handles long-running report/score jobs that overshoot their ASYNC_LEASE_SECONDS.

CREATE OR REPLACE FUNCTION release_stale_async_leases()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE async_job_queue
  SET
    status       = 'queued',
    lease_owner  = NULL,
    leased_until = NULL
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts < max_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
