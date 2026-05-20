-- ============================================================
-- Ops Engine — Compliance Hub
-- Migration: 010_compliance.sql
--
-- Tracks regulatory & legal compliance categories:
--   fire certificates, health inspections, pest control,
--   equipment servicing, liquor licence, and custom items.
--
-- Status is computed on the fly from next_due_date, but a
-- denormalised `status` column is stored for indexed queries.
-- ============================================================

-- ── Core compliance items ─────────────────────────────────────────────────────

create table if not exists compliance_items (
  id                    uuid        primary key default gen_random_uuid(),
  category              text        not null,
  display_name          text        not null,
  description           text,
  status                text        not null default 'unknown'
                          check (status in ('compliant', 'due_soon', 'expired', 'unknown')),
  last_inspection_date  date,
  next_due_date         date,
  responsible_party     text,
  notes                 text,
  is_default            boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── Supporting documents / certificates ──────────────────────────────────────

create table if not exists compliance_documents (
  id          uuid        primary key default gen_random_uuid(),
  item_id     uuid        not null references compliance_items (id) on delete cascade,
  file_name   text        not null,
  file_url    text        not null,
  file_size   bigint,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists idx_compliance_status
  on compliance_items (status, next_due_date);

create index if not exists idx_compliance_due
  on compliance_items (next_due_date)
  where next_due_date is not null;

create index if not exists idx_compliance_docs_item
  on compliance_documents (item_id, uploaded_at desc);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

create or replace function update_compliance_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_compliance_updated_at on compliance_items;
create trigger trg_compliance_updated_at
  before update on compliance_items
  for each row execute function update_compliance_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table compliance_items      enable row level security;
alter table compliance_documents  enable row level security;

drop policy if exists "authenticated_all" on compliance_items;
create policy "authenticated_all" on compliance_items
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on compliance_documents;
create policy "authenticated_all" on compliance_documents
  for all to authenticated using (true) with check (true);

-- ── Default compliance categories ────────────────────────────────────────────
-- Pre-seed the standard regulatory categories for a Cape Town restaurant.
-- Staff will fill in dates and upload certificates; we just provide the structure.

insert into compliance_items
  (category, display_name, description, status, is_default)
values
  (
    'fire_certificate',
    'Fire Safety Certificate',
    'Certificate of Compliance issued after fire authority inspection. Required annually by the City of Cape Town Fire and Rescue Service. Covers extinguishers, exits, sprinkler systems, and evacuation plans.',
    'unknown',
    true
  ),
  (
    'health_inspection',
    'Health & Hygiene Inspection',
    'Annual inspection by the Environmental Health Practitioner (EHP) under the City of Cape Town Expanded Environmental Health Directorate. Covers food storage, kitchen hygiene, and waste management.',
    'unknown',
    true
  ),
  (
    'pest_control',
    'Pest Control',
    'Professional pest control treatment and Pest Control Certificate of Service. Regulations require quarterly treatments for food service establishments.',
    'unknown',
    true
  ),
  (
    'equipment_servicing',
    'Kitchen Equipment Servicing',
    'Annual service and calibration of commercial kitchen equipment: ovens, fryers, refrigeration units, dishwashers. Includes gas safety check.',
    'unknown',
    true
  ),
  (
    'liquor_licence',
    'Liquor Licence',
    'Western Cape liquor licence issued under the Western Cape Liquor Act. Renewal is required annually through the Western Cape Liquor Authority (WCLA).',
    'unknown',
    true
  ),
  (
    'food_safety_training',
    'Food Safety Training (Staff)',
    'All food-handling staff must hold a valid Food Safety certificate. Covers HACCP principles, allergen awareness, and personal hygiene. Typically valid for 3 years.',
    'unknown',
    true
  ),
  (
    'electrical_compliance',
    'Certificate of Compliance (Electrical)',
    'Electrical COC issued by a registered electrician under SANS 10142-1. Required when changes are made to electrical installations and for insurance purposes.',
    'unknown',
    true
  ),
  (
    'business_licence',
    'Business Operating Licence',
    'City of Cape Town Business Licence for a food service/entertainment establishment. Renewed annually.',
    'unknown',
    true
  )
on conflict do nothing;
-- ============================================================
-- Ops Engine — Asset Maintenance History
-- Migration: 011_maintenance_history.sql
--
-- Extends the equipment table with asset profile fields.
-- Adds equipment_repairs table for full repair history.
-- ============================================================

-- ── Extend equipment with asset profile fields ─────────────────────────────

alter table equipment
  add column if not exists purchase_date    date,
  add column if not exists warranty_expiry  date,
  add column if not exists supplier         text,
  add column if not exists serial_number    text;

-- ── equipment_repairs ─────────────────────────────────────────────────────

create table if not exists equipment_repairs (
  id                  uuid          primary key default gen_random_uuid(),
  equipment_id        uuid          not null references equipment(id) on delete cascade,

  repair_date         date          not null,
  contractor_name     text,
  contractor_company  text,
  contractor_phone    text,

  issue_reported      text,
  work_done           text,

  repair_cost         numeric(10,2),

  next_service_due    date,

  invoice_file_url    text,

  created_at          timestamptz   not null default now()
);

create index if not exists idx_equipment_repairs_equipment_id
  on equipment_repairs (equipment_id, repair_date desc);

-- ── RLS ───────────────────────────────────────────────────────────────────

alter table equipment_repairs enable row level security;

drop policy if exists "authenticated_all" on equipment_repairs;
create policy "authenticated_all" on equipment_repairs
  for all to authenticated using (true) with check (true);
-- ============================================================
-- Ops Engine — Universal Operational Data Model
-- Migration: 012_universal_model.sql
--
-- ARCHITECTURE GOAL
-- -----------------
-- Introduce a scalable, industry-agnostic operational model
-- alongside the existing restaurant schema WITHOUT removing
-- or breaking any existing tables or functionality.
--
-- This is a purely ADDITIVE migration. Every new table is
-- independent of the existing schema unless explicitly noted.
--
-- MAPPING: Restaurant → Universal
-- --------------------------------
--   equipment          → assets          (existing table is the asset registry)
--   maintenance_logs   → tickets         (issues, incidents, escalations)
--   compliance_items   → obligations     (recurring checks, certs, inspections)
--   reservations       → events          (time-bound guest-facing activities)
--   events (venue)     → events          (time-bound operational activities)
--   reviews/escalations→ tickets         (reputational / service incidents)
--   (no equivalent)    → sites           (NEW — top-level location)
--   equipment.location → zones           (NEW — sub-areas within a site)
--   compliance_docs    → documents       (existing via compliance_documents)
--   equipment_repairs  → documents +     (existing — repair records)
--                        contractors     (NEW — contractor registry)
--   (no equivalent)    → workflow_logs   (NEW — audit trail for all entities)
--   (no equivalent)    → risk_scores     (NEW — derived risk cache)
-- ============================================================

-- ── 1. sites ──────────────────────────────────────────────────────────────────
-- One row per physical operating location.
-- The default site is seeded below. Future: airports, malls, etc.

create table if not exists sites (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  site_type     text        not null default 'restaurant',
                              -- restaurant | airport | mall | hotel | petrol_station | office | other
  address       text,
  city          text,
  country       text        not null default 'ZA',
  timezone      text        not null default 'Africa/Johannesburg',
  is_active     boolean     not null default true,
  metadata_json jsonb       not null default '{}',
                              -- catch-all for site-type-specific config
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_sites_active on sites (is_active);

create or replace trigger trg_sites_updated_at
  before update on sites
  for each row execute procedure set_updated_at();

-- Seed the default site
insert into sites (id, name, site_type, address, city, timezone)
values (
  '00000000-0000-0000-0000-000000000001',
  'Si Cantina Sociale',
  'restaurant',
  'Silo District, V&A Waterfront',
  'Cape Town',
  'Africa/Johannesburg'
)
on conflict (id) do nothing;

-- ── 2. zones ──────────────────────────────────────────────────────────────────
-- Sub-areas within a site. Maps to equipment.location / areas of responsibility.
-- Used for heatmap visualisation and risk aggregation.

create table if not exists zones (
  id            uuid        primary key default gen_random_uuid(),
  site_id       uuid        not null references sites(id) on delete cascade,
  name          text        not null,
  zone_type     text        not null default 'general',
                              -- kitchen | bar | dining_room | terrace | bathrooms
                              -- entrance | storage | office | general
  description   text,
  display_order integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (site_id, name)
);

create index if not exists idx_zones_site on zones (site_id, display_order);

create or replace trigger trg_zones_updated_at
  before update on zones
  for each row execute procedure set_updated_at();

-- Seed the standard zones for the default site
insert into zones (site_id, name, zone_type, display_order) values
  ('00000000-0000-0000-0000-000000000001', 'Kitchen',      'kitchen',      1),
  ('00000000-0000-0000-0000-000000000001', 'Bar',          'bar',          2),
  ('00000000-0000-0000-0000-000000000001', 'Dining Room',  'dining_room',  3),
  ('00000000-0000-0000-0000-000000000001', 'Terrace',      'terrace',      4),
  ('00000000-0000-0000-0000-000000000001', 'Bathrooms',    'bathrooms',    5),
  ('00000000-0000-0000-0000-000000000001', 'Entrance',     'entrance',     6),
  ('00000000-0000-0000-0000-000000000001', 'Storage',      'storage',      7),
  ('00000000-0000-0000-0000-000000000001', 'Office',       'office',       8)
on conflict (site_id, name) do nothing;

-- ── 3. assets (extend equipment with universal site/zone linkage) ─────────────
-- The existing `equipment` table IS the asset registry.
-- We add site_id and zone_id foreign keys to it additively.
-- Existing rows will have null site_id/zone_id until backfilled.

alter table equipment
  add column if not exists site_id  uuid references sites(id) on delete set null,
  add column if not exists zone_id  uuid references zones(id) on delete set null,
  add column if not exists asset_type text not null default 'equipment';
                              -- equipment | vehicle | fixture | system | infrastructure

create index if not exists idx_equipment_site on equipment (site_id);
create index if not exists idx_equipment_zone on equipment (zone_id);

-- Backfill: link all existing equipment to the default site
update equipment
set site_id = '00000000-0000-0000-0000-000000000001'
where site_id is null;

-- ── 4. contractors ─────────────────────────────────────────────────────────────
-- Shared contractor registry across all sites.
-- Replaces ad-hoc text fields in equipment_repairs.

create table if not exists contractors (
  id              uuid        primary key default gen_random_uuid(),
  company_name    text        not null,
  contact_name    text,
  phone           text,
  email           text,
  specialisation  text[],               -- ['refrigeration', 'electrical', 'plumbing', ...]
  is_preferred    boolean     not null default false,
  is_active       boolean     not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_contractors_active on contractors (is_active, is_preferred desc);

create or replace trigger trg_contractors_updated_at
  before update on contractors
  for each row execute procedure set_updated_at();

-- ── 5. obligations ─────────────────────────────────────────────────────────────
-- Universal form of compliance_items and recurring daily checks.
-- compliance_items is the restaurant surface; obligations is the engine layer.
-- Initially a thin view / FK bridge to avoid duplicating data.
--
-- MAPPING:
--   compliance_items.category  → obligation_type = 'compliance'
--   daily ops checks           → obligation_type = 'operational'
--   equipment service due      → obligation_type = 'maintenance'
--   (future) health & safety   → obligation_type = 'safety'
--
-- For Phase 1, obligations acts as a superset registry that can link to
-- existing compliance_items rows for backward compatibility.

create table if not exists obligations (
  id                    uuid        primary key default gen_random_uuid(),
  site_id               uuid        not null references sites(id) on delete cascade,
  zone_id               uuid        references zones(id) on delete set null,
  asset_id              uuid        references equipment(id) on delete set null,

  -- Restaurant UI label (keeps existing terminology visible)
  label                 text        not null,
                                      -- e.g. "Fire Safety Certificate", "Kitchen Deep Clean"

  obligation_type       text        not null default 'compliance',
                                      -- compliance | maintenance | operational | safety | audit

  -- Link to existing compliance_items for obligations already tracked there
  compliance_item_id    uuid        references compliance_items(id) on delete set null,

  recurrence            text        not null default 'annual',
                                      -- daily | weekly | monthly | quarterly | annual | once | ad_hoc

  status                text        not null default 'unknown',
                                      -- compliant | due_soon | overdue | unknown

  last_completed_at     date,
  next_due_at           date,

  responsible_party     text,
  priority              text        not null default 'medium',
                                      -- critical | high | medium | low

  notes                 text,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_obligations_site        on obligations (site_id, status);
create index if not exists idx_obligations_due         on obligations (next_due_at) where next_due_at is not null;
create index if not exists idx_obligations_zone        on obligations (zone_id) where zone_id is not null;
create index if not exists idx_obligations_asset       on obligations (asset_id) where asset_id is not null;
create index if not exists idx_obligations_compliance  on obligations (compliance_item_id) where compliance_item_id is not null;

alter table obligations enable row level security;
drop policy if exists "authenticated_all" on obligations;
create policy "authenticated_all" on obligations
  for all to authenticated using (true) with check (true);

create or replace trigger trg_obligations_updated_at
  before update on obligations
  for each row execute procedure set_updated_at();

-- Backfill: create obligation rows for all existing compliance_items
-- so both surfaces stay in sync. The compliance page reads compliance_items
-- directly; the universal engine reads obligations.
insert into obligations (
  site_id, label, obligation_type, compliance_item_id,
  recurrence, status, last_completed_at, next_due_at,
  responsible_party, notes
)
select
  '00000000-0000-0000-0000-000000000001',
  ci.display_name,
  'compliance',
  ci.id,
  case ci.category
    when 'pest_control'          then 'quarterly'
    when 'food_safety_training'  then 'annual'
    else 'annual'
  end,
  ci.status,
  ci.last_inspection_date,
  ci.next_due_date,
  ci.responsible_party,
  ci.notes
from compliance_items ci
where not exists (
  select 1 from obligations o where o.compliance_item_id = ci.id
);

-- ── 6. tickets ────────────────────────────────────────────────────────────────
-- Universal incident / issue tracker.
--
-- MAPPING (restaurant layer → universal ticket):
--   maintenance_logs  → ticket_type = 'maintenance'
--   escalations       → ticket_type = 'escalation'
--   flagged reviews   → ticket_type = 'reputation'
--   alerts (critical) → ticket_type = 'operational'
--
-- maintenance_logs IS the source of truth for maintenance tickets.
-- We add a link column so the universal layer can query across types.

alter table maintenance_logs
  add column if not exists site_id    uuid references sites(id) on delete set null,
  add column if not exists zone_id    uuid references zones(id) on delete set null,
  add column if not exists ticket_type text not null default 'maintenance';
                              -- maintenance | escalation | reputation | operational | safety

create index if not exists idx_maint_site on maintenance_logs (site_id);
create index if not exists idx_maint_zone on maintenance_logs (zone_id);
create index if not exists idx_maint_type on maintenance_logs (ticket_type);

-- Backfill: link all maintenance tickets to the default site
update maintenance_logs
set site_id = '00000000-0000-0000-0000-000000000001'
where site_id is null;

-- ── 7. documents ─────────────────────────────────────────────────────────────
-- Universal document / evidence registry.
--
-- MAPPING:
--   compliance_documents  → document_type = 'certificate'
--   equipment_repairs.invoice_file_url → document_type = 'invoice'
--   (future) photos       → document_type = 'photo'
--
-- The compliance_documents table continues to function as-is.
-- documents is the cross-entity registry that can link to anything.

create table if not exists documents (
  id              uuid        primary key default gen_random_uuid(),
  site_id         uuid        not null references sites(id) on delete cascade,

  document_type   text        not null default 'general',
                                -- certificate | invoice | photo | report | audit | general

  -- Polymorphic entity linkage (at most one should be non-null)
  obligation_id   uuid        references obligations(id)        on delete set null,
  asset_id        uuid        references equipment(id)          on delete set null,
  ticket_id       uuid        references maintenance_logs(id)   on delete set null,
  -- Also bridgeable to compliance_documents for legacy UI compatibility
  compliance_doc_id uuid      references compliance_documents(id) on delete set null,

  file_name       text        not null,
  file_url        text        not null,
  file_size       bigint,
  uploaded_by     text,
  notes           text,
  valid_from      date,
  valid_until     date,
  created_at      timestamptz not null default now()
);

create index if not exists idx_documents_site       on documents (site_id, document_type);
create index if not exists idx_documents_obligation on documents (obligation_id) where obligation_id is not null;
create index if not exists idx_documents_asset      on documents (asset_id)     where asset_id     is not null;
create index if not exists idx_documents_ticket     on documents (ticket_id)    where ticket_id    is not null;

alter table documents enable row level security;
drop policy if exists "authenticated_all" on documents;
create policy "authenticated_all" on documents
  for all to authenticated using (true) with check (true);

-- ── 8. workflow_logs ─────────────────────────────────────────────────────────
-- Lightweight audit trail for any entity state change.
-- Replaces ad-hoc console.log / no-audit for critical operations.

create table if not exists workflow_logs (
  id            uuid        primary key default gen_random_uuid(),
  site_id       uuid        references sites(id) on delete set null,

  -- What changed
  entity_type   text        not null,
                              -- reservation | maintenance_log | obligation | equipment
                              -- compliance_item | alert | document | ticket
  entity_id     uuid        not null,

  action        text        not null,
                              -- created | updated | status_changed | resolved
                              -- reminder_sent | confirmed | cancelled | escalated

  -- Before / after state (for status changes, diff objects, etc.)
  from_value    text,
  to_value      text,

  -- Who / what triggered it
  triggered_by  text,         -- user_id | 'system' | 'whatsapp' | 'cron'
  channel       text,         -- whatsapp | dashboard | api | system

  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_workflow_entity    on workflow_logs (entity_type, entity_id, created_at desc);
create index if not exists idx_workflow_site_date on workflow_logs (site_id, created_at desc);
create index if not exists idx_workflow_action    on workflow_logs (action, created_at desc);

alter table workflow_logs enable row level security;
drop policy if exists "authenticated_all" on workflow_logs;
create policy "authenticated_all" on workflow_logs
  for all to authenticated using (true) with check (true);

-- ── 9. RLS for new site/zone/contractor tables ────────────────────────────────

alter table sites       enable row level security;
alter table zones       enable row level security;
alter table contractors enable row level security;

drop policy if exists "authenticated_all" on sites;
create policy "authenticated_all" on sites
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on zones;
create policy "authenticated_all" on zones
  for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all" on contractors;
create policy "authenticated_all" on contractors
  for all to authenticated using (true) with check (true);
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
drop policy if exists "authenticated_all" on risk_scores;
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
drop policy if exists "authenticated_all" on zone_snapshots;
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
drop policy if exists "authenticated_all" on asset_service_history;
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
-- ============================================================
-- 015 — Oracle MICROS BI Integration
-- Normalized tables for connection config, sync audit, and
-- all operational data fetched from the MICROS BI API.
-- Credentials are server-side only; access_token is cached
-- in this table and never returned to client layers.
-- ============================================================

-- ── Connection config ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name           text NOT NULL DEFAULT 'Pilot Store',
  loc_ref                 text NOT NULL DEFAULT '',        -- MICROS locRef for this store
  auth_server_url         text NOT NULL DEFAULT '',        -- Oracle IDCS / auth endpoint base
  app_server_url          text NOT NULL DEFAULT '',        -- MICROS BI app server base URL
  client_id               text NOT NULL DEFAULT '',        -- OAuth client id
  org_identifier          text NOT NULL DEFAULT '',        -- Oracle org / tenant identifier

  -- Token cache — server-side only, never returned to client
  access_token            text,
  token_expires_at        timestamptz,

  -- Sync state
  status                  text NOT NULL DEFAULT 'awaiting_setup'
    CHECK (status IN ('awaiting_setup', 'connected', 'syncing', 'stale', 'error')),
  last_sync_at            timestamptz,
  last_sync_error         text,
  last_successful_sync_at timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── Sync run audit log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  sync_type        text NOT NULL
    CHECK (sync_type IN ('daily_totals', 'intervals', 'guest_checks', 'labor', 'full')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  status           text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error', 'partial')),
  records_fetched  integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  error_message    text,
  metadata         jsonb NOT NULL DEFAULT '{}'
);

-- ── Normalized daily sales totals ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sales_daily (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref         text NOT NULL,
  business_date   date NOT NULL,

  -- Revenue
  net_sales       numeric(14, 2) NOT NULL DEFAULT 0,
  gross_sales     numeric(14, 2) NOT NULL DEFAULT 0,
  tax_collected   numeric(14, 2) NOT NULL DEFAULT 0,
  service_charges numeric(14, 2) NOT NULL DEFAULT 0,
  discounts       numeric(14, 2) NOT NULL DEFAULT 0,
  voids           numeric(14, 2) NOT NULL DEFAULT 0,
  returns         numeric(14, 2) NOT NULL DEFAULT 0,

  -- Traffic
  check_count     integer NOT NULL DEFAULT 0,
  guest_count     integer NOT NULL DEFAULT 0,
  avg_check_value numeric(10, 2) NOT NULL DEFAULT 0,
  avg_guest_spend numeric(10, 2) NOT NULL DEFAULT 0,

  -- Labour
  labor_cost      numeric(14, 2) NOT NULL DEFAULT 0,
  labor_pct       numeric(6, 2)  NOT NULL DEFAULT 0,

  synced_at       timestamptz NOT NULL DEFAULT now(),
  raw_response    jsonb,

  UNIQUE (connection_id, loc_ref, business_date)
);

-- ── Quarter-hour sales intervals ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sales_intervals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref        text NOT NULL,
  business_date  date NOT NULL,
  interval_start time NOT NULL,
  interval_end   time NOT NULL,
  net_sales      numeric(10, 2) NOT NULL DEFAULT 0,
  check_count    integer NOT NULL DEFAULT 0,
  guest_count    integer NOT NULL DEFAULT 0,
  synced_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, loc_ref, business_date, interval_start)
);

-- ── Guest checks ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_guest_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref        text NOT NULL,
  check_number   text NOT NULL,
  business_date  date NOT NULL,
  opened_at      timestamptz,
  closed_at      timestamptz,
  table_number   text,
  server_name    text,
  guest_count    integer NOT NULL DEFAULT 1,
  net_total      numeric(10, 2) NOT NULL DEFAULT 0,
  gross_total    numeric(10, 2) NOT NULL DEFAULT 0,
  discounts      numeric(10, 2) NOT NULL DEFAULT 0,
  gratuity       numeric(10, 2) NOT NULL DEFAULT 0,
  payment_method text,
  status         text NOT NULL DEFAULT 'closed',
  synced_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, loc_ref, check_number, business_date)
);

-- ── Labour by job code ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_labor_daily (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref        text NOT NULL,
  business_date  date NOT NULL,
  job_code       text NOT NULL DEFAULT '',
  job_name       text,
  employee_count integer NOT NULL DEFAULT 0,
  regular_hours  numeric(8, 2) NOT NULL DEFAULT 0,
  overtime_hours numeric(8, 2) NOT NULL DEFAULT 0,
  total_hours    numeric(8, 2) NOT NULL DEFAULT 0,
  labor_cost     numeric(14, 2) NOT NULL DEFAULT 0,
  synced_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, loc_ref, business_date, job_code)
);

-- ── Performance indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_micros_sync_runs_conn
  ON micros_sync_runs (connection_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_micros_sales_daily_date
  ON micros_sales_daily (connection_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_micros_intervals_date
  ON micros_sales_intervals (connection_id, business_date DESC, interval_start);

CREATE INDEX IF NOT EXISTS idx_micros_checks_date
  ON micros_guest_checks (connection_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_micros_labor_date
  ON micros_labor_daily (connection_id, business_date DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_micros_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_micros_connections_updated_at ON micros_connections;
CREATE TRIGGER trg_micros_connections_updated_at
  BEFORE UPDATE ON micros_connections
  FOR EACH ROW EXECUTE FUNCTION update_micros_connections_updated_at();

-- ── RLS: all MICROS tables are server-side only ───────────────────────────

ALTER TABLE micros_connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_sync_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_sales_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_sales_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_guest_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_labor_daily    ENABLE ROW LEVEL SECURITY;

-- Service role (used by all server-side API routes) has full access.
-- Anon/authenticated roles have NO access — all reads go through API routes.

DROP POLICY IF EXISTS "micros_service_role_all" ON micros_connections;
CREATE POLICY "micros_service_role_all" ON micros_connections
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "micros_service_role_all" ON micros_sync_runs;
CREATE POLICY "micros_service_role_all" ON micros_sync_runs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "micros_service_role_all" ON micros_sales_daily;
CREATE POLICY "micros_service_role_all" ON micros_sales_daily
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "micros_service_role_all" ON micros_sales_intervals;
CREATE POLICY "micros_service_role_all" ON micros_sales_intervals
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "micros_service_role_all" ON micros_guest_checks;
CREATE POLICY "micros_service_role_all" ON micros_guest_checks
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "micros_service_role_all" ON micros_labor_daily;
CREATE POLICY "micros_service_role_all" ON micros_labor_daily
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
