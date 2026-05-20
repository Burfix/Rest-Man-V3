-- ============================================================
-- Migration 051: Accountability Layer — daily_ops_tasks columns
-- Adds actor tracking, delay/block audit fields
-- ============================================================

ALTER TABLE daily_ops_tasks
  ADD COLUMN IF NOT EXISTS started_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delayed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS delay_reason          text,
  ADD COLUMN IF NOT EXISTS blocked_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_at            timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason        text,
  ADD COLUMN IF NOT EXISTS escalated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalated_at          timestamptz,
  ADD COLUMN IF NOT EXISTS time_to_complete_minutes integer;

COMMENT ON COLUMN daily_ops_tasks.started_by              IS 'User who clicked Start';
COMMENT ON COLUMN daily_ops_tasks.completed_by            IS 'User who completed the task';
COMMENT ON COLUMN daily_ops_tasks.delayed_at              IS 'When the task was first marked delayed';
COMMENT ON COLUMN daily_ops_tasks.blocked_at              IS 'When the task was first blocked';
COMMENT ON COLUMN daily_ops_tasks.escalated_by            IS 'User who triggered escalation';
COMMENT ON COLUMN daily_ops_tasks.escalated_at            IS 'When escalation was triggered';
COMMENT ON COLUMN daily_ops_tasks.time_to_complete_minutes IS 'Wall-clock minutes from started_at to completed_at';
