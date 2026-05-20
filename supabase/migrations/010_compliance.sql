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

create policy "authenticated_all" on compliance_items
  for all to authenticated using (true) with check (true);

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
