-- ============================================================
-- 015 — Oracle MICROS BI Integration
-- Normalized tables for connection config, sync audit, and
-- all operational data fetched from the MICROS BI API.
-- Credentials are server-side only; access_token is cached
-- in this table and never returned to client layers.
-- ============================================================

-- ── Connection config ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name           text NOT NULL DEFAULT 'Pilot Store',
  loc_ref                 text NOT NULL DEFAULT '',        -- MICROS locRef for this store
  auth_server_url         text NOT NULL DEFAULT '',        -- Oracle IDCS / auth endpoint base
  app_server_url          text NOT NULL DEFAULT '',        -- MICROS BI app server base URL
  client_id               text NOT NULL DEFAULT '',        -- OAuth client id
  org_identifier          text NOT NULL DEFAULT '',        -- Oracle org / tenant identifier

  -- Token cache — server-side only, never returned to client
  access_token            text,
  token_expires_at        timestamptz,

  -- Sync state
  status                  text NOT NULL DEFAULT 'awaiting_setup'
    CHECK (status IN ('awaiting_setup', 'connected', 'syncing', 'stale', 'error')),
  last_sync_at            timestamptz,
  last_sync_error         text,
  last_successful_sync_at timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── Sync run audit log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  sync_type        text NOT NULL
    CHECK (sync_type IN ('daily_totals', 'intervals', 'guest_checks', 'labor', 'full')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  status           text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error', 'partial')),
  records_fetched  integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  error_message    text,
  metadata         jsonb NOT NULL DEFAULT '{}'
);

-- ── Normalized daily sales totals ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sales_daily (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref         text NOT NULL,
  business_date   date NOT NULL,

  -- Revenue
  net_sales       numeric(14, 2) NOT NULL DEFAULT 0,
  gross_sales     numeric(14, 2) NOT NULL DEFAULT 0,
  tax_collected   numeric(14, 2) NOT NULL DEFAULT 0,
  service_charges numeric(14, 2) NOT NULL DEFAULT 0,
  discounts       numeric(14, 2) NOT NULL DEFAULT 0,
  voids           numeric(14, 2) NOT NULL DEFAULT 0,
  returns         numeric(14, 2) NOT NULL DEFAULT 0,

  -- Traffic
  check_count     integer NOT NULL DEFAULT 0,
  guest_count     integer NOT NULL DEFAULT 0,
  avg_check_value numeric(10, 2) NOT NULL DEFAULT 0,
  avg_guest_spend numeric(10, 2) NOT NULL DEFAULT 0,

  -- Labour
  labor_cost      numeric(14, 2) NOT NULL DEFAULT 0,
  labor_pct       numeric(6, 2)  NOT NULL DEFAULT 0,

  synced_at       timestamptz NOT NULL DEFAULT now(),
  raw_response    jsonb,

  UNIQUE (connection_id, loc_ref, business_date)
);

-- ── Quarter-hour sales intervals ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sales_intervals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref        text NOT NULL,
  business_date  date NOT NULL,
  interval_start time NOT NULL,
  interval_end   time NOT NULL,
  net_sales      numeric(10, 2) NOT NULL DEFAULT 0,
  check_count    integer NOT NULL DEFAULT 0,
  guest_count    integer NOT NULL DEFAULT 0,
  synced_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, loc_ref, business_date, interval_start)
);

-- ── Guest checks ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_guest_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref        text NOT NULL,
  check_number   text NOT NULL,
  business_date  date NOT NULL,
  opened_at      timestamptz,
  closed_at      timestamptz,
  table_number   text,
  server_name    text,
  guest_count    integer NOT NULL DEFAULT 1,
  net_total      numeric(10, 2) NOT NULL DEFAULT 0,
  gross_total    numeric(10, 2) NOT NULL DEFAULT 0,
  discounts      numeric(10, 2) NOT NULL DEFAULT 0,
  gratuity       numeric(10, 2) NOT NULL DEFAULT 0,
  payment_method text,
  status         text NOT NULL DEFAULT 'closed',
  synced_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, loc_ref, check_number, business_date)
);

-- ── Labour by job code ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_labor_daily (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid NOT NULL REFERENCES micros_connections(id) ON DELETE CASCADE,
  loc_ref        text NOT NULL,
  business_date  date NOT NULL,
  job_code       text NOT NULL DEFAULT '',
  job_name       text,
  employee_count integer NOT NULL DEFAULT 0,
  regular_hours  numeric(8, 2) NOT NULL DEFAULT 0,
  overtime_hours numeric(8, 2) NOT NULL DEFAULT 0,
  total_hours    numeric(8, 2) NOT NULL DEFAULT 0,
  labor_cost     numeric(14, 2) NOT NULL DEFAULT 0,
  synced_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, loc_ref, business_date, job_code)
);

-- ── Performance indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_micros_sync_runs_conn
  ON micros_sync_runs (connection_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_micros_sales_daily_date
  ON micros_sales_daily (connection_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_micros_intervals_date
  ON micros_sales_intervals (connection_id, business_date DESC, interval_start);

CREATE INDEX IF NOT EXISTS idx_micros_checks_date
  ON micros_guest_checks (connection_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_micros_labor_date
  ON micros_labor_daily (connection_id, business_date DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_micros_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_micros_connections_updated_at
  BEFORE UPDATE ON micros_connections
  FOR EACH ROW EXECUTE FUNCTION update_micros_connections_updated_at();

-- ── RLS: all MICROS tables are server-side only ───────────────────────────

ALTER TABLE micros_connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_sync_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_sales_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_sales_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_guest_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE micros_labor_daily    ENABLE ROW LEVEL SECURITY;

-- Service role (used by all server-side API routes) has full access.
-- Anon/authenticated roles have NO access — all reads go through API routes.

CREATE POLICY "micros_service_role_all" ON micros_connections
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "micros_service_role_all" ON micros_sync_runs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "micros_service_role_all" ON micros_sales_daily
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "micros_service_role_all" ON micros_sales_intervals
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "micros_service_role_all" ON micros_guest_checks
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "micros_service_role_all" ON micros_labor_daily
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
