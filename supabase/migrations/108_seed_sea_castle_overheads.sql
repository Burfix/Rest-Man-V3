-- =============================================================================
-- Migration 108: Seed — Sea Castle Hotel Camps Bay Overhead Allocations
-- =============================================================================
--
-- site_id: 00000000-0000-0000-0000-000000000004 (Sea Castle Hotel Camps Bay)
--
-- Sea Castle is a hotel F&B outlet — its overhead structure differs from a
-- standalone restaurant.  Many costs (rent, building maintenance, utilities)
-- are absorbed by the hotel operation.  These figures reflect the F&B-specific
-- cost allocation only.
--
-- Annual cost estimates (2025/26 — set to conservative estimates until the
-- actual hotel F&B cost plan is loaded):
--
--   Admin Costs        : R   84,000.00  (~R7k/month — F&B admin share)
--   Advertising        : R   24,000.00  (~R2k/month — local F&B marketing)
--   Operational Costs  : R  264,000.00  (~R22k/month — consumables, F&B-specific ops)
--   Rent Paid          : R  240,000.00  (~R20k/month — F&B-attributed occupancy cost)
--   ─────────────────────────────────
--   Total annual       : R  612,000.00  (~R51k/month → ~R1,645/day)
--
-- Revenue context (from live MICROS data):
--   avg daily revenue ~R1,182/day  →  overhead ~R1,645/day > daily revenue
--   This is expected for a hotel F&B annex — the hotel's overall P&L absorbs
--   the operational shortfall; F&B is a guest-experience centre, not a
--   standalone profit centre.  Overhead shown in dashboard is informational.
--
-- IDEMPOTENT: ON CONFLICT (site_id, cost_bucket, month_number) DO UPDATE.
-- =============================================================================

DO $$
DECLARE
  v_site_id  UUID := '00000000-0000-0000-0000-000000000004';
  v_source   TEXT := 'Estimated 2025/26 F&B cost allocation (Sea Castle — update with actuals)';
BEGIN

INSERT INTO site_overhead_allocations (
  site_id, cost_bucket, annual_amount,
  month_number, month_name,
  monthly_amount, daily_amount, weekly_amount,
  is_fixed, source
)
WITH buckets(cost_bucket, annual_amount) AS (
  VALUES
    ('Admin Costs',        84000.00),
    ('Advertising',        24000.00),
    ('Operational Costs', 264000.00),
    ('Rent Paid',         240000.00)
),
monthly_totals(month_number, month_name, nominal_days) AS (
  -- Even 1/12 distribution — update with seasonality when hotel cost plan available
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

RAISE NOTICE 'Seeded % Sea Castle overhead rows', (
  SELECT COUNT(*) FROM site_overhead_allocations WHERE site_id = v_site_id
);

END $$;

-- ── Update profit_settings: zero out daily_overhead_estimate now that
--    the allocation table is populated (engine will use allocations instead)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE profit_settings
SET    daily_overhead_estimate = 0.00,
       updated_at              = now()
WHERE  site_id = '00000000-0000-0000-0000-000000000004';

-- ── Sanity check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_site_id UUID := '00000000-0000-0000-0000-000000000004';
  v_count   INT;
  v_annual  NUMERIC;
BEGIN
  SELECT COUNT(*), SUM(monthly_amount)
  INTO   v_count, v_annual
  FROM   site_overhead_allocations
  WHERE  site_id = v_site_id;

  RAISE NOTICE 'Sea Castle overhead rows: %, annual total: R%', v_count, ROUND(v_annual, 2);
END $$;
