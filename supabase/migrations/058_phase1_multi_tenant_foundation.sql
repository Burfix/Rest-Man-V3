-- 058 — Phase 1 Multi-Tenant Foundation
--
-- This migration:
--   1. Removes all hardcoded DEFAULT UUIDs from 13 tables
--   2. Creates the tenant_modules table for feature gating
--   3. Seeds modules for all existing organisations
--
-- ⚠️  WHAT BREAKS IF RUN TODAY:
--   After removing defaults, any INSERT that omits store_id/site_id/org_id
--   will fail with a NOT NULL violation. The following callers must be updated
--   BEFORE running this migration:
--
--     - services/ops/operatingScore.ts → must pass store_id to operating_score_cache
--     - services/forecasting/* → must pass store_id to forecast_runs
--     - lib/copilot/decision-store.ts → must pass site_id
--     - app/api/sales/upload/route.ts → must pass site_id (currently falls back)
--     - services/revenue/* → must pass site_id to food_cost_snapshots
--     - services/bookings/* → must pass store_id to booking_snapshots
--     - Any cron job writing to daily_operating_state, service_signals, stock_movements
--
--   ROLLBACK: Each ALTER can be reversed by re-adding the DEFAULT.
--   See rollback section at bottom of file.
--
-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1: Remove hardcoded DEFAULT '00000000-0000-0000-0000-000000000001'
-- ════════════════════════════════════════════════════════════════════════════
--
-- These 10 columns silently default to Si Cantina's ID when callers omit store_id.
-- After this change, callers MUST pass the value explicitly.

ALTER TABLE booking_snapshots
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE daily_operating_state
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE food_cost_snapshots
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE forecast_runs
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE inventory_items
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE manual_sales_uploads
  ALTER COLUMN site_id DROP DEFAULT;

ALTER TABLE operating_score_cache
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE purchase_orders
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE service_signals
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE stock_movements
  ALTER COLUMN store_id DROP DEFAULT;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2: Remove hardcoded DEFAULT '00000000-0000-0000-0000-000000000000'
-- ════════════════════════════════════════════════════════════════════════════
--
-- These 3 tables use a null-sentinel UUID as default for both store_id and org_id.

ALTER TABLE service_scores
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE service_scores
  ALTER COLUMN org_id DROP DEFAULT;

ALTER TABLE service_streaks
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE service_streaks
  ALTER COLUMN org_id DROP DEFAULT;

ALTER TABLE shift_performance_snapshots
  ALTER COLUMN store_id DROP DEFAULT;

ALTER TABLE shift_performance_snapshots
  ALTER COLUMN org_id DROP DEFAULT;


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3: Create tenant_modules table
-- ════════════════════════════════════════════════════════════════════════════
--
-- Feature flag system for per-org or per-site module gating.
-- When site_id IS NULL, the flag applies org-wide.
-- When site_id IS NOT NULL, it overrides the org-level flag for that site.

CREATE TABLE IF NOT EXISTS tenant_modules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  site_id          UUID REFERENCES sites(id) ON DELETE CASCADE, -- null = org-wide
  module           TEXT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  config           JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only one entry per org+site+module combination
  CONSTRAINT tenant_modules_unique UNIQUE (organisation_id, site_id, module),

  -- Module name must be from the known set
  CONSTRAINT tenant_modules_valid_module CHECK (
    module IN (
      'daily_ops', 'maintenance', 'compliance', 'revenue',
      'labour', 'inventory', 'bookings', 'reviews',
      'head_office', 'forecast', 'accountability'
    )
  )
);

-- Index for the most common lookup: "is module X enabled for site Y?"
CREATE INDEX IF NOT EXISTS idx_tenant_modules_site
  ON tenant_modules (site_id, module)
  WHERE enabled = true;

-- Index for org-wide lookups
CREATE INDEX IF NOT EXISTS idx_tenant_modules_org
  ON tenant_modules (organisation_id, module)
  WHERE site_id IS NULL;

-- RLS: authenticated users can read their own org's modules
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_modules_select"
  ON tenant_modules FOR SELECT
  TO authenticated
  USING (true);  -- Read access controlled at app layer via apiGuard

CREATE POLICY "tenant_modules_admin"
  ON tenant_modules FOR ALL
  TO service_role
  USING (true);


-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4: Seed modules for existing organisations
-- ════════════════════════════════════════════════════════════════════════════
--
-- Enable all modules org-wide for existing pilot accounts.
-- Individual sites can override via site_id-scoped rows later.

DO $$
DECLARE
  org RECORD;
  mod TEXT;
  modules TEXT[] := ARRAY[
    'daily_ops', 'maintenance', 'compliance', 'revenue',
    'labour', 'inventory', 'bookings', 'reviews',
    'head_office', 'forecast', 'accountability'
  ];
BEGIN
  FOR org IN SELECT id FROM organisations LOOP
    FOREACH mod IN ARRAY modules LOOP
      INSERT INTO tenant_modules (organisation_id, site_id, module, enabled)
      VALUES (org.id, NULL, mod, true)
      ON CONFLICT (organisation_id, site_id, module) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (if needed — run manually)
-- ════════════════════════════════════════════════════════════════════════════
--
-- To restore defaults (ONLY if you need to rollback):
--
-- ALTER TABLE booking_snapshots ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE daily_operating_state ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE food_cost_snapshots ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE forecast_runs ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE inventory_items ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE manual_sales_uploads ALTER COLUMN site_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE operating_score_cache ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE purchase_orders ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE service_signals ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE stock_movements ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ALTER TABLE service_scores ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
-- ALTER TABLE service_scores ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
-- ALTER TABLE service_streaks ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
-- ALTER TABLE service_streaks ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
-- ALTER TABLE shift_performance_snapshots ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
-- ALTER TABLE shift_performance_snapshots ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000000';
--
-- DROP TABLE IF EXISTS tenant_modules;
