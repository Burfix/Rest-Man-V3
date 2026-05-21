-- =============================================================================
-- Migration 094: manager_alerts — WhatsApp Alert Delivery Log
-- =============================================================================
--
-- Records every alert sent (or attempted) to a manager via WhatsApp.
-- Linked to manager_contacts and optionally to system_incidents.
--
-- Status lifecycle:
--   pending → sent | failed
--   sent    → acknowledged
--
-- Dedup key: (manager_id, alert_type, site_id, created_at within window).
-- See application layer (services/alerts/manager-alert-service.ts) for the
-- 30-minute dedup check; DB stores the full audit trail regardless.
--
-- RLS policy:
--   HQ roles: full read/write for all accessible sites.
--   Site roles (gm, supervisor): SELECT only for their site.
--   Service-role: bypasses RLS (alert engine workers).
-- =============================================================================

CREATE TABLE IF NOT EXISTS manager_alerts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  manager_id           UUID        NOT NULL REFERENCES manager_contacts(id) ON DELETE CASCADE,

  -- Classification
  alert_type           TEXT        NOT NULL
                         CHECK (alert_type IN (
                           'labour', 'revenue', 'compliance', 'maintenance',
                           'incident', 'inventory', 'sync', 'custom'
                         )),
  severity             TEXT        NOT NULL DEFAULT 'info'
                         CHECK (severity IN ('info', 'warning', 'critical')),
  source               TEXT        NOT NULL DEFAULT 'system'
                         CHECK (source IN (
                           'manual', 'system', 'incident', 'compliance',
                           'labour', 'revenue', 'maintenance'
                         )),

  -- Content
  title                TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  message              TEXT        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1600),
  incident_id          UUID        NULL REFERENCES system_incidents(id) ON DELETE SET NULL,

  -- Delivery
  status               TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged')),
  whatsapp_message_id  TEXT        NULL,   -- Meta/Twilio message SID or WAMID
  sent_at              TIMESTAMPTZ NULL,
  failed_reason        TEXT        NULL,
  retry_count          INT         NOT NULL DEFAULT 0,

  -- Acknowledgement
  acknowledged_at      TIMESTAMPTZ NULL,
  acknowledged_by      UUID        NULL,   -- user_id if ACK via UI; NULL if via WhatsApp reply

  -- Audit
  created_by           UUID        NULL,   -- NULL for system-generated alerts
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT manager_alerts_sent_requires_msg_id
    CHECK (status != 'sent' OR whatsapp_message_id IS NOT NULL),
  CONSTRAINT manager_alerts_failed_requires_reason
    CHECK (status != 'failed' OR failed_reason IS NOT NULL),
  CONSTRAINT manager_alerts_ack_requires_sent_at
    CHECK (status != 'acknowledged' OR sent_at IS NOT NULL)
);

COMMENT ON TABLE  manager_alerts                       IS 'WhatsApp alert delivery log. One row per delivery attempt.';
COMMENT ON COLUMN manager_alerts.whatsapp_message_id   IS 'WAMID (Meta) or MessageSid (Twilio) for delivery tracking';
COMMENT ON COLUMN manager_alerts.incident_id           IS 'Optional: links alert to a system_incidents row';
COMMENT ON COLUMN manager_alerts.acknowledged_by       IS 'user_id if ACK via UI; NULL if via WhatsApp ACK reply';

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION manager_alerts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manager_alerts_updated_at ON manager_alerts;
CREATE TRIGGER manager_alerts_updated_at
  BEFORE UPDATE ON manager_alerts
  FOR EACH ROW EXECUTE FUNCTION manager_alerts_set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary query: per-site alert history sorted by time
CREATE INDEX IF NOT EXISTS idx_manager_alerts_site_created
  ON manager_alerts (site_id, created_at DESC);

-- Alert engine dedup check: recent alerts for same manager + type
CREATE INDEX IF NOT EXISTS idx_manager_alerts_manager_type_created
  ON manager_alerts (manager_id, alert_type, created_at DESC);

-- Status-based queries (pending/failed queue)
CREATE INDEX IF NOT EXISTS idx_manager_alerts_status_created
  ON manager_alerts (status, created_at DESC)
  WHERE status IN ('pending', 'failed');

-- Incident linkage
CREATE INDEX IF NOT EXISTS idx_manager_alerts_incident
  ON manager_alerts (incident_id)
  WHERE incident_id IS NOT NULL;

-- Delivery tracking by WhatsApp message ID (webhook lookup)
CREATE INDEX IF NOT EXISTS idx_manager_alerts_wamid
  ON manager_alerts (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE manager_alerts ENABLE ROW LEVEL SECURITY;

-- HQ roles: full access across accessible sites
DROP POLICY IF EXISTS manager_alerts_hq_all ON manager_alerts;
CREATE POLICY manager_alerts_hq_all
  ON manager_alerts
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
DROP POLICY IF EXISTS manager_alerts_site_read ON manager_alerts;
CREATE POLICY manager_alerts_site_read
  ON manager_alerts
  FOR SELECT
  TO authenticated
  USING (
    fs_user_can_access_site(auth.uid(), site_id)
    AND (
      (auth.jwt() -> 'user_metadata' ->> 'role') IN ('gm', 'supervisor')
    )
  );
