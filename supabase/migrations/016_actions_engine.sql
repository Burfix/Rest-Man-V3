-- ============================================================
-- Ops Engine — Execution-Driven Actions
-- Migration: 016_actions_engine.sql
--
-- Turns insight display into an operational execution engine.
-- Every alert, risk score, or ops finding can generate an
-- action item that is tracked through its full lifecycle.
--
-- Tables:
--   actions              — task backlog with lifecycle tracking
--   action_daily_stats   — rolled-up performance metrics per day
--
-- Daily reset logic:
--   completed actions are archived (archived_at set);
--   pending/in_progress actions are carried forward automatically
--   (they simply remain in the table with no date filter needed).
-- ============================================================

-- ── 1. actions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS actions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What
  title           text          NOT NULL,
  description     text,
  impact_weight   text          NOT NULL DEFAULT 'medium'
                    CHECK (impact_weight IN ('critical', 'high', 'medium', 'low')),

  -- Lifecycle
  status          text          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed')),

  -- Linking (optional — action may be triggered by a maintenance log, alert, etc.)
  source_type     text,         -- maintenance | alert | compliance | manual | risk
  source_id       uuid,         -- FK to source entity (polymorphic, no FK constraint)

  -- Assignment
  assigned_to     text,         -- free text name / role (e.g. "Floor Manager", "Thami")

  -- Site context
  site_id         uuid          REFERENCES sites(id) ON DELETE SET NULL,
  zone_id         uuid          REFERENCES zones(id) ON DELETE SET NULL,

  -- Timestamps
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  started_at      timestamptz,  -- set when status → in_progress
  completed_at    timestamptz,  -- set when status → completed

  -- Daily reset: archived actions are hidden from the active board
  -- but retained for performance metric queries.
  archived_at     timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_actions_status        ON actions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_active        ON actions (archived_at, status)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_actions_site          ON actions (site_id, status);
CREATE INDEX IF NOT EXISTS idx_actions_source        ON actions (source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actions_completed     ON actions (completed_at DESC)
  WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actions_impact        ON actions (impact_weight, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_actions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_actions_updated_at ON actions;
CREATE TRIGGER trg_actions_updated_at
  BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION update_actions_updated_at();

-- RLS
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON actions;
CREATE POLICY "authenticated_all" ON actions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. action_daily_stats ─────────────────────────────────────────────────────
-- Rolled-up performance snapshot per calendar day.
-- Populated by the /api/actions/daily-reset endpoint each morning.

CREATE TABLE IF NOT EXISTS action_daily_stats (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid          REFERENCES sites(id) ON DELETE SET NULL,
  stat_date             date          NOT NULL,

  -- Counts at end-of-day
  total_created         integer       NOT NULL DEFAULT 0,
  total_completed       integer       NOT NULL DEFAULT 0,
  total_carried_forward integer       NOT NULL DEFAULT 0,

  -- Rates
  completion_rate_pct   numeric(5, 2) NOT NULL DEFAULT 0,
                                      -- (completed / created) * 100

  -- Timing (minutes)
  avg_resolution_minutes numeric(10, 2),
                                      -- avg(completed_at - created_at) for day's completions

  -- Impact breakdown
  critical_completed    integer       NOT NULL DEFAULT 0,
  high_completed        integer       NOT NULL DEFAULT 0,
  medium_completed      integer       NOT NULL DEFAULT 0,
  low_completed         integer       NOT NULL DEFAULT 0,

  created_at            timestamptz   NOT NULL DEFAULT now(),

  UNIQUE (site_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_action_daily_stats_date
  ON action_daily_stats (stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_action_daily_stats_site_date
  ON action_daily_stats (site_id, stat_date DESC);

ALTER TABLE action_daily_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON action_daily_stats;
CREATE POLICY "authenticated_all" ON action_daily_stats
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Seed default site linkage on existing actions (future-proof) ──────────
-- No seed data needed; actions are created at runtime.
-- ============================================================
