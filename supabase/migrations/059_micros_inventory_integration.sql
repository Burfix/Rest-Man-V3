-- ============================================================
-- 059 — MICROS Inventory Management API Integration
--
-- Adds columns and tables for Oracle MICROS POS Web Services
-- (SOAP-based Inventory Management API):
--   • micros_connections — inv_* columns for IM credentials
--   • inventory_items   — MICROS IM sync metadata columns
--   • micros_stock_on_hand — stock-on-hand snapshots per item
--   • micros_cost_centers  — cost center reference data
--   • micros_vendors       — vendor reference data
-- ============================================================

-- ── 1. Extend micros_connections with Inventory API fields ──────────────────

ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS inv_app_server_url text,
  ADD COLUMN IF NOT EXISTS inv_username       text,
  ADD COLUMN IF NOT EXISTS inv_password_enc   text,
  ADD COLUMN IF NOT EXISTS inv_pos_sequence   integer,
  ADD COLUMN IF NOT EXISTS inv_last_sync_at   timestamptz,
  ADD COLUMN IF NOT EXISTS inv_enabled        boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN micros_connections.inv_app_server_url IS 'Inventory API base URL (may differ from BI API server)';
COMMENT ON COLUMN micros_connections.inv_username       IS 'RNA username for SOAP AuthenticationHeader';
COMMENT ON COLUMN micros_connections.inv_password_enc   IS 'Reference/label for the env-stored password — never plaintext';
COMMENT ON COLUMN micros_connections.inv_pos_sequence   IS 'POS sequence number for SendTransactionList';
COMMENT ON COLUMN micros_connections.inv_last_sync_at   IS 'Last successful inventory sync timestamp';
COMMENT ON COLUMN micros_connections.inv_enabled        IS 'Feature flag — when false, inventory sync is disabled';

-- ── 2. Extend inventory_items with MICROS IM metadata ───────────────────────

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS micros_item_number bigint,
  ADD COLUMN IF NOT EXISTS micros_item_group  text,
  ADD COLUMN IF NOT EXISTS micros_store_unit  text,
  ADD COLUMN IF NOT EXISTS micros_sales_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS last_synced_at     timestamptz,
  ADD COLUMN IF NOT EXISTS sync_source        text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN inventory_items.micros_item_number IS 'Item.Number from GetItemList (bigint key)';
COMMENT ON COLUMN inventory_items.micros_item_group  IS 'Item.ItemGroup from GetItemList';
COMMENT ON COLUMN inventory_items.micros_store_unit  IS 'Item.Unit from GetItemList (MICROS store unit)';
COMMENT ON COLUMN inventory_items.micros_sales_price IS 'Item.SalesPrice from GetItemList';
COMMENT ON COLUMN inventory_items.last_synced_at     IS 'Last time this row was synced from MICROS';
COMMENT ON COLUMN inventory_items.sync_source        IS 'micros_inventory | manual';

-- Unique constraint for MICROS item number per store
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_micros_number
  ON inventory_items (store_id, micros_item_number)
  WHERE micros_item_number IS NOT NULL;

-- ── 3. micros_stock_on_hand — stock-on-hand snapshots ───────────────────────

CREATE TABLE IF NOT EXISTS micros_stock_on_hand (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  connection_id        uuid        NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  item_number          bigint      NOT NULL,
  item_name            text,
  cost_center_name     text,
  cost_center_number   bigint,
  qty_amount           numeric(14,4),
  qty_unit             text,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  business_date        date        NOT NULL DEFAULT CURRENT_DATE,

  CONSTRAINT uq_stock_on_hand_key
    UNIQUE (connection_id, item_number, cost_center_number, business_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_on_hand_site_date
  ON micros_stock_on_hand (site_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_on_hand_item
  ON micros_stock_on_hand (item_number);

-- ── 4. micros_cost_centers — cost center reference data ─────────────────────

CREATE TABLE IF NOT EXISTS micros_cost_centers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid        NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  number         bigint      NOT NULL,
  location_id    bigint,
  synced_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_cost_center_key
    UNIQUE (connection_id, number)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_connection
  ON micros_cost_centers (connection_id);

-- ── 5. micros_vendors — vendor reference data ───────────────────────────────

CREATE TABLE IF NOT EXISTS micros_vendors (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id               uuid        NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  name                        text        NOT NULL,
  number                      bigint      NOT NULL,
  address                     text,
  email                       text,
  phone                       text,
  tax_id                      text,
  external_invoice_processing boolean     DEFAULT false,
  synced_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_vendor_key
    UNIQUE (connection_id, number)
);

CREATE INDEX IF NOT EXISTS idx_vendors_connection
  ON micros_vendors (connection_id);

-- ── 6. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE micros_stock_on_hand ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_cost_centers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_vendors       ENABLE ROW LEVEL SECURITY;

-- Service role: full access (sync writes)
CREATE POLICY "srole_stock_on_hand" ON micros_stock_on_hand
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "srole_cost_centers" ON micros_cost_centers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "srole_vendors" ON micros_vendors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: read-only
CREATE POLICY "auth_stock_on_hand" ON micros_stock_on_hand
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_cost_centers" ON micros_cost_centers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_vendors" ON micros_vendors
  FOR SELECT TO authenticated USING (true);
