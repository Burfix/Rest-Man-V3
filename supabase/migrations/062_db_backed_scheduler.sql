-- =============================================================================
-- Migration 062: Database-Backed Scheduler & Job Queue
-- =============================================================================
--
-- Replaces route-level cron execution with a DB-backed scheduler + queue model.
--
-- Tables created:
--   sync_schedules      — per-site, per-sync-type cadence configuration
--   sync_job_queue      — individual sync work items (claimable with lease)
--   async_job_queue     — non-sync background jobs (reports, scores, reviews)
--   sent_alerts         — dedup log for Slack alert suppression
--   scheduler_auth_keys — rotatable HMAC keys for internal scheduler auth
--
-- RPCs created:
--   get_due_sync_schedules(now_ts, max_rows)
--   enqueue_sync_job(...)
--   claim_sync_jobs(worker_id, limit_count, lease_seconds)
--   mark_sync_job_running(job_id, worker_id)
--   mark_sync_job_success(job_id, completed_at)
--   mark_sync_job_failed(job_id, error_msg, retry_delay_seconds)
--   release_stale_sync_leases()
--   enqueue_async_job(job_type, payload, idempotency_key, available_at)
--   claim_async_jobs(worker_id, limit_count, lease_seconds)
--   mark_async_job_success(job_id)
--   mark_async_job_failed(job_id, error_msg, retry_delay_seconds)
--
-- =============================================================================

-- ── sent_alerts: dedup log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sent_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_class     text NOT NULL,
  connection_id   uuid NOT NULL,
  sync_type       text NOT NULL,
  date_key        text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sent_alerts_dedup_idx
  ON sent_alerts (alert_class, connection_id, sync_type, date_key, sent_at);

-- ── scheduler_auth_keys: rotatable HMAC keys ─────────────────────────────────

CREATE TABLE IF NOT EXISTS scheduler_auth_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash    text NOT NULL UNIQUE,  -- SHA-256 hash of the secret — never plaintext
  is_active   boolean NOT NULL DEFAULT true,
  expires_at  timestamptz NULL,
  description text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── sync_schedules: per-site cadence configuration ───────────────────────────

CREATE TABLE IF NOT EXISTS sync_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  connection_id    uuid NULL REFERENCES micros_connections(id) ON DELETE SET NULL,
  loc_ref          text NOT NULL,
  sync_type        text NOT NULL,
  cadence_minutes  integer NOT NULL DEFAULT 60
    CONSTRAINT cadence_min_1 CHECK (cadence_minutes >= 1),
  enabled          boolean NOT NULL DEFAULT true,
  next_run_at      timestamptz NOT NULL DEFAULT now(),
  last_run_at      timestamptz NULL,
  last_success_at  timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_schedules_unique UNIQUE (site_id, loc_ref, sync_type)
);

CREATE INDEX IF NOT EXISTS sync_schedules_due_idx
  ON sync_schedules (next_run_at, enabled)
  WHERE enabled = true;

-- Keep updated_at current
CREATE OR REPLACE FUNCTION sync_schedules_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_sync_schedules_updated_at ON sync_schedules;
CREATE TRIGGER trg_sync_schedules_updated_at
  BEFORE UPDATE ON sync_schedules
  FOR EACH ROW EXECUTE FUNCTION sync_schedules_set_updated_at();

-- ── sync_job_queue: individual sync work items ────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_job_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL,
  connection_id    uuid NULL,
  loc_ref          text NOT NULL,
  sync_type        text NOT NULL,
  mode             text NOT NULL DEFAULT 'delta'
    CONSTRAINT sync_job_mode_check CHECK (mode IN ('delta', 'full', 'backfill')),
  business_date    date NOT NULL,
  status           text NOT NULL DEFAULT 'queued'
    CONSTRAINT sync_job_status_check CHECK (status IN ('queued', 'claimed', 'running', 'success', 'failed', 'abandoned')),
  priority         integer NOT NULL DEFAULT 100,
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 5,
  available_at     timestamptz NOT NULL DEFAULT now(),
  leased_until     timestamptz NULL,
  lease_owner      text NULL,
  trace_id         uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key  text NOT NULL,
  last_error       text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz NULL,
  completed_at     timestamptz NULL,
  CONSTRAINT sync_job_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS sync_job_status_available_idx
  ON sync_job_queue (status, available_at)
  WHERE status IN ('queued', 'claimed');

