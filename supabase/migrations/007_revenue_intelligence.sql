-- ============================================================
-- Ops Engine — Revenue Intelligence Engine
-- Migration: 007_revenue_intelligence.sql
--
-- sales_targets    : manager-set revenue / covers goals per date
-- forecast_snapshots: persisted forecast audit trail (optional cron use)
--
-- set_updated_at() trigger already exists from 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- TABLE: sales_targets
-- One revenue goal per calendar date per organisation.
-- ============================================================
create table if not exists sales_targets (
  id              uuid          primary key default gen_random_uuid(),
  organization_id uuid          not null,
  target_date     date          not null,
  target_sales    numeric(12,2),
  target_covers   numeric(8,2),
  notes           text,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),

  constraint uq_sales_target_org_date unique (organization_id, target_date)
);

create index if not exists idx_sales_targets_org_date
  on sales_targets (organization_id, target_date desc);

create or replace trigger trg_sales_targets_updated_at
  before update on sales_targets
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: forecast_snapshots
-- One persisted snapshot per org per forecast date.
-- Upsert semantics: re-running the forecast overwrites the row.
-- ============================================================
create table if not exists forecast_snapshots (
  id                   uuid          primary key default gen_random_uuid(),
  organization_id      uuid          not null,
  forecast_date        date          not null,

  -- Core metrics
  forecast_sales       numeric(12,2),
  forecast_covers      numeric(8,2),
  forecast_avg_spend   numeric(10,2),

  -- Target comparison
  target_sales         numeric(12,2),
  target_covers        numeric(8,2),
  sales_gap            numeric(12,2),
  covers_gap           numeric(8,2),

  -- Intelligence output
  confidence           text          not null default 'low',   -- low | medium | high
  risk_level           text          not null default 'low',   -- low | medium | high
  factors_json         jsonb,
  recommendations_json jsonb,

  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),

  constraint uq_forecast_snapshot_org_date unique (organization_id, forecast_date)
);

create index if not exists idx_forecast_snapshots_org_date
  on forecast_snapshots (organization_id, forecast_date desc);

create or replace trigger trg_forecast_snapshots_updated_at
  before update on forecast_snapshots
  for each row execute procedure set_updated_at();
