-- ============================================================
-- Ops Engine — Risk Engine & Zone Heatmap Support
-- Migration: 013_risk_heatmap.sql
--
-- Adds tables to support:
--   1. risk_scores   — cached risk scores per zone + site
--   2. zone_snapshots — periodic heatmap state snapshots
--   3. asset_service_history — unified service/maintenance timeline
--
-- These are ADDITIVE and do not modify existing tables.
-- The service layer (services/universal/) populates them.
-- ============================================================

-- ── 1. risk_scores ────────────────────────────────────────────────────────────
-- Derived risk score cache per site / zone.
-- Recomputed by the risk engine on demand or via cron.
-- The dashboard reads from this cache for fast heatmap rendering.

create table if not exists risk_scores (
  id              uuid        primary key default gen_random_uuid(),
  site_id         uuid        not null references sites(id) on delete cascade,
  zone_id         uuid        references zones(id) on delete cascade,
                              -- NULL zone_id = site-level roll-up score

  -- Score components (0–100, higher = more risk)
  ticket_score        numeric(5,2) not null default 0,
                              -- weighted sum of open tickets by severity
  obligation_score    numeric(5,2) not null default 0,
                              -- weighted sum of overdue / due-soon obligations
  asset_score         numeric(5,2) not null default 0,
                              -- weighted sum of OOS / needs_attention assets
  event_conflict_score numeric(5,2) not null default 0,
                              -- risk bump when open critical tickets overlap active events

  -- Composite score and derived status
  composite_score     numeric(5,2) not null default 0,
  status              text        not null default 'green',
                              -- green | amber | red

  -- Snapshot context
  open_ticket_count   integer not null default 0,
  overdue_obligation_count integer not null default 0,
  oos_asset_count     integer not null default 0,
  active_event_count  integer not null default 0,

  computed_at         timestamptz not null default now(),

  -- One current score per site+zone combination
  unique (site_id, zone_id)
);

create index if not exists idx_risk_scores_site       on risk_scores (site_id, status);
create index if not exists idx_risk_scores_computed   on risk_scores (computed_at desc);
create index if not exists idx_risk_scores_site_zone  on risk_scores (site_id, zone_id);

alter table risk_scores enable row level security;
create policy "authenticated_all" on risk_scores
  for all to authenticated using (true) with check (true);

-- ── 2. zone_snapshots ─────────────────────────────────────────────────────────
-- Point-in-time heatmap snapshots stored for trend / audit.
-- Each call to the risk engine appends a row here.
-- The dashboard shows the latest row per zone.

create table if not exists zone_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  site_id         uuid        not null references sites(id) on delete cascade,
  zone_id         uuid        references zones(id) on delete set null,
  zone_name       text        not null,   -- denormalised for query convenience

  status          text        not null,   -- green | amber | red
  composite_score numeric(5,2) not null default 0,

  -- Top contributing factors (stored as free-text for display)
  primary_risk    text,                   -- e.g. "3 open urgent tickets"
  secondary_risk  text,                   -- e.g. "Fire certificate overdue"

  -- Raw counts at snapshot time
  ticket_count    integer not null default 0,
  obligation_count integer not null default 0,
  oos_count       integer not null default 0,

  snapped_at      timestamptz not null default now()
);

create index if not exists idx_zone_snap_site_time   on zone_snapshots (site_id, snapped_at desc);
create index if not exists idx_zone_snap_zone_time   on zone_snapshots (zone_id, snapped_at desc);
create index if not exists idx_zone_snap_status      on zone_snapshots (status, snapped_at desc);

alter table zone_snapshots enable row level security;
create policy "authenticated_all" on zone_snapshots
  for all to authenticated using (true) with check (true);

-- ── 3. asset_service_history ──────────────────────────────────────────────────
-- Unified service/maintenance event timeline per asset.
-- This is the universal form of equipment_repairs (which stores the data)
-- combined with maintenance_logs (which tracks the issue lifecycle).
--
-- MAPPING:
--   equipment_repairs rows → service_type = 'repair'
--   maintenance_logs (resolved) → service_type = 'fix'
--   (future) scheduled service  → service_type = 'service'
--   (future) inspection         → service_type = 'inspection'
--
-- equipment_repairs IS the primary store; this view/bridge table
-- provides a unified timeline query across all service event types
-- without duplicating insert logic.

create table if not exists asset_service_history (
  id              uuid        primary key default gen_random_uuid(),
  asset_id        uuid        not null references equipment(id) on delete cascade,
  site_id         uuid        not null references sites(id) on delete cascade,

  service_type    text        not null default 'repair',
                              -- repair | service | inspection | replacement | commissioning

  service_date    date        not null,
  description     text,
  performed_by    text,       -- person name or 'contractor'
  contractor_id   uuid        references contractors(id) on delete set null,

  cost            numeric(10,2),
  next_service_due date,

  document_url    text,       -- invoice / certificate URL

  -- Links back to source tables for backward compatibility
  equipment_repair_id  uuid  references equipment_repairs(id) on delete set null,
  maintenance_log_id   uuid  references maintenance_logs(id)  on delete set null,

  created_at      timestamptz not null default now()
);

create index if not exists idx_ash_asset_date   on asset_service_history (asset_id, service_date desc);
create index if not exists idx_ash_site_date    on asset_service_history (site_id, service_date desc);
create index if not exists idx_ash_contractor   on asset_service_history (contractor_id) where contractor_id is not null;
create index if not exists idx_ash_repair_link  on asset_service_history (equipment_repair_id) where equipment_repair_id is not null;
create index if not exists idx_ash_maint_link   on asset_service_history (maintenance_log_id) where maintenance_log_id is not null;

alter table asset_service_history enable row level security;
create policy "authenticated_all" on asset_service_history
  for all to authenticated using (true) with check (true);

-- Backfill: mirror existing equipment_repairs into asset_service_history
-- so the unified timeline works immediately without re-entering data.
insert into asset_service_history (
  asset_id, site_id, service_type, service_date,
  description, performed_by, cost, next_service_due,
  document_url, equipment_repair_id
)
select
  er.equipment_id,
  '00000000-0000-0000-0000-000000000001',
  'repair',
  er.repair_date,
  coalesce(er.work_done, er.issue_reported),
  coalesce(er.contractor_name, er.contractor_company),
  er.repair_cost,
  er.next_service_due,
  er.invoice_file_url,
  er.id
from equipment_repairs er
where not exists (
  select 1 from asset_service_history ash
  where ash.equipment_repair_id = er.id
);
