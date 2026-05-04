-- =============================================================================
-- Migration 079: Structured Audit Logs
-- =============================================================================
--
-- Creates the audit_logs table for structured, site-scoped audit events.
--
-- This is SEPARATE from the legacy audit_log table (migration 025), which
-- stores user-access events (logins, role changes). That table will remain.
--
-- audit_logs stores operational events:
--   - Score calculation results (before/after per user/site/date)
--   - Scheduler job state transitions (queued→running→success/failed)
--   - Schedule configuration changes (cadence, pause, resume)
--   - Operating brain priority action generation
--
-- Design principles:
--   - APPEND-ONLY: no UPDATE or DELETE (enforced by rules below)
--   - NEVER nullable site_id: every event must be scoped to a site
--   - JSONB payloads capped by application (not DB) to keep rows lean
--   - RLS policy added as defence-in-depth; service-role bypasses it
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  site_id      UUID        NOT NULL,   -- MANDATORY: every event scoped to a site
  actor_type   TEXT        NOT NULL
    CONSTRAINT audit_logs_actor_type_check
    CHECK (actor_type IN ('system', 'user', 'scheduler', 'api')),
  actor_id     TEXT,                   -- userId, 'score-calculator', 'worker-<id>', etc.
  action       TEXT        NOT NULL,   -- e.g. 'score.calculated', 'job.transitioned'
  entity_type  TEXT        NOT NULL,   -- e.g. 'manager_score', 'sync_job', 'schedule'
  entity_id    TEXT,                   -- UUID or composite key for the affected record
  before_state JSONB,                  -- snapshot before change (NULL for creates)
  after_state  JSONB,                  -- snapshot after change (NULL for deletes)
  metadata     JSONB,                  -- extra context (attempts, error_message, etc.)
  ip_address   INET,                   -- caller IP for user-initiated events
  user_agent   TEXT,                   -- browser UA for user-initiated events
  request_id   UUID                    -- trace token linking related audit entries
);

-- ── Indexes ────────────────────────────────────────────────────────────────────
-- All indexes include created_at DESC so range queries on recent data are fast.

CREATE INDEX IF NOT EXISTS idx_audit_logs_site_created
  ON audit_logs (site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_type, actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action, created_at DESC);

-- ── Append-only enforcement ────────────────────────────────────────────────────

CREATE OR REPLACE RULE audit_logs_no_update AS ON UPDATE TO audit_logs
  DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_logs_no_delete AS ON DELETE TO audit_logs
  DO INSTEAD NOTHING;

-- ── Row-Level Security (defence-in-depth) ─────────────────────────────────────
-- Service-role bypasses RLS. Authenticated users may only read their own site's logs.
-- Inserts are performed exclusively by service-role (not by browser clients).

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_site_isolation ON audit_logs;
CREATE POLICY audit_logs_site_isolation ON audit_logs
  FOR SELECT TO authenticated
  USING (
    site_id IN (
      SELECT site_id
      FROM   user_roles
      WHERE  user_id = auth.uid()
        AND  is_active = true
        AND  revoked_at IS NULL
    )
  );

COMMENT ON TABLE audit_logs IS
  'Structured operational audit log. Append-only. '
  'Every row is scoped to a site_id. Service-role writes; authenticated reads are site-isolated.';