CREATE INDEX IF NOT EXISTS sync_job_site_type_date_idx
  ON sync_job_queue (site_id, sync_type, business_date);

-- ── async_job_queue: non-sync background jobs ─────────────────────────────────

CREATE TABLE IF NOT EXISTS async_job_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type         text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'queued'
    CONSTRAINT async_job_status_check CHECK (status IN ('queued', 'claimed', 'running', 'success', 'failed', 'abandoned')),
  priority         integer NOT NULL DEFAULT 100,
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 3,
  available_at     timestamptz NOT NULL DEFAULT now(),
  leased_until     timestamptz NULL,
  lease_owner      text NULL,
  idempotency_key  text NOT NULL,
  last_error       text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz NULL,
  completed_at     timestamptz NULL,
  CONSTRAINT async_job_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS async_job_status_available_idx
  ON async_job_queue (status, available_at)
  WHERE status IN ('queued', 'claimed');

-- =============================================================================
-- RPCs
-- =============================================================================

-- ── get_due_sync_schedules ────────────────────────────────────────────────────
-- Returns schedules whose next_run_at is <= now_ts and that are enabled.

CREATE OR REPLACE FUNCTION get_due_sync_schedules(
  now_ts      timestamptz DEFAULT now(),
  max_rows    integer     DEFAULT 50
)
RETURNS TABLE (
  id              uuid,
  site_id         uuid,
  connection_id   uuid,
  loc_ref         text,
  sync_type       text,
  cadence_minutes integer
)
LANGUAGE sql STABLE AS $$
  SELECT id, site_id, connection_id, loc_ref, sync_type, cadence_minutes
  FROM   sync_schedules
  WHERE  enabled = true
    AND  next_run_at <= now_ts
  ORDER  BY next_run_at ASC
  LIMIT  max_rows;
$$;

-- ── enqueue_sync_job ──────────────────────────────────────────────────────────
-- Idempotently inserts a sync job. Returns the job id (existing or new).

