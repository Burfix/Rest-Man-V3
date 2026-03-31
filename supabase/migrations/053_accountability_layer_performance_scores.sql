-- ============================================================
-- Migration 053: Accountability Layer — manager_performance_scores
-- Daily rolled-up performance scores per manager per site
-- ============================================================

CREATE TABLE IF NOT EXISTS manager_performance_scores (
  id                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id                  uuid         REFERENCES sites(id) ON DELETE SET NULL,
  organisation_id          uuid         REFERENCES organisations(id) ON DELETE SET NULL,
  period_date              date         NOT NULL,
  tasks_assigned           integer      NOT NULL DEFAULT 0,
  tasks_completed          integer      NOT NULL DEFAULT 0,
  tasks_on_time            integer      NOT NULL DEFAULT 0,
  tasks_late               integer      NOT NULL DEFAULT 0,
  tasks_blocked            integer      NOT NULL DEFAULT 0,
  tasks_escalated          integer      NOT NULL DEFAULT 0,
  completion_rate          numeric(5,2) NOT NULL DEFAULT 0,
  on_time_rate             numeric(5,2) NOT NULL DEFAULT 0,
  avg_completion_minutes   numeric(8,2),
  score                    integer      NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  created_at               timestamptz  NOT NULL DEFAULT now(),
  updated_at               timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (user_id, site_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_manager_scores_user
  ON manager_performance_scores (user_id, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_manager_scores_site_date
  ON manager_performance_scores (site_id, period_date DESC);

ALTER TABLE manager_performance_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_scores_own_read"
  ON manager_performance_scores FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('super_admin', 'head_office', 'executive', 'area_manager')
    )
  );

CREATE POLICY "manager_scores_service_role"
  ON manager_performance_scores FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
