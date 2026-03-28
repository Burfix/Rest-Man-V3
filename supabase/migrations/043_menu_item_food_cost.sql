-- ============================================================
-- Migration 043: Menu Item Food Cost from BI API
-- ============================================================
-- Adds prep_cost tracking to food_cost_snapshots and
-- a menu_item_food_costs table for per-item daily cost data
-- sourced from getMenuItemDailyTotals (BI API).
-- ============================================================

-- ── 1. Per-item daily food cost data from MICROS BI ────────────────────────
create table if not exists menu_item_food_costs (
  id                uuid        primary key default gen_random_uuid(),
  store_id          uuid        not null,
  business_date     date        not null,
  micros_mi_num     integer     not null,
  item_name         text,
  revenue_center    integer,
  sales_total       numeric     not null default 0,
  sales_count       numeric     not null default 0,
  prep_cost         numeric     not null default 0,
  food_cost_pct     numeric,           -- prep_cost / sales_total * 100
  major_group_name  text,
  family_group_name text,
  synced_at         timestamptz not null default now(),

  constraint uq_menu_item_food_cost unique (store_id, business_date, micros_mi_num, revenue_center)
);

create index if not exists idx_mifc_store_date
  on menu_item_food_costs (store_id, business_date desc);

create index if not exists idx_mifc_mi_num
  on menu_item_food_costs (micros_mi_num);

-- ── 2. Add prep_cost_total to food_cost_snapshots ──────────────────────────
alter table food_cost_snapshots
  add column if not exists prep_cost_total numeric,
  add column if not exists item_count      integer,
  add column if not exists source          text default 'manual';

-- ── 3. Menu item dimension cache (from getMenuItemDimensions) ──────────────
create table if not exists menu_item_dimensions (
  id                uuid        primary key default gen_random_uuid(),
  store_id          uuid        not null,
  micros_mi_num     integer     not null,
  item_name         text        not null,
  major_group_num   integer,
  major_group_name  text,
  family_group_num  integer,
  family_group_name text,
  price_1           numeric,
  price_2           numeric,
  synced_at         timestamptz not null default now(),

  constraint uq_menu_item_dim unique (store_id, micros_mi_num)
);

create index if not exists idx_mid_store
  on menu_item_dimensions (store_id);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
alter table menu_item_food_costs enable row level security;
alter table menu_item_dimensions enable row level security;

create policy "srole_mifc" on menu_item_food_costs for all to service_role using (true) with check (true);
create policy "auth_mifc"  on menu_item_food_costs for all to authenticated using (true) with check (true);

create policy "srole_mid"  on menu_item_dimensions for all to service_role using (true) with check (true);
create policy "auth_mid"   on menu_item_dimensions for all to authenticated using (true) with check (true);
