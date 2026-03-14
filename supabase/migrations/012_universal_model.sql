-- ============================================================
-- Si Cantina Ops — Universal Operational Data Model
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
-- Si Cantina Sociale is a single site. Future: airports, malls, etc.

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

-- Seed Si Cantina Sociale as the default site
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

-- Seed the standard zones for Si Cantina Sociale
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

-- Backfill: link all existing equipment to the Si Cantina site
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

-- Backfill: link all maintenance tickets to the Si Cantina site
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
create policy "authenticated_all" on workflow_logs
  for all to authenticated using (true) with check (true);

-- ── 9. RLS for new site/zone/contractor tables ────────────────────────────────

alter table sites       enable row level security;
alter table zones       enable row level security;
alter table contractors enable row level security;

create policy "authenticated_all" on sites
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on zones
  for all to authenticated using (true) with check (true);

create policy "authenticated_all" on contractors
  for all to authenticated using (true) with check (true);
