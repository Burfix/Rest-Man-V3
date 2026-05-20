-- ============================================================
-- MIGRATION 042: Sync Engine V2
-- Production-grade sync infrastructure with locking, checkpoints,
-- idempotency, structured errors, and observability.
-- ============================================================

-- ── Sync Locks ──────────────────────────────────────────────────────────
-- Distributed advisory lock to prevent concurrent syncs of the same type/site.

CREATE TABLE IF NOT EXISTS public.sync_locks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key    TEXT NOT NULL UNIQUE,        -- e.g. "sync:sales:site_abc"
  owner_id    TEXT NOT NULL,               -- run ID that holds the lock
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,        -- auto-expire for zombie protection
  metadata    JSONB DEFAULT '{}'::jsonb    -- extra context (hostname, trigger, etc.)
);

CREATE INDEX idx_sync_locks_expires ON public.sync_locks (expires_at);

-- ── Sync Runs V2 ───────────────────────────────────────────────────────
-- Enhanced audit log — replaces logical dependency on micros_sync_runs.
-- Existing micros_sync_runs kept for backward compat; new syncs write here.

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES public.sites(id),
  sync_type       TEXT NOT NULL,            -- "sales" | "labour" | "inventory"
  source          TEXT NOT NULL DEFAULT 'micros', -- adapter name
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','success','partial','error','cancelled')),
  trigger         TEXT NOT NULL DEFAULT 'manual'
                    CHECK (trigger IN ('manual','cron','retry','webhook')),
  idempotency_key TEXT,                     -- prevents duplicate runs
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  records_fetched INTEGER DEFAULT 0,
  records_written INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  records_errored INTEGER DEFAULT 0,
  error_message   TEXT,
  error_code      TEXT,
  checkpoint_id   UUID,                     -- FK added after checkpoint table created
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_sync_runs_idempotency
  ON public.sync_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_sync_runs_site_type ON public.sync_runs (site_id, sync_type, created_at DESC);
CREATE INDEX idx_sync_runs_status ON public.sync_runs (status) WHERE status IN ('running', 'pending');

-- ── Sync Checkpoints ────────────────────────────────────────────────────
-- Cursor-based resume: store the last successfully synced position.

CREATE TABLE IF NOT EXISTS public.sync_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES public.sites(id),
  sync_type       TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'micros',
  cursor_value    TEXT NOT NULL,            -- e.g. "2025-01-15" or ISO timestamp
  cursor_type     TEXT NOT NULL DEFAULT 'date'
                    CHECK (cursor_type IN ('date','timestamp','offset','token')),
  run_id          UUID REFERENCES public.sync_runs(id),
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, sync_type, source)
);

-- Add FK from sync_runs.checkpoint_id → sync_checkpoints.id
ALTER TABLE public.sync_runs
  ADD CONSTRAINT fk_sync_runs_checkpoint
  FOREIGN KEY (checkpoint_id) REFERENCES public.sync_checkpoints(id);

-- ── Sync Errors ─────────────────────────────────────────────────────────
-- Structured error log per record/batch within a sync run.

CREATE TABLE IF NOT EXISTS public.sync_errors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES public.sync_runs(id) ON DELETE CASCADE,
  site_id     UUID NOT NULL REFERENCES public.sites(id),
  sync_type   TEXT NOT NULL,
  phase       TEXT NOT NULL,                -- "fetch" | "normalize" | "write" | "checkpoint"
  error_code  TEXT,
  message     TEXT NOT NULL,
  record_key  TEXT,                         -- identifies the failed record
  context     JSONB DEFAULT '{}'::jsonb,    -- stack trace, raw payload excerpt, etc.
  retryable   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_errors_run ON public.sync_errors (run_id);
CREATE INDEX idx_sync_errors_site_type ON public.sync_errors (site_id, sync_type, created_at DESC);

-- ── Source Ingestion Fingerprints ───────────────────────────────────────
-- Content-hash deduplication: skip records already written with same hash.

CREATE TABLE IF NOT EXISTS public.source_ingestion_fingerprints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES public.sites(id),
  sync_type       TEXT NOT NULL,
  record_key      TEXT NOT NULL,            -- e.g. "sales:2025-01-15" or check ID
  content_hash    TEXT NOT NULL,            -- SHA-256 of normalized payload
  run_id          UUID REFERENCES public.sync_runs(id),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, sync_type, record_key)
);

CREATE INDEX idx_fingerprints_hash ON public.source_ingestion_fingerprints (content_hash);

-- ── RLS Policies ────────────────────────────────────────────────────────
-- All sync tables are service-role only (server-side sync engine only).

ALTER TABLE public.sync_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_ingestion_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_sync_locks" ON public.sync_locks
  FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_sync_runs" ON public.sync_runs
  FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_sync_checkpoints" ON public.sync_checkpoints
  FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_sync_errors" ON public.sync_errors
  FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_sync_fingerprints" ON public.source_ingestion_fingerprints
  FOR ALL TO service_role USING (true);

-- ── Helper: auto-update updated_at ──────────────────────────────────────

CREATE OR REPLACE FUNCTION update_sync_checkpoint_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_checkpoint_updated
  BEFORE UPDATE ON public.sync_checkpoints
  FOR EACH ROW EXECUTE FUNCTION update_sync_checkpoint_timestamp();

-- ── Cleanup function for expired locks ──────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_expired_sync_locks()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  cleaned INTEGER;
BEGIN
  DELETE FROM public.sync_locks WHERE expires_at < now();
  GET DIAGNOSTICS cleaned = ROW_COUNT;
  RETURN cleaned;
END;
$$;
