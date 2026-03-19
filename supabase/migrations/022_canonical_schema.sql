-- ============================================================
-- Migration 022: Canonical Business Entity Schema
--
-- This is the single source of truth for all operational data.
-- Raw ingestion tables (021) feed into this layer via adapters.
-- All UI surfaces read exclusively from canonical tables.
--
-- Hierarchy: organisations → regions → stores (sites)
-- ============================================================

-- ── Organisations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organisations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  country      text NOT NULL DEFAULT 'ZA',
  timezone     text NOT NULL DEFAULT 'Africa/Johannesburg',
  currency     text NOT NULL DEFAULT 'ZAR',
  settings     jsonb NOT NULL DEFAULT '{}',  -- org-level thresholds, branding
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Seed the master organisation
INSERT INTO organisations (id, name, slug, country, timezone, currency)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Si Cantina Restaurant Group',
  'si-cantina',
  'ZA',
  'Africa/Johannesburg',
  'ZAR'
) ON CONFLICT (id) DO NOTHING;

-- ── Regions ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  code            text NOT NULL,
  area_manager_id uuid,      -- FK → auth.users (loose, set by app layer)
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_regions_org ON regions (organisation_id);

INSERT INTO regions (id, organisation_id, name, code)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Western Cape',
  'WC'
) ON CONFLICT DO NOTHING;

-- ── Extend sites → canonical stores ──────────────────────────────────────────
-- sites already exists (migration 012). Add enterprise columns.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS region_id       uuid REFERENCES regions(id),
  ADD COLUMN IF NOT EXISTS store_code      text,
  ADD COLUMN IF NOT EXISTS gm_user_id      uuid,
  ADD COLUMN IF NOT EXISTS target_labour_pct numeric(5,2) DEFAULT 30.0,
  ADD COLUMN IF NOT EXISTS target_margin_pct  numeric(5,2) DEFAULT 12.0,
  ADD COLUMN IF NOT EXISTS settings        jsonb NOT NULL DEFAULT '{}';

-- Back-fill existing stores to org/region
UPDATE sites SET
  organisation_id = '00000000-0000-0000-0000-000000000001',
  region_id       = '00000000-0000-0000-0000-000000000010',
  store_code      = CASE id
    WHEN '00000000-0000-0000-0000-000000000001' THEN 'SIC-001'
    WHEN '00000000-0000-0000-0000-000000000002' THEN 'SIC-002'
    WHEN '00000000-0000-0000-0000-000000000003' THEN 'SIC-003'
    ELSE 'SIC-' || substr(id::text, 1, 3)
  END
WHERE organisation_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sites_org    ON sites (organisation_id);
CREATE INDEX IF NOT EXISTS idx_sites_region ON sites (region_id);

-- ── Service Days ──────────────────────────────────────────────────────────────
-- One row per store per trading day. Aggregates all activity for that day.

CREATE TABLE IF NOT EXISTS service_days (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_date        date NOT NULL,
  day_of_week         smallint NOT NULL,   -- 0=Sun … 6=Sat
  is_holiday          boolean NOT NULL DEFAULT false,
  event_id            uuid REFERENCES events(id),
  covers_booked       integer,
  covers_actual       integer,
  revenue_net_vat     numeric(12,2),
  revenue_target      numeric(12,2),
  labour_cost         numeric(12,2),
  operating_score     numeric(5,2),
  risk_level          text,
  notes               text,
  closed_by           uuid,              -- auth.users
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, service_date)
);

