-- ============================================================
-- Ops Engine — Row Level Security Baseline
-- Migration: 009_rls_policies.sql
--
-- Enables RLS on every application table so that the public
-- (anon) Supabase key cannot read or write data directly.
--
-- Current policy: any authenticated Supabase user has full
-- CRUD access (single-tenant — one set of staff per project).
--
-- Multi-tenancy upgrade path:
--   Replace the "authenticated_all" policies below with
--   per-organisation policies that filter on organization_id,
--   e.g.: USING (organization_id = (current_setting('app.org_id'))::uuid)
-- ============================================================

-- ── Enable RLS ────────────────────────────────────────────────────────────────

alter table reservations              enable row level security;
alter table events                    enable row level security;
alter table venue_settings            enable row level security;
alter table sales_uploads             enable row level security;
alter table sales_items               enable row level security;
alter table reviews                   enable row level security;
alter table equipment                 enable row level security;
alter table maintenance_logs          enable row level security;
alter table daily_operations_reports  enable row level security;
alter table daily_operations_labor    enable row level security;
alter table daily_operations_revenue_centers enable row level security;
alter table historical_sales          enable row level security;
alter table sales_targets             enable row level security;
alter table forecast_snapshots        enable row level security;
alter table alerts                    enable row level security;

-- conversation_logs may exist; guard with DO block to avoid error if absent
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'conversation_logs') then
    execute 'alter table conversation_logs enable row level security';
  end if;
end $$;

-- ── Policies: authenticated users have full access (single-tenant) ────────────

create policy "authenticated_all" on reservations
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on events
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on venue_settings
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on sales_uploads
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on sales_items
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on reviews
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on equipment
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on maintenance_logs
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on daily_operations_reports
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on daily_operations_labor
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on daily_operations_revenue_centers
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on historical_sales
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on sales_targets
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on forecast_snapshots
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on alerts
  for all to authenticated using (true) with check (true);

do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'conversation_logs') then
    execute $pol$
      create policy "authenticated_all" on conversation_logs
        for all to authenticated using (true) with check (true)
    $pol$;
  end if;
end $$;
