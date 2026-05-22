-- =============================================================================
-- Migration 096: Seed — Primi Camps Bay Monthly Overhead Allocations
-- =============================================================================
--
-- Populates site_overhead_allocations for Primi Camps Bay
-- (site_id = 00000000-0000-0000-0000-000000000003).
--
-- Five cost buckets with their annual amounts (2025/26 cost plan):
--   Admin Costs        : R  535,000.00
--   Advertising        : R   75,000.00
--   Operational Costs  : R1,150,000.00
--   Franchising Costs  : R  487,380.84
--   Rent Paid          : R1,070,000.00
--   ─────────────────────────────────
--   Total annual       : R3,317,380.84
--
-- Monthly totals from spreadsheet (sum of all 5 buckets):
--   Jan R380,554.14  Feb R342,202.08  Mar R259,055.59  Apr R267,383.64
--   May R241,140.15  Jun R233,639.26  Jul R238,605.00  Aug R232,387.03
--   Sep R240,755.62  Oct R260,800.12  Nov R228,968.51  Dec R391,888.47
--
-- Each bucket's monthly_amount is derived by:
--   bucket_monthly = bucket_annual × (month_total / total_annual)
-- This guarantees:
--   ∑ per month = given monthly total  (up to R0.01 rounding)
--   ∑ per bucket over 12 months = bucket_annual  (up to R0.01 rounding)
--
-- daily_amount  = monthly_amount / nominal_days_in_month
-- weekly_amount = daily_amount × 7
-- nominal days: 31/28.25/31/30/31/30/31/31/30/31/30/31
--
-- IDEMPOTENT: ON CONFLICT ... DO UPDATE replaces values on re-run.
-- =============================================================================

DO $$
DECLARE
  v_site_id  UUID := '00000000-0000-0000-0000-000000000003';
  v_source   TEXT := 'Annual cost plan 2025/26';
BEGIN

-- ─────────────────────────────────────────────────────────────────────────────
-- CTE-driven insert: proportional bucket × month allocation
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO site_overhead_allocations (
  site_id, cost_bucket, annual_amount,
  month_number, month_name,
  monthly_amount, daily_amount, weekly_amount,
  is_fixed, source
)
WITH buckets(cost_bucket, annual_amount) AS (
  VALUES
    ('Admin Costs',       535000.00),
    ('Advertising',        75000.00),
    ('Operational Costs', 1150000.00),
    ('Franchising Costs',  487380.84),
    ('Rent Paid',         1070000.00)
),
monthly_totals(month_number, month_name, month_total, nominal_days) AS (
  VALUES
    (1,  'January',    380554.14, 31.00),
    (2,  'February',   342202.08, 28.25),
    (3,  'March',      259055.59, 31.00),
    (4,  'April',      267383.64, 30.00),
    (5,  'May',        241140.15, 31.00),
    (6,  'June',       233639.26, 30.00),
    (7,  'July',       238605.00, 31.00),
    (8,  'August',     232387.03, 31.00),
    (9,  'September',  240755.62, 30.00),
    (10, 'October',    260800.12, 31.00),
    (11, 'November',   228968.51, 30.00),
    (12, 'December',   391888.47, 31.00)
),
total_annual AS (
  SELECT SUM(annual_amount) AS total FROM buckets
)
SELECT
  v_site_id                                                                    AS site_id,
  b.cost_bucket,
  b.annual_amount,
  m.month_number,
  m.month_name,
  ROUND(b.annual_amount * m.month_total / ta.total, 2)                        AS monthly_amount,
  ROUND(b.annual_amount * m.month_total / ta.total / m.nominal_days, 4)       AS daily_amount,
  ROUND(b.annual_amount * m.month_total / ta.total / m.nominal_days * 7, 4)   AS weekly_amount,
  true                                                                          AS is_fixed,
  v_source                                                                      AS source
FROM   buckets        b
CROSS  JOIN monthly_totals m
CROSS  JOIN total_annual   ta
ON CONFLICT (site_id, cost_bucket, month_number)
DO UPDATE SET
  annual_amount  = EXCLUDED.annual_amount,
  monthly_amount = EXCLUDED.monthly_amount,
  daily_amount   = EXCLUDED.daily_amount,
  weekly_amount  = EXCLUDED.weekly_amount,
  source         = EXCLUDED.source,
  updated_at     = now();

RAISE NOTICE 'Seeded % Primi Camps Bay overhead rows', (
  SELECT COUNT(*) FROM site_overhead_allocations WHERE site_id = v_site_id
);

END $$;

-- ── Sanity check query (informational only — does not fail migration) ─────────
-- Expected: 60 rows (5 buckets × 12 months)
-- Expected monthly totals should match the spreadsheet values within R0.05
DO $$
DECLARE
  v_site_id UUID := '00000000-0000-0000-0000-000000000003';
  v_count   INT;
  v_annual  NUMERIC;
BEGIN
  SELECT COUNT(*), SUM(monthly_amount)
  INTO   v_count, v_annual
  FROM   site_overhead_allocations
  WHERE  site_id = v_site_id;

  RAISE NOTICE 'Overhead rows: %, annual total: R%', v_count, ROUND(v_annual, 2);
END $$;
