-- Migration 033: Add micros_item_id to inventory_items
-- Links local inventory items to their Oracle MICROS menu item number (miNum).
-- This enables upsert-on-sync: match Oracle items to existing rows.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS micros_item_id text;

-- Index for fast lookups during sync (store_id + micros_item_id)
CREATE INDEX IF NOT EXISTS idx_inventory_items_micros_id
  ON inventory_items (store_id, micros_item_id)
  WHERE micros_item_id IS NOT NULL;

-- Add a unique constraint so we can upsert on (store_id, micros_item_id)
-- Only applies when micros_item_id is non-null (local-only items have NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_micros
  ON inventory_items (store_id, micros_item_id)
  WHERE micros_item_id IS NOT NULL;
