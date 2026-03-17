-- ============================================================
-- Maintenance Intelligence Engine
-- Migration: 014_maintenance_intelligence.sql
--
-- Extends maintenance_logs with full operational telemetry:
--   impact classification, who fixed it, fix timing,
--   costs, root cause, follow-up tracking.
--
-- All new columns are nullable or have safe defaults so
-- existing rows require no backfill.
-- ============================================================

alter table maintenance_logs
  add column if not exists impact_level        text          not null default 'none',
  add column if not exists date_acknowledged   date,
  add column if not exists date_fixed          date,
  add column if not exists reported_by         text,
  add column if not exists fixed_by            text,
  add column if not exists fixed_by_type       text,         -- contractor | internal_staff | supplier | unknown
  add column if not exists contractor_name     text,
  add column if not exists contractor_contact  text,
  add column if not exists downtime_minutes    integer,
  add column if not exists estimated_cost      numeric(10,2),
  add column if not exists actual_cost         numeric(10,2),
  add column if not exists resolution_notes    text,
  add column if not exists root_cause          text,
  add column if not exists follow_up_required  boolean       not null default false,
  add column if not exists follow_up_notes     text;

-- ── Indexes for intelligence queries ──────────────────────────────────────

create index if not exists idx_maint_impact      on maintenance_logs (impact_level);
create index if not exists idx_maint_date_fixed  on maintenance_logs (date_fixed desc);
create index if not exists idx_maint_fixed_by    on maintenance_logs (fixed_by);
create index if not exists idx_maint_contractor  on maintenance_logs (contractor_name);
create index if not exists idx_maint_actual_cost on maintenance_logs (actual_cost)
  where actual_cost is not null;

-- ── check constraint for impact_level ─────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_maint_impact_level'
  ) then
    alter table maintenance_logs
      add constraint chk_maint_impact_level
      check (impact_level in (
        'none','minor','service_disruption',
        'revenue_loss','compliance_risk','food_safety_risk'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_maint_fixed_by_type'
  ) then
    alter table maintenance_logs
      add constraint chk_maint_fixed_by_type
      check (fixed_by_type in (
        'contractor','internal_staff','supplier','unknown'
      ) or fixed_by_type is null);
  end if;
end $$;
