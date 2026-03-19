-- Migration 019: Daily summary history columns
-- Adds ops_score and missed_actions to action_daily_stats so the
-- evening debrief and 7-day history strip have full data.

ALTER TABLE action_daily_stats
  ADD COLUMN IF NOT EXISTS ops_score      integer CHECK (ops_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS missed_actions integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN action_daily_stats.ops_score      IS 'Operating score (0–100) snapshot at end-of-day reset';
COMMENT ON COLUMN action_daily_stats.missed_actions IS 'Open actions carried forward (not completed) at reset time';
