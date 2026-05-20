-- ============================================================
-- Ops Engine — Operations Dashboard Tables
-- Migration: 003_ops_tables.sql
-- Adds: reviews, sales_uploads, sales_items, equipment, maintenance_logs
-- set_updated_at() trigger already created in 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- TABLE: reviews
-- Manual import only for MVP (no live platform integration)
-- ============================================================
create table if not exists reviews (
  id             uuid primary key default gen_random_uuid(),
  review_date    date not null,
  platform       text not null default 'google',  -- google | tripadvisor | other
  rating         numeric(2,1) not null check (rating >= 1 and rating <= 5),
  reviewer_name  text,
  review_text    text,
  sentiment      text,                             -- positive | neutral | negative
  tags           text[] not null default '{}',
  flagged        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_reviews_date     on reviews (review_date desc);
create index if not exists idx_reviews_platform on reviews (platform);
create index if not exists idx_reviews_rating   on reviews (rating);
create index if not exists idx_reviews_flagged  on reviews (flagged) where flagged = true;

create or replace trigger trg_reviews_updated_at
  before update on reviews
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: sales_uploads
-- Each row represents one weekly POS export
-- ============================================================
create table if not exists sales_uploads (
  id                uuid primary key default gen_random_uuid(),
  week_label        text not null,           -- e.g. "Week 10 — 3–9 Mar 2026"
  week_start        date not null,
  week_end          date not null,
  total_items_sold  integer not null default 0,
  total_sales_value numeric(10,2) not null default 0,
  uploaded_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists idx_sales_uploads_week on sales_uploads (week_start desc);

-- ============================================================
-- TABLE: sales_items
-- Line items belonging to a weekly upload
-- ============================================================
create table if not exists sales_items (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid not null references sales_uploads(id) on delete cascade,
  item_name     text not null,
  category      text,
  quantity_sold integer not null default 0,
  unit_price    numeric(8,2),
  total_value   numeric(10,2),
  created_at    timestamptz not null default now()
);

create index if not exists idx_sales_items_upload on sales_items (upload_id);
create index if not exists idx_sales_items_qty    on sales_items (upload_id, quantity_sold desc);

-- ============================================================
-- TABLE: equipment
-- Physical assets tracked for maintenance
-- ============================================================
create table if not exists equipment (
  id          uuid primary key default gen_random_uuid(),
  unit_name   text not null,
  category    text not null default 'other',        -- kitchen | bar | facilities | other
  location    text,
  status      text not null default 'operational',  -- operational | needs_attention | out_of_service
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_equipment_status   on equipment (status);
create index if not exists idx_equipment_category on equipment (category);

create or replace trigger trg_equipment_updated_at
  before update on equipment
  for each row execute procedure set_updated_at();

-- ============================================================
-- TABLE: maintenance_logs
-- Issue tracking for all equipment
-- ============================================================
create table if not exists maintenance_logs (
  id                uuid primary key default gen_random_uuid(),
  equipment_id      uuid references equipment(id) on delete set null,
  unit_name         text not null,                            -- denormalized for display
  category          text not null default 'other',
  issue_title       text not null,
  issue_description text,
  priority          text not null default 'medium',           -- urgent | high | medium | low
  repair_status     text not null default 'open',             -- open | in_progress | awaiting_parts | resolved | closed
  date_reported     date not null default current_date,
  date_resolved     date,
  resolved_by       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_maint_status    on maintenance_logs (repair_status);
create index if not exists idx_maint_priority  on maintenance_logs (priority);
create index if not exists idx_maint_reported  on maintenance_logs (date_reported desc);
create index if not exists idx_maint_equipment on maintenance_logs (equipment_id);

create or replace trigger trg_maintenance_logs_updated_at
  before update on maintenance_logs
  for each row execute procedure set_updated_at();
