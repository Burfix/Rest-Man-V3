-- =============================================================================
-- Migration 106: profit_settings — Per-Site Profit Intelligence Configuration
-- =============================================================================
--
-- Stores per-site targets used by the Profit Intelligence engine:
--   target_food_cost_pct     — target food cost as % of revenue  (default 32%)
--   target_labour_pct        — target labour cost as % of revenue (default 30%)
--   daily_overhead_estimate  — fallback daily overhead in ZAR when
--                              site_overhead_allocations has no rows for the site
--                              (default 0 — engine uses allocations table first)
--   target_margin_pct        — target net operating margin %      (default 12%)
--
-- ENGINE PRIORITY (lib/profit/engine.ts):
--   1. site_overhead_allocations rows → period-scaled overhead (most accurate)
--   2. profit_settings.daily_overhead_estimate → flat daily estimate (fallback)
--   3. Hard-coded defaults (32% food, 30% labour, 12% margin) if no row exists
--
-- One row per site_id. Upsert on site_id conflict.
--
-- RLS:
--   service_role     — full CRUD
--   authenticated    — SELECT for accessible sites (any role)
--   gm / tenant_owner / head_office / executive / super_admin — INSERT + UPDATE
-- =============================================================================

CREATE TABLE IF NOT EXISTS profit_settings (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 UUID          NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,

  -- Percentage targets (0–100)
  target_food_cost_pct    NUMERIC(5,2)  NOT NULL DEFAULT 32.00
                            CHECK (target_food_cost_pct  BETWEEN 0 AND 100),
  target_labour_pct       NUMERIC(5,2)  NOT NULL DEFAULT 30.00
                            CHECK (target_labour_pct     BETWEEN 0 AND 100),
  target_margin_pct       NUMERIC(5,2)  NOT NULL DEFAULT 12.00
                            CHECK (target_margin_pct     BETWEEN 0 AND 100),

  -- Daily overhead fallback (ZAR) — only used when no allocation rows exist
  daily_overhead_estimate NUMERIC(14,2) NOT NULL DEFAULT 0.00
                            CHECK (daily_overhead_estimate >= 0),

  -- Provenance
  updated_by              UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  profit_settings IS
  'Per-site profit intelligence targets. One row per site. '
  'Engine falls back to hard-coded defaults (food 32%, labour 30%, margin 12%) '
  'if no row exists. daily_overhead_estimate is the fallback when '
  'site_overhead_allocations has no rows for the site.';

COMMENT ON COLUMN profit_settings.daily_overhead_estimate IS
  'Fallback daily overhead in ZAR. Ignored when site_overhead_allocations '
  'has rows for this site — the allocation table takes priority.';

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION profit_settings_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profit_settings_updated_at ON profit_settings;
CREATE TRIGGER profit_settings_updated_at
  BEFORE UPDATE ON profit_settings
  FOR EACH ROW EXECUTE FUNCTION profit_settings_set_updated_at();

-- ── Index ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profit_settings_site_id
  ON profit_settings (site_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE profit_settings ENABLE ROW LEVEL SECURITY;

-- Service role: full access (cron, seed, admin APIs)
DROP POLICY IF EXISTS profit_settings_service_role ON profit_settings;
CREATE POLICY profit_settings_service_role
  ON profit_settings
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated: read any accessible site's settings
DROP POLICY IF EXISTS profit_settings_authenticated_read ON profit_settings;
CREATE POLICY profit_settings_authenticated_read
  ON profit_settings
  FOR SELECT
  TO authenticated
  USING (fs_user_can_access_site(site_id));

-- GM and above: write settings for their site
DROP POLICY IF EXISTS profit_settings_write ON profit_settings;
CREATE POLICY profit_settings_write
  ON profit_settings
  FOR ALL
  TO authenticated
  USING (
    fs_user_can_access_site(site_id)
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.is_active = true
        AND ur.role IN ('gm', 'tenant_owner', 'head_office', 'executive', 'super_admin')
    )
  )
  WITH CHECK (
    fs_user_can_access_site(site_id)
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.is_active = true
        AND ur.role IN ('gm', 'tenant_owner', 'head_office', 'executive', 'super_admin')
    )
  );

-- =============================================================================
-- Seed: default profit_settings rows for all 3 active sites
-- =============================================================================
--
-- Targets are set to reasonable hospitality industry benchmarks:
--   food_cost  32% — typical full-service restaurant (SALRSA benchmark range 28-35%)
--   labour_pct 30% — full-service with service staff
--   margin_pct 12% — net operating margin target
--
-- For Primi Camps Bay (000...003):
--   Overhead comes from site_overhead_allocations (migration 096) so
--   daily_overhead_estimate is left at 0 — engine uses allocation table.
--
-- For Si Cantina (000...001) + Sea Castle (000...004):
--   No overhead allocations exist yet (seeded in 107 / 108).
--   daily_overhead_estimate set to a conservative estimate until
--   those migrations are applied.
--
-- Si Cantina avg revenue ~R14,340/day:
--   Estimated daily overhead: ~R6,500 (rent + ops + admin for a busy Cape Town restaurant)
--
-- Sea Castle avg revenue ~R1,182/day (hotel F&B annex):
--   Lower standalone overhead: ~R1,800/day
--
-- These values are REPLACED by site_overhead_allocations once 107/108 are applied.
-- =============================================================================

INSERT INTO profit_settings (site_id, target_food_cost_pct, target_labour_pct, target_margin_pct, daily_overhead_estimate)
VALUES
  -- Si Cantina Sociale
  ('00000000-0000-0000-0000-000000000001', 32.00, 30.00, 12.00, 6500.00),
  -- Primi Camps Bay (overhead comes from allocation table — 096)
  ('00000000-0000-0000-0000-000000000003', 32.00, 30.00, 12.00,    0.00),
  -- Sea Castle Hotel Camps Bay
  ('00000000-0000-0000-0000-000000000004', 32.00, 28.00, 10.00, 1800.00)
ON CONFLICT (site_id) DO UPDATE SET
  target_food_cost_pct    = EXCLUDED.target_food_cost_pct,
  target_labour_pct       = EXCLUDED.target_labour_pct,
  target_margin_pct       = EXCLUDED.target_margin_pct,
  daily_overhead_estimate = EXCLUDED.daily_overhead_estimate,
  updated_at              = now();

-- ── Sanity check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM profit_settings;
  RAISE NOTICE 'profit_settings rows after seed: %', v_count;
  IF v_count < 3 THEN
    RAISE WARNING 'Expected 3 profit_settings rows (one per active site), found %. Check site UUIDs.', v_count;
  END IF;
END $$;
