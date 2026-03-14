-- ============================================================
-- Si Cantina Sociale — Daily Operations Report Tables
-- Migration: 004_daily_operations.sql
-- Adds: daily_operations_reports, daily_operations_labor,
--       daily_operations_revenue_centers
-- set_updated_at() trigger already exists from 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- TABLE: daily_operations_reports
-- One row per calendar day per organisation.
-- All monetary values are ex-VAT (Sales Net VAT basis).
-- ============================================================
create table if not exists daily_operations_reports (
  id                           uuid primary key default gen_random_uuid(),
  report_date                  date not null,
  source_file_name             text,

  -- top-line KPIs
  sales_net_vat                numeric(12,4),
  margin_percent               numeric(8,6),
  cogs_percent                 numeric(8,6),
  labor_cost_percent           numeric(8,6),
  guest_count                  numeric(8,2),
  check_count                  numeric(8,2),

  -- financial control
  gross_sales_before_discounts numeric(12,4),
  total_discounts              numeric(12,4),
  gross_sales_after_discounts  numeric(12,4),
  tax_collected                numeric(12,4),
  service_charges              numeric(12,4),
  non_revenue_total            numeric(12,4),

  -- cost / margin
  cost_of_goods_sold           numeric(12,4),
  labor_cost                   numeric(12,4),
  operating_margin             numeric(12,4),

  -- exceptions
  returns_count                numeric(8,2),
  returns_amount               numeric(12,4),
  voids_count                  numeric(8,2),
  voids_amount                 numeric(12,4),
  manager_voids_count          numeric(8,2),
  manager_voids_amount         numeric(12,4),
  error_corrects_count         numeric(8,2),
  error_corrects_amount        numeric(12,4),
  cancels_count                numeric(8,2),
  cancels_amount               numeric(12,4),

  -- service performance
  guests_average_spend         numeric(12,4),
  checks_average_spend         numeric(12,4),
  table_turns_count            numeric(8,2),
  table_turns_average_spend    numeric(12,4),
  average_dining_time_hours    numeric(8,6),

  -- tips & cash handling
  direct_charged_tips          numeric(12,4),
  direct_cash_tips             numeric(12,4),
  indirect_tips                numeric(12,4),
  total_tips                   numeric(12,4),
  tips_paid                    numeric(12,4),
  cash_in                      numeric(12,4),
  paid_in                      numeric(12,4),
  paid_out                     numeric(12,4),
  cash_due                     numeric(12,4),
  deposits                     numeric(12,4),
  over_short                   numeric(12,4),

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  -- one report per day — duplicates are rejected at the DB level
  constraint uq_daily_report_date unique (report_date)
);

create index if not exists idx_daily_reports_date
  on daily_operations_reports (report_date desc);

create or replace trigger trg_daily_reports_updated_at
  before update on daily_operations_reports
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: daily_operations_labor
-- One row per job code per daily report.
-- ============================================================
create table if not exists daily_operations_labor (
  id                uuid primary key default gen_random_uuid(),
  daily_report_id   uuid not null
    references daily_operations_reports(id) on delete cascade,
  job_code_name     text not null,
  regular_hours     numeric(8,2),
  overtime_hours    numeric(8,2),
  total_hours       numeric(8,2),
  regular_pay       numeric(12,4),
  overtime_pay      numeric(12,4),
  total_pay         numeric(12,4),
  labor_cost_percent numeric(8,6),
  created_at        timestamptz not null default now()
);

create index if not exists idx_daily_labor_report
  on daily_operations_labor (daily_report_id);

-- ============================================================
-- TABLE: daily_operations_revenue_centers
-- One row per revenue centre per daily report (Restaurant, Bar, etc.)
-- ============================================================
create table if not exists daily_operations_revenue_centers (
  id                           uuid primary key default gen_random_uuid(),
  daily_report_id              uuid not null
    references daily_operations_reports(id) on delete cascade,
  revenue_center_name          text not null,
  sales_net_vat                numeric(12,4),
  percent_of_total_sales       numeric(8,6),
  guests                       numeric(8,2),
  percent_of_total_guests      numeric(8,6),
  average_spend_per_guest      numeric(12,4),
  checks                       numeric(8,2),
  percent_of_total_checks      numeric(8,6),
  average_spend_per_check      numeric(12,4),
  table_turns                  numeric(8,2),
  percent_of_total_table_turns numeric(8,6),
  average_spend_per_table_turn numeric(12,4),
  average_turn_time            numeric(8,4),
  created_at                   timestamptz not null default now()
);

create index if not exists idx_daily_rev_centers_report
  on daily_operations_revenue_centers (daily_report_id);
