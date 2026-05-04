-- =============================================================================
-- Migration 080: System Incidents Table
-- =============================================================================
--
-- Creates the system_incidents table for the in-app System Health console.
--
-- Incidents are operational events that represent degraded or failed states
-- in the ForgeStack platform — MICROS sync failures, stale data windows,
-- scheduled job failures, auth errors, etc.
--
-- Design:
--   - site_id is NULLABLE: platform-level incidents (DB outage, cron failure)
--     affect all sites and have no single site_id.
--   - org_id is NULLABLE: for multi-tenant context.
--   - status: open → investigating → resolved
--   - details: arbitrary JSONB for structured root-cause data
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_incidents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID        NULL,
  org_id          UUID        NULL,
  source          TEXT        NOT NULL,   -- e.g. 'scheduler', 'micros', 'api', 'operator'
  severity        TEXT        NOT NULL DEFAULT 'warning'
    CONSTRAINT system_incidents_severity_check
    CHECK (severity IN ('info', 'warning', 'critical')),
  summary         TEXT        NOT NULL,
  details         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'open'
    CONSTRAINT system_incidents_status_check
    CHECK (status IN ('open', 'investigating', 'resolved')),
  owner_user_id   UUID        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ NULL,
  CONSTRAINT system_incidents_resolved_at_check
    CHECK (resolved_at IS NULL OR status = 'resolved')
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_system_incidents_site_created
  ON system_incidents (site_id, created_at DESC)
  WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_incidents_status_created
  ON system_incidents (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_incidents_severity
  ON system_incidents (severity, created_at DESC)
  WHERE status != 'resolved';

-- ── Row-Level Security ─────────────────────────────────────────────────────────

ALTER TABLE system_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_incidents_site_isolation ON system_incidents;
CREATE POLICY system_incidents_site_isolation ON system_incidents
  FOR SELECT TO authenticated
  USING (
    site_id IS NULL
    OR site_id IN (
      SELECT site_id FROM user_roles
      WHERE  user_id = auth.uid()
        AND  is_active = true
        AND  revoked_at IS NULL
    )
  );

COMMENT ON TABLE system_incidents IS
  'Platform operational incidents. Nullable site_id for platform-wide events. '
  'status: open → investigating → resolved.';
