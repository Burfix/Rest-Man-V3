-- ============================================================
-- GM Co-Pilot — Forecast & Guidance Engine
-- Migration: 030_gm_copilot_forecast.sql
--
-- Tables for storing forecast runs, hourly breakdowns,
-- recommendations, prep guidance, promo forecasts, and risk data.
-- ============================================================

-- ── 1. Forecast Runs ──────────────────────────────────────────────────────────

create table if not exists forecast_runs (
  id                    uuid        primary key default gen_random_uuid(),
  store_id              uuid        not null default '00000000-0000-0000-0000-000000000001',
  forecast_date         date        not null,
  generated_at          timestamptz not null default now(),
  sales_forecast_total  numeric,
  covers_forecast_total integer,
  labour_forecast_pct   numeric,
  risk_score            numeric,
  confidence_score      numeric,
  summary_json          jsonb,
  created_by_system     boolean     not null default true,

  constraint uq_forecast_run_date unique (store_id, forecast_date)
);

create index if not exists idx_forecast_runs_date
  on forecast_runs (forecast_date desc);

-- ── 2. Hourly Breakdown ──────────────────────────────────────────────────────

create table if not exists forecast_hourly_breakdown (
  id              uuid    primary key default gen_random_uuid(),
  forecast_run_id uuid    not null references forecast_runs(id) on delete cascade,
  hour_slot       integer not null check (hour_slot >= 0 and hour_slot <= 23),
  forecast_sales  numeric,
  forecast_covers integer,
  actual_sales    numeric,
  actual_covers   integer,
  variance_sales  numeric,
  variance_covers numeric,

  constraint uq_hourly_slot unique (forecast_run_id, hour_slot)
);

create index if not exists idx_forecast_hourly_run
  on forecast_hourly_breakdown (forecast_run_id);

-- ── 3. Recommendations ──────────────────────────────────────────────────────

create table if not exists forecast_recommendations (
  id                  uuid        primary key default gen_random_uuid(),
  forecast_run_id     uuid        not null references forecast_runs(id) on delete cascade,
  category            text        not null,
  priority            text        not null check (priority in ('low', 'medium', 'high', 'urgent')),
  title               text        not null,
  description         text        not null,
  operational_reason  text,
  expected_impact     text,
  status              text        not null default 'open' check (status in ('open', 'acknowledged', 'completed', 'dismissed')),
  created_at          timestamptz not null default now()
);

create index if not exists idx_forecast_recs_run
  on forecast_recommendations (forecast_run_id);

-- ── 4. Prep Forecasts ───────────────────────────────────────────────────────

create table if not exists prep_forecasts (
  id              uuid    primary key default gen_random_uuid(),
  forecast_run_id uuid    not null references forecast_runs(id) on delete cascade,
  item_name       text    not null,
  item_category   text,
  estimated_quantity numeric,
  unit            text,
  risk_level      text    check (risk_level in ('low', 'medium', 'high')),
  note            text
);

create index if not exists idx_prep_forecasts_run
  on prep_forecasts (forecast_run_id);

-- ── 5. Promo Forecasts ──────────────────────────────────────────────────────

create table if not exists promo_forecasts (
  id                          uuid    primary key default gen_random_uuid(),
  forecast_run_id             uuid    not null references forecast_runs(id) on delete cascade,
  promo_name                  text    not null,
  expected_sales_uplift_pct   numeric,
  expected_cover_uplift_pct   numeric,
  expected_margin_impact_pct  numeric,
  recommendation              text
);

create index if not exists idx_promo_forecasts_run
  on promo_forecasts (forecast_run_id);

-- ── 6. Forecast Risks ───────────────────────────────────────────────────────

create table if not exists forecast_risks (
  id                 uuid primary key default gen_random_uuid(),
  forecast_run_id    uuid not null references forecast_runs(id) on delete cascade,
  risk_type          text not null,
  severity           text not null check (severity in ('low', 'medium', 'high', 'critical')),
  title              text not null,
  description        text,
  recommended_action text
);

create index if not exists idx_forecast_risks_run
  on forecast_risks (forecast_run_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table forecast_runs              enable row level security;
alter table forecast_hourly_breakdown  enable row level security;
alter table forecast_recommendations   enable row level security;
alter table prep_forecasts             enable row level security;
alter table promo_forecasts            enable row level security;
alter table forecast_risks             enable row level security;

-- Service-role full access (matches existing pattern)
create policy "srole_forecast_runs"     on forecast_runs              for all to service_role using (true) with check (true);
create policy "srole_forecast_hourly"   on forecast_hourly_breakdown  for all to service_role using (true) with check (true);
create policy "srole_forecast_recs"     on forecast_recommendations   for all to service_role using (true) with check (true);
create policy "srole_prep_forecasts"    on prep_forecasts             for all to service_role using (true) with check (true);
create policy "srole_promo_forecasts"   on promo_forecasts            for all to service_role using (true) with check (true);
create policy "srole_forecast_risks"    on forecast_risks             for all to service_role using (true) with check (true);

-- Authenticated read access
create policy "auth_read_forecast_runs"    on forecast_runs              for select to authenticated using (true);
create policy "auth_read_forecast_hourly"  on forecast_hourly_breakdown  for select to authenticated using (true);
create policy "auth_read_forecast_recs"    on forecast_recommendations   for select to authenticated using (true);
create policy "auth_read_prep_forecasts"   on prep_forecasts             for select to authenticated using (true);
create policy "auth_read_promo_forecasts"  on promo_forecasts            for select to authenticated using (true);
create policy "auth_read_forecast_risks"   on forecast_risks             for select to authenticated using (true);
