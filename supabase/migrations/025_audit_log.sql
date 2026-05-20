-- ============================================================
-- Migration 025: Audit Log
--
-- Immutable append-only ledger for all critical state changes.
-- Written by application layer via service_role client.
-- Never updated or deleted (only INSERTS allowed).
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  -- What was changed
  entity_type     text NOT NULL,        -- 'action' | 'compliance_item' | 'maintenance_ticket' | 'integration_sync' | etc.
  entity_id       uuid NOT NULL,
  operation       text NOT NULL,        -- 'create' | 'update' | 'delete' | 'assign' | 'complete' | 'escalate' | 'sync_fail' | etc.

  -- Who made the change
  actor_user_id   uuid,                 -- null for system/cron events
  actor_label     text,                 -- display name or 'system:cron' | 'system:api'

  -- Context
  site_id         uuid,
  organisation_id uuid,

  -- Change detail
  before_state    jsonb,                -- snapshot of relevant fields before change (omit PII)
  after_state     jsonb,               -- snapshot of relevant fields after change
  diff            jsonb,               -- key-value pairs that changed
  notes           text,

  -- Request context (for traceability)
  request_id      text,                 -- from X-Request-ID header if available
  user_agent      text,
  ip_address      inet
);

-- Audit log is append-only: deny UPDATE and DELETE for all roles
CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_operation   ON audit_log (operation);
CREATE INDEX IF NOT EXISTS idx_audit_site        ON audit_log (site_id);
CREATE INDEX IF NOT EXISTS idx_audit_occurred    ON audit_log (occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Only service_role writes; authenticated users can read their org's log
CREATE POLICY "srole_insert_audit" ON audit_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "srole_select_audit" ON audit_log FOR SELECT TO service_role USING (true);

-- Executives and auditors can read
CREATE POLICY "exec_read_audit"
  ON audit_log FOR SELECT TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM user_roles
      WHERE  user_id = auth.uid()
        AND  role    IN ('super_admin','executive','auditor','area_manager')
        AND  is_active = true
    )
  );

-- GMs can read audit lines for their own store
CREATE POLICY "gm_read_own_audit"
  ON audit_log FOR SELECT TO authenticated
  USING (
    site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
  );

-- ── Integration Sync Error Log ────────────────────────────────────────────────
-- Dedicated table for integration failures with richer context than audit_log.

CREATE TABLE IF NOT EXISTS integration_errors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  site_id         uuid REFERENCES sites(id),
  source_type     text NOT NULL,         -- 'micros' | 'labour' | 'reviews' | 'compliance'
  sync_batch_id   uuid REFERENCES sync_batches(id),
  error_code      text,
  error_message   text NOT NULL,
  stack_trace     text,
  payload_sample  jsonb,                 -- truncated offending payload for debugging
  resolved        boolean NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  resolved_by     uuid
);

CREATE INDEX IF NOT EXISTS idx_int_errors_site     ON integration_errors (site_id);
CREATE INDEX IF NOT EXISTS idx_int_errors_source   ON integration_errors (source_type);
CREATE INDEX IF NOT EXISTS idx_int_errors_occurred ON integration_errors (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_int_errors_resolved ON integration_errors (resolved);

ALTER TABLE integration_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srole_full_int_errors" ON integration_errors FOR ALL TO service_role USING (true) WITH CHECK (true);
