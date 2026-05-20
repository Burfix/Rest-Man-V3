-- ============================================================
-- Migration 078: Profit Intelligence
-- Purpose: Add profit_settings and profit_snapshots tables for
--          the client-facing Profit Intelligence module.
-- ============================================================

-- ── profit_settings ──────────────────────────────────────────────────────────
-- Per-site configuration for profit targets and overhead estimates.
-- Augments existing sites.target_labour_pct / target_margin_pct with
-- more granular financial parameters.

CREATE TABLE IF NOT EXISTS profit_settings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  target_food_cost_pct   numeric(5,2) NOT NULL DEFAULT 32.00,
  target_labour_pct      numeric(5,2) NOT NULL DEFAULT 30.00,
  daily_overhead_estimate numeric(12,2) NOT NULL DEFAULT 0.00,
  target_margin_pct      numeric(5,2) NOT NULL DEFAULT 12.00,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profit_settings_site_unique UNIQUE (site_id)
);

CREATE INDEX IF NOT EXISTS profit_settings_site_idx ON profit_settings (site_id);

-- ── profit_snapshots ─────────────────────────────────────────────────────────
-- Persisted daily profit calculations for history, trend analysis, and HO views.

CREATE TABLE IF NOT EXISTS profit_snapshots (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                   uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  business_date             date NOT NULL,
  revenue                   numeric(12,2),
  labour_cost               numeric(12,2),
  estimated_food_cost       numeric(12,2),
  gross_profit              numeric(12,2),
  gross_margin_pct          numeric(6,3),
  operating_profit_estimate numeric(12,2),
  profit_at_risk            numeric(12,2),
  confidence_level          text CHECK (confidence_level IN ('high','medium','low')),
  data_quality              jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profit_snapshots_site_date_unique UNIQUE (site_id, business_date)
);

CREATE INDEX IF NOT EXISTS profit_snapshots_site_idx  ON profit_snapshots (site_id);
CREATE INDEX IF NOT EXISTS profit_snapshots_date_idx  ON profit_snapshots (business_date DESC);

-- ── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profit_settings_updated_at'
  ) THEN
    CREATE TRIGGER profit_settings_updated_at
      BEFORE UPDATE ON profit_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE profit_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profit_snapshots  ENABLE ROW LEVEL SECURITY;

-- profit_settings: site members can read; tenant owners / executives can write
CREATE POLICY profit_settings_read ON profit_settings
  FOR SELECT
  USING (
    site_id IN (
      SELECT site_id FROM user_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin','tenant_owner','executive','head_office')
        AND is_active = true
    )
  );

CREATE POLICY profit_settings_write ON profit_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin','tenant_owner','executive','head_office')
        AND is_active = true
    )
  );

-- profit_snapshots: same read pattern
CREATE POLICY profit_snapshots_read ON profit_snapshots
  FOR SELECT
  USING (
    site_id IN (
      SELECT site_id FROM user_roles
      WHERE user_id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin','tenant_owner','executive','head_office','area_manager')
        AND is_active = true
    )
  );

CREATE POLICY profit_snapshots_write ON profit_snapshots
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin','tenant_owner','executive','head_office')
        AND is_active = true
    )
  );
