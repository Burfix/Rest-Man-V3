-- 043_add_site_id_to_sales_uploads.sql
-- Add site_id to sales_uploads so weekly POS uploads are scoped per site.
-- Backfills existing rows to the default pilot-store site.

ALTER TABLE sales_uploads
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id)
    DEFAULT '00000000-0000-0000-0000-000000000001';

-- Backfill any rows that landed before this migration
UPDATE sales_uploads
SET site_id = '00000000-0000-0000-0000-000000000001'
WHERE site_id IS NULL;

-- Make the column NOT NULL now that all rows are populated
ALTER TABLE sales_uploads
  ALTER COLUMN site_id SET NOT NULL;

-- Index for per-site lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_sales_uploads_site_week
  ON sales_uploads (site_id, week_start DESC);
