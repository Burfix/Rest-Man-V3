-- ============================================================
-- Migration 052: Accountability Layer — task_accountability_log
-- Full audit trail for every task lifecycle event
-- ============================================================

CREATE TABLE IF NOT EXISTS task_accountability_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid        REFERENCES daily_ops_tasks(id) ON DELETE CASCADE,
  site_id          uuid        REFERENCES sites(id) ON DELETE SET NULL,
  organisation_id  uuid        REFERENCES organisations(id) ON DELETE SET NULL,
  action           text        NOT NULL
                               CHECK (action IN (
                                 'started','completed','delayed','blocked',
                                 'escalated','unblocked','reopened','assigned'
                               )),
  actor_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name       text,
  timestamp        timestamptz NOT NULL DEFAULT now(),
  notes            text,
  sla_met          boolean,
  minutes_from_sla integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accountability_log_task
  ON task_accountability_log (task_id);
CREATE INDEX IF NOT EXISTS idx_accountability_log_site
  ON task_accountability_log (site_id);
CREATE INDEX IF NOT EXISTS idx_accountability_log_actor
  ON task_accountability_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_accountability_log_timestamp
  ON task_accountability_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_accountability_log_site_action
  ON task_accountability_log (site_id, action, timestamp DESC);

ALTER TABLE task_accountability_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accountability_log_site_read"
  ON task_accountability_log FOR SELECT
  USING (
    site_id IN (
      SELECT site_id FROM user_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('super_admin', 'head_office', 'executive')
    )
  );

CREATE POLICY "accountability_log_service_role"
  ON task_accountability_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
