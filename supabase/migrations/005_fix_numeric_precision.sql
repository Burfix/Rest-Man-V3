-- ============================================================
-- Si Cantina Sociale — Fix numeric precision on ops tables
-- Migration: 005_fix_numeric_precision.sql
--
-- numeric(8,6) only allows 2 digits before the decimal point
-- (max 99.999999), causing overflow when percentages hit 100
-- or when a misaligned column receives a currency-sized value.
-- Widen all affected columns to numeric(12,6).
-- ============================================================

-- daily_operations_reports
alter table daily_operations_reports
  alter column margin_percent            type numeric(12,6),
  alter column cogs_percent              type numeric(12,6),
  alter column labor_cost_percent        type numeric(12,6),
  alter column average_dining_time_hours type numeric(12,6);

-- daily_operations_labor
alter table daily_operations_labor
  alter column labor_cost_percent type numeric(12,6);

-- daily_operations_revenue_centers
alter table daily_operations_revenue_centers
  alter column percent_of_total_sales       type numeric(12,6),
  alter column percent_of_total_guests      type numeric(12,6),
  alter column percent_of_total_checks      type numeric(12,6),
  alter column percent_of_total_table_turns type numeric(12,6);
