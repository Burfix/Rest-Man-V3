-- =============================================================================
-- Migration 091: system_incidents — Operator Workflow Columns + RLS
-- =============================================================================
--
-- Adds incident lifecycle support: acknowledgment, assignment, resolution
-- metadata, operator notes, and escalation level.
--
-- Reconnaissance confirmed:
--   - `resolved_at`  already exists (migration 080) — do NOT re-add
--   - `owner_user_id` already exists (migration 080) — kept as-is
--   - status constraint: ('open', 'investigating', 'resolved') — extend with 'acknowledged'
--   - resolved_at_check: (resolved_at IS NULL OR status = 'resolved') — still valid
--
-- RLS policy decision:
--   - HQ roles (super_admin, executive, head_office): UPDATE any visible incident
--   - Site-level roles (area_manager, gm, supervisor): UPDATE own-site incidents only
--   - Read-only roles (auditor, viewer, contractor): no UPDATE
--   - service_role: bypasses all RLS — unrestricted (Supabase default)
--   - No broad USING(true) anywhere
-- =============================================================================

-- ── Lifecycle columns ─────────────────────────────────────────────────────────

ALTER TABLE system_incidents
  ADD COLUMN IF NOT EXISTS acknowledged_at  TIMESTAMPTZ  NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by  UUID         NULL,
  ADD COLUMN IF NOT EXISTS assigned_to      UUID         NULL,
  ADD COLUMN IF NOT EXISTS resolved_by      UUID         NULL,
  ADD COLUMN IF NOT EXISTS operator_notes   TEXT         NULL,
  ADD COLUMN IF NOT EXISTS escalation_level TEXT         NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now();

-- ── Constraints ───────────────────────────────────────────────────────────────

-- Extend status to include 'acknowledged' (open → acknowledged → investigating → resolved)
ALTER TABLE system_incidents DROP CONSTRAINT IF EXISTS system_incidents_status_check;
ALTER TABLE system_incidents ADD CONSTRAINT system_incidents_status_check
  CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved'));

-- Escalation levels
ALTER TABLE system_incidents DROP CONSTRAINT IF EXISTS system_incidents_escalation_check;
ALTER TABLE system_incidents ADD CONSTRAINT system_incidents_escalation_check
  CHECK (escalation_level IN ('normal', 'elevated', 'urgent'));

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Per-site open incident queries (extends 080's (site_id, created_at) with status)
CREATE INDEX IF NOT EXISTS idx_system_incidents_site_status_created
  ON system_incidents (site_id, status, created_at DESC)
  WHERE site_id IS NOT NULL;

-- "My assigned incidents" view
CREATE INDEX IF NOT EXISTS idx_system_incidents_assigned_status_created
  ON system_incidents (assigned_to, status, created_at DESC)
  WHERE assigned_to IS NOT NULL;

-- Response time analytics
CREATE INDEX IF NOT EXISTS idx_system_incidents_acknowledged_at
  ON system_incidents (acknowledged_at)
  WHERE acknowledged_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_incidents_resolved_at
  ON system_incidents (resolved_at)
  WHERE resolved_at IS NOT NULL;

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION system_incidents_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS system_incidents_updated_at_trigger ON system_incidents;
CREATE TRIGGER system_incidents_updated_at_trigger
  BEFORE UPDATE ON system_incidents
  FOR EACH ROW EXECUTE FUNCTION system_incidents_set_updated_at();

-- ── RLS UPDATE policies ───────────────────────────────────────────────────────
--
-- The existing system_incidents_site_isolation policy covers SELECT.
-- We add two UPDATE policies here — they stack with OR semantics in PostgreSQL.
--
-- Note: service_role bypasses all RLS by default in Supabase/PostgreSQL.

-- Policy 1: HQ roles — can update any incident they can see
--   Condition: user has an elevated role AND incident site is in their accessible sites
--   (or incident has no site_id — platform-level incident)

DROP POLICY IF EXISTS system_incidents_hq_update ON system_incidents;
CREATE POLICY system_incidents_hq_update ON system_incidents
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE  user_id    = auth.uid()
        AND  is_active  = true
        AND  revoked_at IS NULL
        AND  role IN ('super_admin', 'executive', 'head_office')
    )
    AND (
      site_id IS NULL
      OR site_id IN (
        SELECT site_id FROM user_roles
        WHERE  user_id    = auth.uid()
          AND  is_active  = true
          AND  revoked_at IS NULL
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE  user_id    = auth.uid()
        AND  is_active  = true
        AND  revoked_at IS NULL
        AND  role IN ('super_admin', 'executive', 'head_office')
    )
    AND (
      site_id IS NULL
      OR site_id IN (
        SELECT site_id FROM user_roles
        WHERE  user_id    = auth.uid()
          AND  is_active  = true
          AND  revoked_at IS NULL
      )
    )
  );

-- Policy 2: Site-level roles — can only update incidents at their explicitly assigned site
--   The JOIN on site_id = system_incidents.site_id ensures they can only write
--   to incidents belonging to a site they're actually assigned to.

DROP POLICY IF EXISTS system_incidents_site_update ON system_incidents;
CREATE POLICY system_incidents_site_update ON system_incidents
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE  user_id    = auth.uid()
        AND  is_active  = true
        AND  revoked_at IS NULL
        AND  role IN ('area_manager', 'gm', 'supervisor')
        AND  site_id    = system_incidents.site_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE  user_id    = auth.uid()
        AND  is_active  = true
        AND  revoked_at IS NULL
        AND  role IN ('area_manager', 'gm', 'supervisor')
        AND  site_id    = system_incidents.site_id
    )
  );

COMMENT ON COLUMN system_incidents.acknowledged_at  IS 'Timestamp when an operator first acknowledged this incident.';
COMMENT ON COLUMN system_incidents.acknowledged_by  IS 'User ID of the operator who acknowledged.';
COMMENT ON COLUMN system_incidents.assigned_to      IS 'User ID the incident is currently assigned to for resolution.';
COMMENT ON COLUMN system_incidents.resolved_by      IS 'User ID who marked this incident resolved.';
COMMENT ON COLUMN system_incidents.operator_notes   IS 'Free-text operational notes added by an operator.';
COMMENT ON COLUMN system_incidents.escalation_level IS 'normal | elevated | urgent. Defaults to normal.';
COMMENT ON COLUMN system_incidents.updated_at       IS 'Auto-updated on every row mutation via trigger.';