CREATE OR REPLACE FUNCTION enqueue_sync_job(
  p_site_id         uuid,
  p_connection_id   uuid,
  p_loc_ref         text,
  p_sync_type       text,
  p_mode            text DEFAULT 'delta',
  p_business_date   date DEFAULT CURRENT_DATE,
  p_priority        integer DEFAULT 100,
  p_trace_id        uuid DEFAULT gen_random_uuid(),
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
  v_id  uuid;
BEGIN
  -- Deterministic idempotency key: site + loc + type + date + mode
  v_key := COALESCE(
    p_idempotency_key,
    p_site_id::text || '|' || p_loc_ref || '|' || p_sync_type || '|' || p_business_date::text || '|' || p_mode
  );

  INSERT INTO sync_job_queue (
    site_id, connection_id, loc_ref, sync_type, mode,
    business_date, priority, trace_id, idempotency_key
  )
  VALUES (
    p_site_id, p_connection_id, p_loc_ref, p_sync_type, p_mode,
    p_business_date, p_priority, p_trace_id, v_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  -- If conflict, return existing id
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM sync_job_queue WHERE idempotency_key = v_key;
  END IF;

  RETURN v_id;
END;
$$;

-- ── claim_sync_jobs ───────────────────────────────────────────────────────────
-- Atomically claims up to limit_count queued or stale-leased jobs.
-- Uses SKIP LOCKED to prevent duplicate claims across concurrent workers.

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
    status       = 'claimed',
    lease_owner  = p_worker_id,
    leased_until = v_now + (p_lease_seconds || ' seconds')::interval,
    attempts     = q.attempts + 1,
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
    WHERE  jq.status = 'claimed'
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

-- ── mark_sync_job_success ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_sync_job_success(
  p_job_id       uuid,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS void LANGUAGE sql AS $$
  UPDATE sync_job_queue
  SET status = 'success', completed_at = p_completed_at, lease_owner = NULL, leased_until = NULL
  WHERE id = p_job_id;
$$;

-- ── mark_sync_job_failed ──────────────────────────────────────────────────────
-- Increments attempts. If max_attempts reached → 'abandoned', else exponential backoff.

CREATE OR REPLACE FUNCTION mark_sync_job_failed(
  p_job_id             uuid,
  p_error_msg          text  DEFAULT NULL,
  p_retry_delay_secs   integer DEFAULT 60
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_attempts    integer;
  v_max         integer;
  v_backoff_s   integer;
BEGIN
  SELECT attempts, max_attempts
  INTO   v_attempts, v_max
  FROM   sync_job_queue
  WHERE  id = p_job_id;

  -- Exponential backoff: base_delay * 2^(attempt-1), capped at 4 hours
  v_backoff_s := LEAST(p_retry_delay_secs * POWER(2, v_attempts - 1)::integer, 14400);

  UPDATE sync_job_queue
  SET
    status        = CASE WHEN v_attempts >= v_max THEN 'abandoned' ELSE 'queued' END,
    last_error    = p_error_msg,
    available_at  = CASE WHEN v_attempts >= v_max THEN available_at ELSE now() + (v_backoff_s || ' seconds')::interval END,
    lease_owner   = NULL,
    leased_until  = NULL,
    completed_at  = CASE WHEN v_attempts >= v_max THEN now() ELSE NULL END
  WHERE id = p_job_id;
END;
$$;

-- ── release_stale_sync_leases ─────────────────────────────────────────────────
-- Reclaims jobs whose lease expired without a completion mark.
-- Suitable for calling at the start of each scheduler tick.

CREATE OR REPLACE FUNCTION release_stale_sync_leases()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE sync_job_queue
  SET status = 'queued', lease_owner = NULL, leased_until = NULL
  WHERE status = 'claimed'
    AND leased_until < now()
    AND attempts < max_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── enqueue_async_job ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enqueue_async_job(
  p_job_type        text,
  p_payload         jsonb    DEFAULT '{}',
  p_idempotency_key text     DEFAULT NULL,
  p_available_at    timestamptz DEFAULT now(),
  p_priority        integer  DEFAULT 100
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
  v_id  uuid;
BEGIN
  v_key := COALESCE(p_idempotency_key, p_job_type || '|' || extract(epoch from now())::text);

  INSERT INTO async_job_queue (job_type, payload, idempotency_key, available_at, priority)
  VALUES (p_job_type, p_payload, v_key, p_available_at, p_priority)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM async_job_queue WHERE idempotency_key = v_key;
  END IF;

  RETURN v_id;
END;
$$;

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
    status       = 'claimed',
    lease_owner  = p_worker_id,
    leased_until = v_now + (p_lease_seconds || ' seconds')::interval,
    attempts     = q.attempts + 1,
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
    WHERE  jq.status = 'claimed'
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

-- ── mark_async_job_success ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_success(p_job_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE async_job_queue
  SET status = 'success', completed_at = now(), lease_owner = NULL, leased_until = NULL
  WHERE id = p_job_id;
$$;

-- ── mark_async_job_failed ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_async_job_failed(
  p_job_id           uuid,
  p_error_msg        text DEFAULT NULL,
  p_retry_delay_secs integer DEFAULT 120
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_attempts integer;
  v_max      integer;
  v_backoff  integer;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max
  FROM async_job_queue WHERE id = p_job_id;

  v_backoff := LEAST(p_retry_delay_secs * POWER(2, v_attempts - 1)::integer, 7200);

  UPDATE async_job_queue
  SET
    status       = CASE WHEN v_attempts >= v_max THEN 'abandoned' ELSE 'queued' END,
    last_error   = p_error_msg,
    available_at = CASE WHEN v_attempts >= v_max THEN available_at ELSE now() + (v_backoff || ' seconds')::interval END,
    lease_owner  = NULL,
    leased_until = NULL,
    completed_at = CASE WHEN v_attempts >= v_max THEN now() ELSE NULL END
  WHERE id = p_job_id;
END;
$$;

-- ── bump_schedule_next_run ─────────────────────────────────────────────────────
-- Called after a schedule fires to advance next_run_at.

CREATE OR REPLACE FUNCTION bump_schedule_next_run(
  p_schedule_id    uuid,
  p_success        boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_cadence integer;
BEGIN
  SELECT cadence_minutes INTO v_cadence
  FROM sync_schedules WHERE id = p_schedule_id;

  UPDATE sync_schedules
  SET
    last_run_at     = now(),
    last_success_at = CASE WHEN p_success THEN now() ELSE last_success_at END,
    next_run_at     = now() + (v_cadence || ' minutes')::interval
  WHERE id = p_schedule_id;
END;
$$;

-- =============================================================================
-- RLS: Only service_role can read/write scheduler tables
-- =============================================================================

ALTER TABLE sent_alerts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_auth_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_schedules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_job_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE async_job_queue        ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — no explicit policies needed for server-side access.
-- Add anon/authenticated policies only if you need dashboard reads.
