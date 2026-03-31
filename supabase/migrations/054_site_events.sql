-- ============================================================
-- Migration 054: site_events — Sports & Events Calendar
-- Per-site event uplift entries for the forecasting engine.
-- GMs and Head Office can add upcoming fixtures via the admin UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS site_events (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id           UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_name        TEXT        NOT NULL,
  event_date        DATE        NOT NULL,
  category          TEXT        NOT NULL DEFAULT 'custom',
  uplift_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.0
    CHECK (uplift_multiplier >= 1.0 AND uplift_multiplier <= 3.0),
  confirmed         BOOLEAN     NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast date-range lookup for the forecasting engine
CREATE INDEX IF NOT EXISTS site_events_site_date
  ON site_events (site_id, event_date);

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE site_events ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can view events for their site
CREATE POLICY "site_events_select" ON site_events
  FOR SELECT USING (
    site_id IN (
      SELECT site_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Head office can view all events
CREATE POLICY "site_events_select_head_office" ON site_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('head_office', 'super_admin')
    )
  );

-- GMs, Head Office, Super Admin can insert events for their site
CREATE POLICY "site_events_insert" ON site_events
  FOR INSERT WITH CHECK (
    site_id IN (
      SELECT site_id FROM profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'head_office', 'super_admin')
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('head_office', 'super_admin')
    )
  );

-- GMs can delete events for their own site; Head Office / Super Admin any site
CREATE POLICY "site_events_delete" ON site_events
  FOR DELETE USING (
    site_id IN (
      SELECT site_id FROM profiles
      WHERE id = auth.uid()
        AND role IN ('gm', 'head_office', 'super_admin')
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('head_office', 'super_admin')
    )
  );
