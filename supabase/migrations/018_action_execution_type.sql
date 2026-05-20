-- Migration 018: Add execution_type to actions
-- Determines which quick-action panel is triggered when the action is actioned.

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS execution_type text
    CHECK (execution_type IN ('call','message','staffing','compliance'));

COMMENT ON COLUMN actions.execution_type IS
  'Execution modality: call | message | staffing | compliance — drives the quick-action button';
