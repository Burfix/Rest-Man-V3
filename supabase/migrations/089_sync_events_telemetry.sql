-- ============================================================
-- Migration 089: Sync Events Telemetry
-- Purpose: Operational history table for all integration syncs.
--          Powers debugging, SLA reporting, anomaly detection,
--          and AI ops recommendations.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  integration   text        NOT NULL,
  job_type      text        NOT NULL,
  status        text        NOT NULL,
  started_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  duration_ms   integer,
  error_code    text,
  message       text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sync_events_integration_check
    CHECK (integration IN ('micros', 'manual', 'forecast')),
  CONSTRAINT sync_events_job_type_check
    CHECK (job_type IN ('sales', 'labour', 'inventory', 'compliance', 'maintenance')),
  CONSTRAINT sync_events_status_check
    CHECK (status IN ('success', 'failed', 'stale'))
);

COMMENT ON TABLE sync_events IS
  'Operational telemetry for all integration sync jobs. '
  'Provides history for SLA reporting, anomaly detection, '
  'and AI ops recommendations.';

-- ── Tenant isolation ─────────────────────────────────────────────────────────

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;

-- GMs and managers see only their own site's events
CREATE POLICY "sync_events_site_isolation"
  ON sync_events
  FOR ALL
  USING (fs_user_can_access_site(site_id));

-- ── Performance indexes ───────────────────────────────────────────────────────

-- Primary query: "last N events for this site" (dashboard, support)
CREATE INDEX IF NOT EXISTS idx_sync_events_site_time
  ON sync_events (site_id, started_at DESC);

-- Query: "recent failures for a specific feed" (alerts, anomaly detection)
CREATE INDEX IF NOT EXISTS idx_sync_events_site_job_status
  ON sync_events (site_id, job_type, status, started_at DESC);

-- Query: "all failures in the last hour" (ops monitoring)
CREATE INDEX IF NOT EXISTS idx_sync_events_status_time
  ON sync_events (status, started_at DESC)
  WHERE status IN ('failed', 'stale');

-- ── Retention policy ─────────────────────────────────────────────────────────
-- Keep 90 days of telemetry; older rows are pruned by a scheduled job.
-- A pg_cron job or Edge Function cron should run:
--   DELETE FROM sync_events WHERE created_at < now() - interval '90 days';
-- This comment documents intent; the cron is wired separately.

COMMENT ON COLUMN sync_events.error_code IS
  'Machine-readable error tag for alerting rules, e.g. AUTH_FAILED, TIMEOUT, STALE_DATA.';
COMMENT ON COLUMN sync_events.duration_ms IS
  'Wall-clock milliseconds from started_at to completed_at. Null for fire-and-forget jobs.';
