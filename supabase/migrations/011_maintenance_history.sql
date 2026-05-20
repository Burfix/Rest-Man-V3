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

create policy "authenticated_all" on equipment_repairs
  for all to authenticated using (true) with check (true);
