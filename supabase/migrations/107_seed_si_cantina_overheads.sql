-- =============================================================================
-- Migration 107: Seed — Si Cantina Sociale Monthly Overhead Allocations
-- =============================================================================
--
-- site_id: 00000000-0000-0000-0000-000000000001 (Si Cantina Sociale)
--
-- Annual cost estimates (2025/26 — set to conservative industry benchmarks
-- until the actual cost plan is loaded):
--
--   Admin Costs        : R  420,000.00  (~R35k/month)
--   Advertising        : R   60,000.00  (~R5k/month)
--   Operational Costs  : R  900,000.00  (~R75k/month — utilities, consumables, repairs)
--   Rent Paid          : R1,440,000.00  (~R120k/month — Cape Town CBD/Waterfront rate)
--   ─────────────────────────────────
--   Total annual       : R2,820,000.00  (~R235k/month → ~R7,580/day)
--
-- Monthly allocation is distributed evenly (1/12 per month) because we do not
-- yet have a seasonality-adjusted cost plan for Si Cantina.  When the actual
-- cost plan is available, update these rows via the site_overhead_allocations
-- upsert (ON CONFLICT DO UPDATE) or replace this migration.
--
-- Revenue context (from live MICROS data):
--   avg daily revenue ~R14,340  →  overhead ~52.8% of revenue
--   This is a fully-staffed Cape Town restaurant with service charge; the
--   overhead percentage is intentionally conservative until actual data lands.
--
-- IDEMPOTENT: ON CONFLICT (site_id, cost_bucket, month_number) DO UPDATE.
-- =============================================================================

DO $$
DECLARE
  v_site_id  UUID := '00000000-0000-0000-0000-000000000001';
  v_source   TEXT := 'Estimated 2025/26 cost plan (Si Cantina — update with actuals)';
BEGIN

INSERT INTO site_overhead_allocations (
  site_id, cost_bucket, annual_amount,
  month_number, month_name,
  monthly_amount, daily_amount, weekly_amount,
  is_fixed, source
)
WITH buckets(cost_bucket, annual_amount) AS (
  VALUES
    ('Admin Costs',        420000.00),
    ('Advertising',         60000.00),
    ('Operational Costs',  900000.00),
    ('Rent Paid',         1440000.00)
),
monthly_totals(month_number, month_name, nominal_days) AS (
  -- Even 1/12 distribution (no seasonal skew applied yet)
  VALUES
    (1,  'January',   31.00),
    (2,  'February',  28.25),
    (3,  'March',     31.00),
    (4,  'April',     30.00),
    (5,  'May',       31.00),
    (6,  'June',      30.00),
    (7,  'July',      31.00),
    (8,  'August',    31.00),
    (9,  'September', 30.00),
    (10, 'October',   31.00),
    (11, 'November',  30.00),
    (12, 'December',  31.00)
),
total_months AS (SELECT 12 AS n)
SELECT
  v_site_id                                                                AS site_id,
  b.cost_bucket,
  b.annual_amount,
  m.month_number,
  m.month_name,
  ROUND(b.annual_amount / tm.n, 2)                                        AS monthly_amount,
  ROUND(b.annual_amount / tm.n / m.nominal_days, 4)                       AS daily_amount,
  ROUND(b.annual_amount / tm.n / m.nominal_days * 7, 4)                   AS weekly_amount,
  true                                                                     AS is_fixed,
  v_source                                                                 AS source
FROM   buckets b
CROSS  JOIN monthly_totals m
CROSS  JOIN total_months   tm
ON CONFLICT (site_id, cost_bucket, month_number)
DO UPDATE SET
  annual_amount  = EXCLUDED.annual_amount,
  monthly_amount = EXCLUDED.monthly_amount,
  daily_amount   = EXCLUDED.daily_amount,
  weekly_amount  = EXCLUDED.weekly_amount,
  source         = EXCLUDED.source,
  updated_at     = now();

RAISE NOTICE 'Seeded % Si Cantina overhead rows', (
  SELECT COUNT(*) FROM site_overhead_allocations WHERE site_id = v_site_id
);

END $$;

-- ── Update profit_settings: zero out daily_overhead_estimate now that
--    the allocation table is populated (engine will use allocations instead)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE profit_settings
SET    daily_overhead_estimate = 0.00,
       updated_at              = now()
WHERE  site_id = '00000000-0000-0000-0000-000000000001';

-- ── Sanity check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_site_id UUID := '00000000-0000-0000-0000-000000000001';
  v_count   INT;
  v_annual  NUMERIC;
BEGIN
  SELECT COUNT(*), SUM(monthly_amount)
  INTO   v_count, v_annual
  FROM   site_overhead_allocations
  WHERE  site_id = v_site_id;

  RAISE NOTICE 'Si Cantina overhead rows: %, annual total: R%', v_count, ROUND(v_annual, 2);
END $$;
