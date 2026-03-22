-- 027_manual_sales_uploads.sql
-- Manual daily sales upload table for fallback when MICROS is offline/stale.

CREATE TABLE IF NOT EXISTS manual_sales_uploads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID REFERENCES sites(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  business_date  DATE NOT NULL,
  gross_sales    NUMERIC(12,2) NOT NULL,
  net_sales      NUMERIC(12,2),
  covers         INTEGER NOT NULL DEFAULT 0,
  checks         INTEGER NOT NULL DEFAULT 0,
  avg_spend_per_cover NUMERIC(10,2),
  avg_check_value     NUMERIC(10,2),
  labour_percent NUMERIC(5,2),
  notes          TEXT,
  source_file_name TEXT,
  uploaded_by    TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One upload per business date per site (latest wins)
  CONSTRAINT uq_manual_sales_date_site UNIQUE (site_id, business_date)
);

-- Index for fast lookup by date
CREATE INDEX IF NOT EXISTS idx_manual_sales_date
  ON manual_sales_uploads (business_date DESC);

-- RLS: service role only (server-side uploads)
ALTER TABLE manual_sales_uploads ENABLE ROW LEVEL SECURITY;
