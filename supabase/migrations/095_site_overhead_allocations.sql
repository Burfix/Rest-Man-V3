-- =============================================================================
-- Migration 095: site_overhead_allocations — Per-Site Monthly Overhead Ledger
-- =============================================================================
--
-- Stores the monthly overhead cost allocation for each site, broken down by
-- cost bucket.  The profit intelligence engine reads this table to replace
-- the generic `profit_settings.daily_overhead_estimate` with real allocation
-- data for sites that have been configured.
--
-- When present, the engine computes period overhead as:
--   daily  = monthly_amount / days_in_month
--   period = daily × period_days
--
-- Unique constraint: one row per (site, cost_bucket, month).
-- The application seed populates Primi Camps Bay (migration 096).
--
-- RLS:
--   service_role — full CRUD (cron workers, seed scripts).
--   authenticated — SELECT only for accessible sites (any role).
-- =============================================================================

CREATE TABLE IF NOT EXISTS site_overhead_allocations (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  cost_bucket    TEXT          NOT NULL,
  annual_amount  NUMERIC(14,2) NOT NULL CHECK (annual_amount >= 0),

  -- Month reference
  month_number   INT           NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  month_name     TEXT          NOT NULL,

  -- Allocation amounts (daily/weekly are pre-computed approximations;
  -- the engine always derives from monthly_amount + actual calendar days)
  monthly_amount NUMERIC(14,2) NOT NULL CHECK (monthly_amount >= 0),
  daily_amount   NUMERIC(14,4) NOT NULL,   -- monthly_amount / nominal_days_in_month
  weekly_amount  NUMERIC(14,4) NOT NULL,   -- daily_amount * 7

  is_fixed       BOOLEAN       NOT NULL DEFAULT true,
  source         TEXT,                      -- free-text provenance note

  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_site_overhead_month UNIQUE (site_id, cost_bucket, month_number)
);

COMMENT ON TABLE  site_overhead_allocations IS 'Monthly overhead allocation per cost bucket per site. Used by Profit Intelligence.';
COMMENT ON COLUMN site_overhead_allocations.monthly_amount IS 'Definitive monthly amount — engine scales to period using actual calendar days.';
COMMENT ON COLUMN site_overhead_allocations.daily_amount   IS 'Pre-computed approximation (monthly / nominal days). Engine derives precisely.';

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION site_overhead_allocations_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_overhead_allocations_updated_at ON site_overhead_allocations;
CREATE TRIGGER site_overhead_allocations_updated_at
  BEFORE UPDATE ON site_overhead_allocations
  FOR EACH ROW EXECUTE FUNCTION site_overhead_allocations_set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary access pattern: engine looks up site + month
CREATE INDEX IF NOT EXISTS idx_overhead_alloc_site_month
  ON site_overhead_allocations (site_id, month_number);

-- Bucket drill-down
CREATE INDEX IF NOT EXISTS idx_overhead_alloc_site_bucket
  ON site_overhead_allocations (site_id, cost_bucket);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE site_overhead_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS overhead_alloc_service_role ON site_overhead_allocations;
CREATE POLICY overhead_alloc_service_role
  ON site_overhead_allocations
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS overhead_alloc_authenticated_read ON site_overhead_allocations;
CREATE POLICY overhead_alloc_authenticated_read
  ON site_overhead_allocations
  FOR SELECT
  TO authenticated
  USING (fs_user_can_access_site(site_id));
