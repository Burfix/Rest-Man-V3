-- =============================================================================
-- Migration 084: Security Audit Log (Tenant Isolation Events)
-- =============================================================================
--
-- Separate from the general audit_log (migration 025) which tracks
-- business-object mutations.  This table is a security event ledger:
--   - Cross-tenant access attempts
--   - MICROS sync starts/completions/failures (with tenant context)
--   - Permission denials
--   - Dangerous route accesses
--
-- Append-only.  Only service_role may write; executives/auditors may read
-- their own org's records.  super_admin can read everything.
--
-- The utility in lib/security/audit-log.ts writes to this table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at              timestamptz DEFAULT now() NOT NULL,

  -- Actor
  user_id                 uuid,                         -- null for system/cron events
  user_role               text,                         -- snapshot at time of event

  -- Request context
  route                   text,                         -- e.g. "POST /api/micros/sync"
  ip_address              text,
  user_agent              text,

  -- Event
  action                  text        NOT NULL,          -- see ACTION constants in audit-log.ts
  status                  text        NOT NULL,          -- 'allowed' | 'denied' | 'started' | 'completed' | 'failed'
  denied_reason           text,                         -- populated when status='denied'

  -- Tenant scope (what was being accessed)
  target_site_id          uuid,
  target_organisation_id  uuid,

  -- Structured detail (no PII, no secrets)
  metadata                jsonb       DEFAULT '{}'::jsonb
);

-- Append-only guards
CREATE RULE no_update_security_audit AS ON UPDATE TO security_audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_security_audit AS ON DELETE TO security_audit_logs DO INSTEAD NOTHING;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sal_created    ON security_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sal_user       ON security_audit_logs (user_id)          WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sal_site       ON security_audit_logs (target_site_id)   WHERE target_site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sal_action     ON security_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_sal_status     ON security_audit_logs (status);

-- RLS
ALTER TABLE security_audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role can insert (the only writer)
CREATE POLICY "srole_insert_sal"
  ON security_audit_logs FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "srole_select_sal"
  ON security_audit_logs FOR SELECT TO service_role
  USING (true);

-- Executives and auditors see their own org's log
CREATE POLICY "exec_read_sal"
  ON security_audit_logs FOR SELECT TO authenticated
  USING (
    -- super_admin sees everything
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND   ur.role    = 'super_admin'
      AND   ur.is_active = true
    )
    OR
    -- Elevated roles see their org's records
    (
      target_organisation_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id         = auth.uid()
        AND   ur.organisation_id = security_audit_logs.target_organisation_id
        AND   ur.role           IN ('head_office', 'executive', 'auditor', 'area_manager')
        AND   ur.is_active       = true
      )
    )
    OR
    -- A user can always see their own entries
    user_id = auth.uid()
  );

COMMENT ON TABLE security_audit_logs IS
  'Security event ledger for tenant isolation monitoring. '
  'Append-only (no UPDATE/DELETE). Written by lib/security/audit-log.ts. '
  'Separate from general audit_log (migration 025) which tracks business object mutations.';
