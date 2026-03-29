-- ============================================================
-- Migration 049: Daily Operations Actions Tracker
--
-- Two tables:
--   1. daily_ops_task_templates — 7 default task definitions per site
--   2. daily_ops_tasks          — daily task instances with full workflow
-- ============================================================

-- ── 1. Task Templates ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_ops_task_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid REFERENCES sites(id) ON DELETE CASCADE,
  action_name       text NOT NULL,
  department        text NOT NULL DEFAULT 'General',
  default_priority  text NOT NULL DEFAULT 'medium'
                      CHECK (default_priority IN ('critical','high','medium','low')),
  default_due_time  time NOT NULL DEFAULT '12:00',
  sla_description   text,
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_ops_templates_site
  ON daily_ops_task_templates (site_id);

-- ── 2. Daily Task Instances ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_ops_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  template_id       uuid REFERENCES daily_ops_task_templates(id) ON DELETE SET NULL,
  task_date         date NOT NULL DEFAULT CURRENT_DATE,
  action_name       text NOT NULL,
  assigned_to       uuid,
  department        text NOT NULL DEFAULT 'General',
  priority          text NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('critical','high','medium','low')),
  due_time          time NOT NULL DEFAULT '12:00',
  status            text NOT NULL DEFAULT 'not_started'
                      CHECK (status IN (
                        'not_started','started','in_progress',
                        'blocked','delayed','completed','escalated','missed'
                      )),
  started_at        timestamptz,
  completed_at      timestamptz,
  duration_minutes  integer,
  comments_start    text,
  comments_end      text,
  blocker_reason    text,
  escalated_to      text,
  evidence_urls     jsonb NOT NULL DEFAULT '[]'::jsonb,
  sla_description   text,
  sort_order        integer NOT NULL DEFAULT 0,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (site_id, task_date, action_name)
);

CREATE INDEX IF NOT EXISTS idx_daily_ops_tasks_site_date
  ON daily_ops_tasks (site_id, task_date);

CREATE INDEX IF NOT EXISTS idx_daily_ops_tasks_status
  ON daily_ops_tasks (status) WHERE status != 'completed';

-- ── 3. Seed Default Templates (NULL site_id = global defaults) ─────────────────

INSERT INTO daily_ops_task_templates
  (site_id, action_name, department, default_priority, default_due_time, sla_description, sort_order)
VALUES
  (NULL, 'FOH Procedures',    'FOH',     'high',   '10:00', 'Must be started before service',      1),
  (NULL, 'Daily Deep Clean',  'Kitchen', 'high',   '09:00', 'Must be completed before opening',    2),
  (NULL, 'Par Level Checks',  'Kitchen', 'medium', '10:00', 'Must be done before ordering',        3),
  (NULL, 'Sheet to Shelf',    'Kitchen', 'medium', '11:00', 'After delivery, before prep',         4),
  (NULL, 'Ordering',          'Kitchen', 'high',   '12:00', 'Must be completed by cut-off',        5),
  (NULL, 'Invoice Capture',   'Admin',   'medium', '16:00', 'Must be completed daily',             6),
  (NULL, 'Daily Stock Take',  'Kitchen', 'high',   '21:00', 'Must be completed before close',      7)
ON CONFLICT DO NOTHING;
