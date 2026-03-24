-- ============================================================
-- Food Cost & Stock Intelligence
-- Migration: 031_food_cost_stock.sql
-- ============================================================

-- ── 1. Inventory Items ─────────────────────────────────────────────────────

create table if not exists inventory_items (
  id                  uuid        primary key default gen_random_uuid(),
  store_id            uuid        not null default '00000000-0000-0000-0000-000000000001',
  name                text        not null,
  category            text        not null default 'general',
  unit                text        not null default 'kg',
  current_stock       numeric     not null default 0,
  minimum_threshold   numeric     not null default 0,
  avg_daily_usage     numeric     not null default 0,
  supplier_name       text,
  typical_order_qty   numeric,
  last_order_date     date,
  lead_time_days      integer     not null default 1,
  target_days_cover   integer     not null default 5,
  unit_cost           numeric,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_inventory_items_store
  on inventory_items (store_id);

create index if not exists idx_inventory_items_category
  on inventory_items (category);

-- ── 2. Stock Movements ─────────────────────────────────────────────────────

create table if not exists stock_movements (
  id                  uuid        primary key default gen_random_uuid(),
  inventory_item_id   uuid        not null references inventory_items(id) on delete cascade,
  store_id            uuid        not null default '00000000-0000-0000-0000-000000000001',
  type                text        not null check (type in ('usage', 'order', 'delivery', 'adjustment', 'waste')),
  quantity            numeric     not null,
  note                text,
  created_by          text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_stock_movements_item
  on stock_movements (inventory_item_id);

create index if not exists idx_stock_movements_date
  on stock_movements (created_at desc);

-- ── 3. Purchase Orders ─────────────────────────────────────────────────────

create table if not exists purchase_orders (
  id                    uuid        primary key default gen_random_uuid(),
  store_id              uuid        not null default '00000000-0000-0000-0000-000000000001',
  supplier_name         text        not null,
  status                text        not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  ordered_at            timestamptz,
  expected_delivery_at  timestamptz,
  received_at           timestamptz,
  created_by            text,
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists idx_purchase_orders_store
  on purchase_orders (store_id);

create index if not exists idx_purchase_orders_status
  on purchase_orders (status);

-- ── 4. Purchase Order Items ────────────────────────────────────────────────

create table if not exists purchase_order_items (
  id                  uuid    primary key default gen_random_uuid(),
  purchase_order_id   uuid    not null references purchase_orders(id) on delete cascade,
  inventory_item_id   uuid    not null references inventory_items(id) on delete cascade,
  quantity            numeric not null,
  unit_cost           numeric,
  total_cost          numeric
);

create index if not exists idx_po_items_order
  on purchase_order_items (purchase_order_id);

-- ── 5. Food Cost Snapshots ─────────────────────────────────────────────────

create table if not exists food_cost_snapshots (
  id                      uuid    primary key default gen_random_uuid(),
  store_id                uuid    not null default '00000000-0000-0000-0000-000000000001',
  date                    date    not null,
  sales_total             numeric,
  purchases_total         numeric,
  estimated_food_cost_pct numeric,
  target_food_cost_pct    numeric not null default 30.0,
  variance_pct            numeric,
  created_at              timestamptz not null default now(),

  constraint uq_food_cost_snapshot unique (store_id, date)
);

create index if not exists idx_food_cost_snapshots_date
  on food_cost_snapshots (date desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table inventory_items      enable row level security;
alter table stock_movements      enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_items enable row level security;
alter table food_cost_snapshots  enable row level security;

-- Service-role full access
create policy "srole_inventory"   on inventory_items      for all to service_role using (true) with check (true);
create policy "srole_stock_mvmt"  on stock_movements      for all to service_role using (true) with check (true);
create policy "srole_po"          on purchase_orders       for all to service_role using (true) with check (true);
create policy "srole_po_items"    on purchase_order_items  for all to service_role using (true) with check (true);
create policy "srole_food_cost"   on food_cost_snapshots   for all to service_role using (true) with check (true);

-- Authenticated full access (GMs manage stock)
create policy "auth_inventory"    on inventory_items      for all to authenticated using (true) with check (true);
create policy "auth_stock_mvmt"   on stock_movements      for all to authenticated using (true) with check (true);
create policy "auth_po"           on purchase_orders       for all to authenticated using (true) with check (true);
create policy "auth_po_items"     on purchase_order_items  for all to authenticated using (true) with check (true);
create policy "auth_food_cost"    on food_cost_snapshots   for all to authenticated using (true) with check (true);

-- ── Seed data: 15 typical restaurant inventory items ────────────────────────

insert into inventory_items (name, category, unit, current_stock, minimum_threshold, avg_daily_usage, supplier_name, typical_order_qty, lead_time_days, target_days_cover, unit_cost)
values
  ('Mozzarella',        'dairy',     'kg',    25, 8,  6.0, 'Cape Dairy Co',     30, 1, 5, 89.90),
  ('Pizza Dough Balls', 'bakery',    'units', 80, 30, 25,  'Artisan Bakery',    100, 1, 4, 4.50),
  ('Fresh Pasta',       'pasta',     'kg',    15, 5,  4.0, 'Pasta Fresca',      20,  1, 5, 42.00),
  ('Ribeye Steak',      'protein',   'kg',    12, 4,  3.0, 'Prime Meats SA',    15,  2, 5, 289.00),
  ('Chicken Breast',    'protein',   'kg',    18, 6,  5.0, 'Goldi Foods',       25,  1, 4, 69.90),
  ('Salmon Fillet',     'seafood',   'kg',    8,  3,  2.0, 'Ocean Basket Supply', 10, 2, 5, 320.00),
  ('Mixed Salad Leaves','produce',   'kg',    10, 4,  3.5, 'Fresh Earth',       12,  1, 3, 45.00),
  ('Tomato Sauce',      'sauce',     'litres',20, 8,  4.0, 'In-House',          0,   0, 5, 25.00),
  ('Olive Oil',         'pantry',    'litres',15, 5,  1.5, 'Mediterranean Imports', 20, 3, 10, 120.00),
  ('Parmesan Reggiano', 'dairy',     'kg',    6,  2,  1.0, 'Italian Imports',   5,   3, 7, 450.00),
  ('Bread Rolls',       'bakery',    'units', 60, 20, 20,  'Artisan Bakery',    80,  1, 4, 3.20),
  ('Gelato (Mixed)',    'frozen',    'litres',12, 4,  2.5, 'Gelatissimo',       15,  2, 5, 85.00),
  ('House Wine Red',    'beverage',  'bottles',24, 10, 4.0,'Stellenbosch Wines',36,  2, 7, 55.00),
  ('Espresso Beans',    'beverage',  'kg',    8,  3,  1.5, 'Origin Roasters',   10,  2, 7, 180.00),
  ('Cocktail Garnishes','garnish',   'units', 100,40, 15,  'Fresh Earth',       120, 1, 5, 2.50)
on conflict do nothing;
