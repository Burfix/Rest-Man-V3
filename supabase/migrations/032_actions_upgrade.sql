-- ============================================================
-- Actions System Upgrade
-- Migration: 032_actions_upgrade.sql
--
-- Adds category, due date, role tracking, impact context,
-- and completion notes to the existing actions table.
-- ============================================================

-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS category        text,
  ADD COLUMN IF NOT EXISTS due_at          timestamptz,
  ADD COLUMN IF NOT EXISTS assignee_role   text,
  ADD COLUMN IF NOT EXISTS expected_impact text,
  ADD COLUMN IF NOT EXISTS why_it_matters  text,
  ADD COLUMN IF NOT EXISTS source_module   text,
  ADD COLUMN IF NOT EXISTS completion_note text;

-- ── Constraints ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE actions ADD CONSTRAINT chk_actions_category
    CHECK (category IS NULL OR category IN (
      'revenue', 'labour', 'food_cost', 'stock',
      'maintenance', 'compliance', 'daily_ops', 'service', 'general'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_actions_category
  ON actions (category) WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_actions_due
  ON actions (due_at ASC) WHERE due_at IS NOT NULL AND status != 'completed';

-- Overdue actions are queried at runtime; a partial index on (due_at, status)
-- for non-completed rows is sufficient — the due_at < now() filter is applied
-- at query time, not in the index predicate.
CREATE INDEX IF NOT EXISTS idx_actions_overdue
  ON actions (due_at, status) WHERE status != 'completed' AND due_at IS NOT NULL;

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON COLUMN actions.category        IS 'Operational category: revenue, labour, food_cost, stock, maintenance, compliance, daily_ops, service, general';
COMMENT ON COLUMN actions.due_at          IS 'When the action should be completed by';
COMMENT ON COLUMN actions.assignee_role   IS 'Role of the assigned person (GM, Floor Manager, Chef, etc.)';
COMMENT ON COLUMN actions.expected_impact IS 'Expected operational impact of completing this action';
COMMENT ON COLUMN actions.why_it_matters  IS 'Business context for why this action is important';
COMMENT ON COLUMN actions.source_module   IS 'Which module generated this action (forecast, inventory, compliance, etc.)';
COMMENT ON COLUMN actions.completion_note IS 'Note added on completion about what was done';
