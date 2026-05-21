-- =============================================================================
-- Migration 093: manager_contacts — Site Manager Contact Directory
-- =============================================================================
--
-- Stores WhatsApp-reachable manager contacts per site.
-- Tenant-isolated: every row belongs to exactly one site.
--
-- alert_preferences JSONB schema (optional):
--   {
--     "labour":      true,   -- receive labour alerts
--     "revenue":     true,   -- receive revenue alerts
--     "compliance":  false,
--     "maintenance": true,
--     "incident":    true,
--     "quiet_hours": { "start": "22:00", "end": "07:00", "tz": "Africa/Johannesburg" }
--   }
--
-- RLS policy:
--   HQ roles (super_admin, executive, head_office): full CRUD across all
--     sites accessible via fs_user_can_access_site().
--   Site roles (area_manager, gm, supervisor): read-only for their own site.
--   Service-role: bypasses RLS (sync workers, alert engine).
-- =============================================================================

CREATE TABLE IF NOT EXISTS manager_contacts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  role              TEXT        NOT NULL CHECK (char_length(role) BETWEEN 1 AND 80),
  phone_whatsapp    TEXT        NOT NULL
                      CHECK (phone_whatsapp ~ '^\\+[1-9][0-9]{6,14}$'),
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  alert_preferences JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  manager_contacts                    IS 'WhatsApp-reachable manager contacts per site, used by the Alert Engine.';
COMMENT ON COLUMN manager_contacts.phone_whatsapp     IS 'E.164 format, e.g. +27821234567';
COMMENT ON COLUMN manager_contacts.alert_preferences  IS 'Per-topic opt-in flags + optional quiet_hours window';

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION manager_contacts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manager_contacts_updated_at ON manager_contacts;
CREATE TRIGGER manager_contacts_updated_at
  BEFORE UPDATE ON manager_contacts
  FOR EACH ROW EXECUTE FUNCTION manager_contacts_set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_manager_contacts_site_active
  ON manager_contacts (site_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_manager_contacts_phone
  ON manager_contacts (phone_whatsapp);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE manager_contacts ENABLE ROW LEVEL SECURITY;

-- HQ roles: full read/write for all accessible sites
DROP POLICY IF EXISTS manager_contacts_hq_all ON manager_contacts;
CREATE POLICY manager_contacts_hq_all
  ON manager_contacts
  FOR ALL
  TO authenticated
  USING (
    fs_user_can_access_site(auth.uid(), site_id)
    AND (
      (auth.jwt() -> 'user_metadata' ->> 'role') IN
        ('super_admin', 'executive', 'head_office', 'area_manager')
    )
  )
  WITH CHECK (
    fs_user_can_access_site(auth.uid(), site_id)
    AND (
      (auth.jwt() -> 'user_metadata' ->> 'role') IN
        ('super_admin', 'executive', 'head_office', 'area_manager')
    )
  );

-- Site roles: read-only for own site
DROP POLICY IF EXISTS manager_contacts_site_read ON manager_contacts;
CREATE POLICY manager_contacts_site_read
  ON manager_contacts
  FOR SELECT
  TO authenticated
  USING (
    fs_user_can_access_site(auth.uid(), site_id)
    AND (
      (auth.jwt() -> 'user_metadata' ->> 'role') IN ('gm', 'supervisor')
    )
  );
