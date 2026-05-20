-- =============================================================================
-- Migration 064  —  Scheduler: lease-owner enforcement + zombie job recovery
-- =============================================================================
--
-- Fixes two production bugs found by the scheduler torture-test suite.
--
-- ── BUG 1  Stale-ack safety gap (lease-owner NOT enforced in mark_* RPCs) ────
--
--   mark_sync_job_success / mark_sync_job_failed
--   mark_async_job_success / mark_async_job_failed
--   all guard on  status IN ('leased','running')  but NOT on
--   lease_owner = p_worker_id.
--
--   Crash scenario that exposes the bug:
--     1. Worker A owns job X (status=running, lease_owner='tick:A').
--     2. lease_* expires; release_stale_*_leases resets X to 'queued'.
--     3. Worker B claims X (lease_owner='tick:B'), transitions to 'running'.
--     4. Worker A wakes from crash and sends a stale mark_*_failed ack.
--     5. Without the fix: status IS 'running' → ack succeeds, Worker B's job
--        is corrupted (attempts incremented, status changed to 'queued').
--
--   Fix: add optional  p_worker_id text DEFAULT NULL  to all four RPCs.
--        When provided the WHERE clause gains:
--          AND (p_worker_id IS NULL OR lease_owner = p_worker_id)
--        Backward-compatible: callers that omit p_worker_id retain the old
--        status-only behaviour.
--
-- ── BUG 2  Zombie job dead-lock (exhausted-attempts stale-running jobs) ───────
--
--   release_stale_sync_leases / release_stale_async_leases
--   both guard recovery with  attempts < max_attempts.
--   A job that crashes on its LAST attempt (before calling mark_*_failed)
--   is permanently stuck:  status='running'  leased_until<now  attempts=max.
--   The attempts guard prevents recovery; the status guard prevents marking
--   it dead_letter; nothing can un-stick it without manual intervention.
--
--   Fix: add a second UPDATE in each release function that drives those
--        zombie jobs directly to 'dead_letter'.
-- =============================================================================


-- ── Bug 1: mark_sync_job_success ──────────────────────────────────────────────
--
-- Added p_worker_id (DEFAULT NULL).
-- When supplied: AND (p_worker_id IS NULL OR lease_owner = p_worker_id)
-- rejects stale acks from workers that no longer own the job.

CREATE OR REPLACE FUNCTION mark_sync_job_success(
  p_job_id       uuid,
  p_completed_at timestamptz DEFAULT now(),
  p_worker_id    text        DEFAULT NULL
)
RETURNS void LANGUAGE sql AS $$
  UPDATE sync_job_queue
  SET
    status       = 'succeeded',
    completed_at = p_completed_at,
    lease_owner  = NULL,
    leased_until = NULL
  WHERE id     = p_job_id
    AND status IN ('leased', 'running')
    AND (p_worker_id IS NULL OR lease_owner = p_worker_id);
$$;


-- ── Bug 1: mark_sync_job_failed ───────────────────────────────────────────────
--
-- Added p_worker_id (DEFAULT NULL).
-- The SELECT…INTO guard now also checks lease_owner, so a stale ack from
-- Worker A cannot increment attempts or requeue a job owned by Worker B.

CREATE OR REPLACE FUNCTION mark_sync_job_failed(
  p_job_id           uuid,
  p_error_msg        text    DEFAULT NULL,
  p_retry_delay_secs integer DEFAULT 60,
  p_worker_id        text    DEFAULT NULL
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
    AND  status IN ('leased', 'running')
    AND  (p_worker_id IS NULL OR lease_owner = p_worker_id);

  IF NOT FOUND THEN RETURN; END IF;

  v_new_attempts := v_attempts + 1;
  v_backoff_s := LEAST(
    (p_retry_delay_secs * POWER(2, v_attempts))::integer,
    14400
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


-- ── Bug 1: mark_async_job_success ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_success(
  p_job_id    uuid,
  p_worker_id text DEFAULT NULL
)
RETURNS void LANGUAGE sql AS $$
  UPDATE async_job_queue
  SET
    status       = 'succeeded',
    completed_at = now(),
    lease_owner  = NULL,
    leased_until = NULL
  WHERE id     = p_job_id
    AND status IN ('leased', 'running')
    AND (p_worker_id IS NULL OR lease_owner = p_worker_id);
$$;


-- ── Bug 1: mark_async_job_failed ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_failed(
  p_job_id           uuid,
  p_error_msg        text    DEFAULT NULL,
  p_retry_delay_secs integer DEFAULT 120,
  p_worker_id        text    DEFAULT NULL
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
    AND  status IN ('leased', 'running')
    AND  (p_worker_id IS NULL OR lease_owner = p_worker_id);

  IF NOT FOUND THEN RETURN; END IF;

  v_new_attempts := v_attempts + 1;
  v_backoff := LEAST(
    (p_retry_delay_secs * POWER(2, v_attempts))::integer,
    7200
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


-- ── Bug 2: release_stale_sync_leases (zombie dead-letter path added) ──────────
--
-- First UPDATE: recoverable stale jobs (attempts < max) → back to 'queued'.
-- Second UPDATE: zombie jobs (attempts >= max, crashed on last attempt) →
--   'dead_letter'.  Without this, they are permanently stuck.

CREATE OR REPLACE FUNCTION release_stale_sync_leases()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count  integer := 0;
  v_zombie integer := 0;
BEGIN
  -- Recoverable: return to queued for retry
  UPDATE sync_job_queue
  SET
    status       = 'queued',
    lease_owner  = NULL,
    leased_until = NULL
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts < max_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Zombie: lease expired on the last attempt before mark_sync_job_failed
  -- was called.  Drive directly to dead_letter.
  UPDATE sync_job_queue
  SET
    status       = 'dead_letter',
    lease_owner  = NULL,
    leased_until = NULL,
    completed_at = COALESCE(completed_at, now()),
    last_error   = COALESCE(last_error, 'zombie: stale lease on exhausted job')
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts >= max_attempts;

  GET DIAGNOSTICS v_zombie = ROW_COUNT;

  RETURN v_count + v_zombie;
END;
$$;


-- ── Bug 2: release_stale_async_leases (zombie dead-letter path added) ─────────

CREATE OR REPLACE FUNCTION release_stale_async_leases()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count  integer := 0;
  v_zombie integer := 0;
BEGIN
  -- Recoverable: return to queued for retry
  UPDATE async_job_queue
  SET
    status       = 'queued',
    lease_owner  = NULL,
    leased_until = NULL
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts < max_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Zombie: lease expired on the last attempt
  UPDATE async_job_queue
  SET
    status       = 'dead_letter',
    lease_owner  = NULL,
    leased_until = NULL,
    completed_at = COALESCE(completed_at, now()),
    last_error   = COALESCE(last_error, 'zombie: stale lease on exhausted job')
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts >= max_attempts;

  GET DIAGNOSTICS v_zombie = ROW_COUNT;

  RETURN v_count + v_zombie;
END;
$$;
