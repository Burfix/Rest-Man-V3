-- =============================================================================
-- Migration 063: Scheduler Hardening
-- =============================================================================
--
-- Fixes:
--   1. Status renames: claimed → leased, success → succeeded, abandoned → dead_letter
--      Adds: cancelled
--   2. Attempts increment moved from claim-time to failure-time only
--      (so a worker crash does not burn a retry before execution starts)
--   3. release_stale_sync_leases now also recovers jobs stuck in 'running'
--   4. New RPCs: mark_sync_job_running, mark_async_job_running
--      (explicit lifecycle step: leased → running before actual execution)
--   5. Partial indexes updated to cover the new status values
--
-- =============================================================================

-- ── Step 1: Widen CHECK constraints to allow both old and new values ──────────
-- (so the data migration in step 2 doesn't violate constraints mid-flight)

ALTER TABLE sync_job_queue
  DROP CONSTRAINT IF EXISTS sync_job_status_check;
ALTER TABLE sync_job_queue
  ADD  CONSTRAINT sync_job_status_check
    CHECK (status IN ('queued','leased','running','succeeded','failed','dead_letter','cancelled',
                      -- old values kept temporarily for safe transition:
                      'claimed','success','abandoned'));

ALTER TABLE async_job_queue
  DROP CONSTRAINT IF EXISTS async_job_status_check;
ALTER TABLE async_job_queue
  ADD  CONSTRAINT async_job_status_check
    CHECK (status IN ('queued','leased','running','succeeded','failed','dead_letter','cancelled',
                      -- old values kept temporarily for safe transition:
                      'claimed','success','abandoned'));

-- ── Step 2: Data migration — rename existing status values ───────────────────

UPDATE sync_job_queue SET status = 'leased'     WHERE status = 'claimed';
UPDATE sync_job_queue SET status = 'succeeded'  WHERE status = 'success';
UPDATE sync_job_queue SET status = 'dead_letter' WHERE status = 'abandoned';

UPDATE async_job_queue SET status = 'leased'     WHERE status = 'claimed';
UPDATE async_job_queue SET status = 'succeeded'  WHERE status = 'success';
UPDATE async_job_queue SET status = 'dead_letter' WHERE status = 'abandoned';

-- ── Step 3: Tighten CHECK constraints — remove old values ────────────────────

ALTER TABLE sync_job_queue
  DROP CONSTRAINT IF EXISTS sync_job_status_check;
ALTER TABLE sync_job_queue
  ADD  CONSTRAINT sync_job_status_check
    CHECK (status IN ('queued','leased','running','succeeded','failed','dead_letter','cancelled'));

ALTER TABLE async_job_queue
  DROP CONSTRAINT IF EXISTS async_job_status_check;
ALTER TABLE async_job_queue
  ADD  CONSTRAINT async_job_status_check
    CHECK (status IN ('queued','leased','running','succeeded','failed','dead_letter','cancelled'));

-- ── Step 4: Rebuild partial indexes to cover new status values ───────────────

DROP INDEX IF EXISTS sync_job_status_available_idx;
CREATE INDEX sync_job_status_available_idx
  ON sync_job_queue (status, available_at)
  WHERE status IN ('queued', 'leased');

DROP INDEX IF EXISTS async_job_status_available_idx;
CREATE INDEX async_job_status_available_idx
  ON async_job_queue (status, available_at)
  WHERE status IN ('queued', 'leased');

-- =============================================================================
-- Step 5: Rewrite all affected RPCs
-- =============================================================================

-- ── claim_sync_jobs ───────────────────────────────────────────────────────────
-- Change: status = 'leased' (was 'claimed'), remove attempts increment
-- Rationale: attempts only increments at mark_sync_job_failed, not at claim.
--            A worker crash before execution does not consume a retry.

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
    leased_until = v_now + (p_lease_seconds || ' seconds')::interval,
    -- attempts NOT incremented here — only at mark_sync_job_failed
    started_at   = COALESCE(q.started_at, v_now)
  FROM (
    SELECT jq.id
    FROM   sync_job_queue jq
    WHERE  jq.status = 'queued'
      AND  jq.available_at <= v_now
      AND  jq.attempts < jq.max_attempts
    UNION ALL
    SELECT jq.id
    FROM   sync_job_queue jq
    WHERE  jq.status = 'leased'
      AND  jq.leased_until < v_now   -- stale lease — reclaim
      AND  jq.attempts < jq.max_attempts
    ORDER  BY priority ASC, available_at ASC
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
-- Transitions a leased job to running. Call immediately before execution.
-- This makes it possible to distinguish "lease held but not started" from
-- "execution in progress" in monitoring queries.

CREATE OR REPLACE FUNCTION mark_sync_job_running(
  p_job_id    uuid,
  p_worker_id text DEFAULT NULL
)
RETURNS void LANGUAGE sql AS $$
  UPDATE sync_job_queue
  SET
    status      = 'running',
    lease_owner = COALESCE(p_worker_id, lease_owner)
  WHERE id = p_job_id
    AND status = 'leased';
$$;

-- ── mark_sync_job_success ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_sync_job_success(
  p_job_id       uuid,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS void LANGUAGE sql AS $$
  UPDATE sync_job_queue
  SET status = 'succeeded', completed_at = p_completed_at, lease_owner = NULL, leased_until = NULL
  WHERE id = p_job_id;
$$;

-- ── mark_sync_job_failed ──────────────────────────────────────────────────────
-- Increments attempts HERE (not at claim time).
-- Exponential backoff: base_delay * 2^(current_attempts), capped at 4 hours.
-- If new attempts >= max_attempts → dead_letter, else requeue with backoff.

CREATE OR REPLACE FUNCTION mark_sync_job_failed(
  p_job_id             uuid,
  p_error_msg          text    DEFAULT NULL,
  p_retry_delay_secs   integer DEFAULT 60
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
  WHERE  id = p_job_id;

  v_new_attempts := v_attempts + 1;
  -- Exponential backoff using pre-increment count as exponent
  v_backoff_s := LEAST(p_retry_delay_secs * POWER(2, v_attempts)::integer, 14400);

  UPDATE sync_job_queue
  SET
    attempts      = v_new_attempts,
    status        = CASE WHEN v_new_attempts >= v_max THEN 'dead_letter' ELSE 'queued' END,
    last_error    = p_error_msg,
    available_at  = CASE
                      WHEN v_new_attempts >= v_max THEN available_at
                      ELSE now() + (v_backoff_s || ' seconds')::interval
                    END,
    lease_owner   = NULL,
    leased_until  = NULL,
    completed_at  = CASE WHEN v_new_attempts >= v_max THEN now() ELSE NULL END
  WHERE id = p_job_id;
END;
$$;

-- ── release_stale_sync_leases ─────────────────────────────────────────────────
-- Reset jobs whose lease expired without a completion mark.
-- Now covers both 'leased' (claimed, not yet executing) and 'running'
-- (execution started but worker crashed before marking success/failed).

CREATE OR REPLACE FUNCTION release_stale_sync_leases()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE sync_job_queue
  SET status = 'queued', lease_owner = NULL, leased_until = NULL
  WHERE status IN ('leased', 'running')
    AND leased_until < now()
    AND attempts < max_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── claim_async_jobs ──────────────────────────────────────────────────────────
-- Change: status = 'leased' (was 'claimed'), remove attempts increment.

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
    leased_until = v_now + (p_lease_seconds || ' seconds')::interval,
    -- attempts NOT incremented here — only at mark_async_job_failed
    started_at   = COALESCE(q.started_at, v_now)
  FROM (
    SELECT jq.id
    FROM   async_job_queue jq
    WHERE  jq.status IN ('queued')
      AND  jq.available_at <= v_now
      AND  jq.attempts < jq.max_attempts
    UNION ALL
    SELECT jq.id
    FROM   async_job_queue jq
    WHERE  jq.status = 'leased'
      AND  jq.leased_until < v_now
      AND  jq.attempts < jq.max_attempts
    ORDER  BY priority ASC, available_at ASC
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
    lease_owner = COALESCE(p_worker_id, lease_owner)
  WHERE id = p_job_id
    AND status = 'leased';
$$;

-- ── mark_async_job_success ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_success(p_job_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE async_job_queue
  SET status = 'succeeded', completed_at = now(), lease_owner = NULL, leased_until = NULL
  WHERE id = p_job_id;
$$;

-- ── mark_async_job_failed ─────────────────────────────────────────────────────
-- Increments attempts HERE (not at claim time).

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
  WHERE  id = p_job_id;

  v_new_attempts := v_attempts + 1;
  v_backoff := LEAST(p_retry_delay_secs * POWER(2, v_attempts)::integer, 7200);

  UPDATE async_job_queue
  SET
    attempts     = v_new_attempts,
    status       = CASE WHEN v_new_attempts >= v_max THEN 'dead_letter' ELSE 'queued' END,
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
