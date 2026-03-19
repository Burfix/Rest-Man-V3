-- ============================================================
-- Migration 021: Raw Ingestion Layer
-- 
-- Purpose: Capture source payloads before transformation.
-- Principle: Sources write here ONLY. Canonical tables are
--            populated by the adapter transform step.
-- ============================================================

-- Validation status enum used across all raw tables
DO $$ BEGIN
  CREATE TYPE ingestion_validation_status AS ENUM (
    'pending',
    'valid',
    'invalid',
    'duplicate',
    'transformed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Raw Micros/POS Sales ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_micros_sales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid REFERENCES sites(id) ON DELETE SET NULL,
  source_record_id   text NOT NULL,          -- unique key from Micros/POS
  sync_batch_id      uuid NOT NULL,          -- groups records from one sync run
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  source_payload     jsonb NOT NULL,         -- raw JSON from source
  validation_status  ingestion_validation_status NOT NULL DEFAULT 'pending',
  validation_errors  jsonb,                 -- array of error strings if invalid
  transformed_at     timestamptz,
  canonical_id       uuid,                  -- FK → revenue_records.id after transform
  UNIQUE (site_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_micros_site_batch      ON raw_micros_sales (site_id, sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_micros_status          ON raw_micros_sales (validation_status);
CREATE INDEX IF NOT EXISTS idx_raw_micros_ingested        ON raw_micros_sales (ingested_at DESC);

-- ── Raw Labour Data ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_labour_data (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid REFERENCES sites(id) ON DELETE SET NULL,
  source_record_id   text NOT NULL,
  sync_batch_id      uuid NOT NULL,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  source_payload     jsonb NOT NULL,
  validation_status  ingestion_validation_status NOT NULL DEFAULT 'pending',
  validation_errors  jsonb,
  transformed_at     timestamptz,
  canonical_id       uuid,                  -- FK → labour_records.id after transform
  UNIQUE (site_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_labour_site_batch      ON raw_labour_data (site_id, sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_labour_status          ON raw_labour_data (validation_status);
CREATE INDEX IF NOT EXISTS idx_raw_labour_ingested        ON raw_labour_data (ingested_at DESC);

-- ── Raw Compliance Uploads ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_compliance_uploads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid REFERENCES sites(id) ON DELETE SET NULL,
  source_record_id   text NOT NULL,          -- usually a file hash or upload UUID
  sync_batch_id      uuid NOT NULL,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  source_payload     jsonb NOT NULL,
  file_url           text,                  -- storage URL for the uploaded document
  file_name          text,
  mime_type          text,
  validation_status  ingestion_validation_status NOT NULL DEFAULT 'pending',
  validation_errors  jsonb,
  transformed_at     timestamptz,
  canonical_id       uuid,                  -- FK → compliance_documents.id after transform
  UNIQUE (site_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_compliance_site_batch  ON raw_compliance_uploads (site_id, sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_compliance_status      ON raw_compliance_uploads (validation_status);
CREATE INDEX IF NOT EXISTS idx_raw_compliance_ingested    ON raw_compliance_uploads (ingested_at DESC);

-- ── Raw Reviews ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid REFERENCES sites(id) ON DELETE SET NULL,
  source_record_id   text NOT NULL,          -- e.g. Google review ID
  source_platform    text NOT NULL DEFAULT 'google', -- google | tripadvisor | internal
  sync_batch_id      uuid NOT NULL,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  source_payload     jsonb NOT NULL,
  validation_status  ingestion_validation_status NOT NULL DEFAULT 'pending',
  validation_errors  jsonb,
  transformed_at     timestamptz,
  canonical_id       uuid,                  -- FK → reviews.id after transform
  UNIQUE (source_platform, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_reviews_site_batch     ON raw_reviews (site_id, sync_batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_reviews_platform       ON raw_reviews (source_platform);
CREATE INDEX IF NOT EXISTS idx_raw_reviews_status         ON raw_reviews (validation_status);
CREATE INDEX IF NOT EXISTS idx_raw_reviews_ingested       ON raw_reviews (ingested_at DESC);

-- ── Sync Batch Log ────────────────────────────────────────────────────────────
-- Central ledger for every integration sync run. Adapters create a batch
-- record at start and close it (with outcome) on completion/error.

CREATE TABLE IF NOT EXISTS sync_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid REFERENCES sites(id) ON DELETE SET NULL,
  source_type    text NOT NULL,  -- 'micros' | 'labour' | 'reviews' | 'compliance'
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  records_found  integer,
  records_valid  integer,
  records_failed integer,
  status         text NOT NULL DEFAULT 'running',  -- running | success | partial | failed
  error_message  text,
  initiated_by   text                              -- user_id or 'cron'
);

CREATE INDEX IF NOT EXISTS idx_sync_batches_site       ON sync_batches (site_id);
CREATE INDEX IF NOT EXISTS idx_sync_batches_source     ON sync_batches (source_type);
CREATE INDEX IF NOT EXISTS idx_sync_batches_started    ON sync_batches (started_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE raw_micros_sales       ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_labour_data        ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_compliance_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_batches           ENABLE ROW LEVEL SECURITY;

-- Service-role (backend) has full access; anon/authenticated restricted to reads
CREATE POLICY "service_role_all_raw_micros"
  ON raw_micros_sales FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_raw_labour"
  ON raw_labour_data FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_raw_compliance"
  ON raw_compliance_uploads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_raw_reviews"
  ON raw_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_sync_batches"
  ON sync_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
