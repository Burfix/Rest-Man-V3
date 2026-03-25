-- ============================================================
-- Action Lifecycle Events
-- Migration: 037_action_events.sql
--
-- 1. Add escalated + cancelled to actions.status CHECK
-- 2. Create action_events table for lifecycle audit trail
-- ============================================================

-- ── 1. Expand status CHECK to include 'escalated' and 'cancelled' ────────────

ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_check;
ALTER TABLE actions ADD CONSTRAINT actions_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'escalated', 'cancelled'));

-- ── 2. action_events — lifecycle audit trail ─────────────────────────────────

CREATE TABLE IF NOT EXISTS action_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id   uuid        NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  event_type  text        NOT NULL
    CHECK (event_type IN ('created', 'started', 'completed', 'escalated', 'cancelled', 'reopened', 'assigned', 'note')),
  actor       text,
  notes       text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_events_action
  ON action_events (action_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_action_events_type
  ON action_events (event_type, created_at DESC);

-- RLS
ALTER TABLE action_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON action_events;
CREATE POLICY "authenticated_all" ON action_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON action_events;
CREATE POLICY "service_role_all" ON action_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