CREATE INDEX IF NOT EXISTS idx_service_days_site_date ON service_days (site_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_service_days_date      ON service_days (service_date DESC);

-- ── Revenue Records ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS revenue_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_date      date NOT NULL,
  period_label      text,                     -- e.g. "Lunch", "Dinner", "All-day"
  gross_sales       numeric(12,2) NOT NULL,
  discounts         numeric(12,2) NOT NULL DEFAULT 0,
  refunds           numeric(12,2) NOT NULL DEFAULT 0,
  net_sales         numeric(12,2) GENERATED ALWAYS AS (gross_sales - discounts - refunds) STORED,
  vat_amount        numeric(12,2),
  net_vat_excl      numeric(12,2),
  covers            integer,
  avg_spend         numeric(8,2),
  source            text NOT NULL DEFAULT 'manual', -- 'micros' | 'manual' | 'import'
  raw_record_id     uuid REFERENCES raw_micros_sales(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rev_site_date    ON revenue_records (site_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_rev_date         ON revenue_records (service_date DESC);
CREATE INDEX IF NOT EXISTS idx_rev_source       ON revenue_records (source);

-- ── Labour Records ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS labour_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_date    date NOT NULL,
  employee_id     text,               -- external ID from payroll system
  employee_name   text,
  role            text,
  shift_start     time,
  shift_end       time,
  hours_worked    numeric(5,2),
  hourly_rate     numeric(8,2),
  labour_cost     numeric(10,2),
  department      text,
  source          text NOT NULL DEFAULT 'manual',
  raw_record_id   uuid REFERENCES raw_labour_data(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_labour_site_date ON labour_records (site_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_labour_date      ON labour_records (service_date DESC);

-- ── Assets ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name             text NOT NULL,
  asset_code       text,
  category         text NOT NULL,        -- kitchen | hvac | pos | foh | safety
  manufacturer     text,
  model            text,
  serial_number    text,
  purchase_date    date,
  warranty_expiry  date,
  location_in_store text,
  status           text NOT NULL DEFAULT 'operational',
                                         -- operational | needs_attention | under_repair | out_of_service | decommissioned
  criticality      text NOT NULL DEFAULT 'medium',  -- low | medium | high | critical
  last_service_date date,
  next_service_date date,
  notes            text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_site        ON assets (site_id);
CREATE INDEX IF NOT EXISTS idx_assets_status      ON assets (status);
CREATE INDEX IF NOT EXISTS idx_assets_category    ON assets (category);

-- ── Maintenance Tickets ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  asset_id         uuid REFERENCES assets(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  category         text NOT NULL DEFAULT 'general',
  priority         text NOT NULL DEFAULT 'medium',    -- low | medium | high | critical
  status           text NOT NULL DEFAULT 'open',      -- open | in_progress | waiting_parts | resolved | closed | reopened
  reported_by      uuid,                              -- auth.users
  assigned_to      uuid,                              -- contractor or staff user
  contractor_id    uuid,                              -- FK → contractors.id
  reported_at      timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz,
  started_at       timestamptz,
  resolved_at      timestamptz,
  closed_at        timestamptz,
  cost             numeric(10,2),
  invoice_url      text,
  recurrence_count integer NOT NULL DEFAULT 0,        -- times this asset failed
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_site         ON maintenance_tickets (site_id);
CREATE INDEX IF NOT EXISTS idx_maint_asset        ON maintenance_tickets (asset_id);
CREATE INDEX IF NOT EXISTS idx_maint_status       ON maintenance_tickets (status);
CREATE INDEX IF NOT EXISTS idx_maint_priority     ON maintenance_tickets (priority);
CREATE INDEX IF NOT EXISTS idx_maint_due          ON maintenance_tickets (due_at);

-- ── Contractors ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contractors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid REFERENCES organisations(id),
  name             text NOT NULL,
  company          text,
  speciality       text[],              -- ['hvac', 'electrical', 'plumbing']
  email            text,
  phone            text,
  is_approved      boolean NOT NULL DEFAULT false,
  rating           numeric(3,2),        -- 0–5 star avg
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractors_org ON contractors (organisation_id);

-- ── Compliance Items ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title            text NOT NULL,
  category         text NOT NULL,       -- health_safety | fire | food_safety | licensing | labour
  description      text,
  frequency        text NOT NULL DEFAULT 'annual',
                                        -- daily | weekly | monthly | quarterly | annual | once
  last_completed   date,
  next_due         date NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
                                        -- pending | compliant | due_soon | overdue | exempt | blocked
  responsible_id   uuid,               -- auth.users
  evidence_required boolean NOT NULL DEFAULT true,
  is_critical      boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_site        ON compliance_items (site_id);
CREATE INDEX IF NOT EXISTS idx_compliance_status      ON compliance_items (status);
CREATE INDEX IF NOT EXISTS idx_compliance_due         ON compliance_items (next_due);
CREATE INDEX IF NOT EXISTS idx_compliance_category    ON compliance_items (category);

-- ── Compliance Documents ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_item_id uuid NOT NULL REFERENCES compliance_items(id) ON DELETE CASCADE,
  site_id          uuid NOT NULL REFERENCES sites(id),
  file_url         text NOT NULL,
  file_name        text NOT NULL,
  mime_type        text,
  uploaded_by      uuid,
  upload_date      timestamptz NOT NULL DEFAULT now(),
  valid_from       date,
  expires_at       date,
  notes            text,
  raw_upload_id    uuid REFERENCES raw_compliance_uploads(id)
);

CREATE INDEX IF NOT EXISTS idx_comp_docs_item         ON compliance_documents (compliance_item_id);
CREATE INDEX IF NOT EXISTS idx_comp_docs_site         ON compliance_documents (site_id);
CREATE INDEX IF NOT EXISTS idx_comp_docs_expires      ON compliance_documents (expires_at);

-- ── Reviews ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  platform         text NOT NULL DEFAULT 'google',
  external_id      text,
  reviewer_name    text,
  rating           numeric(3,2) NOT NULL,
  review_text      text,
  response_text    text,
  responded_at     timestamptz,
  review_date      date NOT NULL,
  sentiment        text,               -- positive | neutral | negative
  sentiment_score  numeric(4,3),       -- -1.0 to +1.0
  tags             text[],
  raw_record_id    uuid REFERENCES raw_reviews(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_site       ON reviews (site_id);
CREATE INDEX IF NOT EXISTS idx_reviews_date       ON reviews (review_date DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_platform   ON reviews (platform);
CREATE INDEX IF NOT EXISTS idx_reviews_rating     ON reviews (rating);

-- ── Incidents ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  incident_type    text NOT NULL,       -- customer_complaint | safety | food_safety | property | staff
  severity         text NOT NULL DEFAULT 'medium',
  status           text NOT NULL DEFAULT 'open',
  occurred_at      timestamptz NOT NULL,
  reported_by      uuid,
  assigned_to      uuid,
  resolved_at      timestamptz,
  resolution_notes text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_site         ON incidents (site_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status       ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_occurred     ON incidents (occurred_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE organisations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_days        ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents           ENABLE ROW LEVEL SECURITY;

-- Service role gets full access; RBAC policies added in migration 024
CREATE POLICY "srole_full_organisations"   ON organisations       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_regions"         ON regions             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_service_days"    ON service_days        FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_revenue"         ON revenue_records     FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_labour"          ON labour_records      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_assets"          ON assets              FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_maint_tickets"   ON maintenance_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_contractors"     ON contractors         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_compliance"      ON compliance_items    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_comp_docs"       ON compliance_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_reviews"         ON reviews             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "srole_full_incidents"       ON incidents           FOR ALL TO service_role USING (true) WITH CHECK (true);
