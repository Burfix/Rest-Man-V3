-- Add par_level to inventory_items (ideal restock level, above minimum_threshold)
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS par_level numeric DEFAULT 0;

-- Backfill: set par_level to 2x minimum_threshold for existing rows
UPDATE inventory_items
  SET par_level = minimum_threshold * 2
  WHERE par_level = 0 AND minimum_threshold > 0;
