-- =============================================================================
-- Migration 085: MICROS Sync Logs + System Health View
-- =============================================================================
--
-- Adds:
--   1. micros_sync_logs — one row per sync attempt per location/date.
--      Written by runLocationSync() on every success or failure.
--   2. v_micros_system_health — pre-aggregated view powering the
--      /dashboard/system-health/micros UI and health scoring engine.
--   3. RLS: service_role writes; authenticated reads own-site rows.
-- =============================================================================

-- ── 1. micros_sync_logs ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS micros_sync_logs (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now() NOT NULL,

  -- Scope
  site_id         uuid        REFERENCES sites(id)            ON DELETE SET NULL,
  connection_id   uuid        REFERENCES micros_connections(id) ON DELETE SET NULL,
  location_key    text,
  location_ref    text,

  -- What happened
  sync_type       text        NOT NULL DEFAULT 'full',  -- 'full' | 'sales_only' | 'labour_only' | 'backfill'
  business_date   date,

  -- Outcome
  status          text        NOT NULL,                 -- 'success' | 'partial' | 'error'
  duration_ms     integer,
  sales_records   integer     DEFAULT 0,
  labour_records  integer     DEFAULT 0,
  records_synced  integer     GENERATED ALWAYS AS (COALESCE(sales_records, 0) + COALESCE(labour_records, 0)) STORED,
  error_message   text
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_msl_site_id    ON micros_sync_logs (site_id)    WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msl_created    ON micros_sync_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msl_status     ON micros_sync_logs (status);
CREATE INDEX IF NOT EXISTS idx_msl_conn_date  ON micros_sync_logs (connection_id, business_date);

-- RLS
ALTER TABLE micros_sync_logs ENABLE ROW LEVEL SECURITY;

-- Service role can write
CREATE POLICY "service_role_all_micros_sync_logs"
  ON micros_sync_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own site's logs
CREATE POLICY "authenticated_read_own_site_micros_sync_logs"
  ON micros_sync_logs
  FOR SELECT
  TO authenticated
  USING (
    site_id IS NULL
    OR site_id IN (
      SELECT ur.site_id FROM user_roles ur WHERE ur.user_id = auth.uid()
    )
  );

-- ── 2. v_micros_system_health ─────────────────────────────────────────────

CREATE OR REPLACE VIEW v_micros_system_health AS
WITH

-- Latest sync log per connection
latest_sync AS (
  SELECT DISTINCT ON (connection_id)
    connection_id,
    status          AS latest_status,
    created_at      AS last_sync_at,
    duration_ms     AS last_duration_ms,
    error_message   AS last_error,
    sales_records   AS last_sales_records,
    labour_records  AS last_labour_records,
    business_date   AS last_business_date
  FROM   micros_sync_logs
  ORDER  BY connection_id, created_at DESC
),

-- Failures in last 24 h per connection
failures_24h AS (
  SELECT connection_id, COUNT(*) AS cnt
  FROM   micros_sync_logs
  WHERE  status = 'error'
    AND  created_at >= now() - interval '24 hours'
  GROUP  BY connection_id
),

-- Failures in last 7 d per connection
failures_7d AS (
  SELECT connection_id, COUNT(*) AS cnt
  FROM   micros_sync_logs
  WHERE  status = 'error'
    AND  created_at >= now() - interval '7 days'
  GROUP  BY connection_id
),

-- Average duration per connection (last 50 syncs)
avg_duration AS (
  SELECT
    connection_id,
    ROUND(AVG(duration_ms)) AS avg_duration_ms
  FROM (
    SELECT connection_id, duration_ms,
           ROW_NUMBER() OVER (PARTITION BY connection_id ORDER BY created_at DESC) AS rn
    FROM   micros_sync_logs
    WHERE  duration_ms IS NOT NULL
  ) sub
  WHERE rn <= 50
  GROUP BY connection_id
),

-- Today's totals per connection (SAST day = UTC+2)
today_totals AS (
  SELECT
    connection_id,
    SUM(sales_records)  AS sales_synced_today,
    SUM(labour_records) AS labour_synced_today,
    COUNT(*)            AS sync_count_today
  FROM   micros_sync_logs
  WHERE  created_at >= (current_date AT TIME ZONE 'Africa/Johannesburg')::timestamptz
  GROUP  BY connection_id
)

SELECT
  mc.id                                                            AS connection_id,
  mc.site_id,
  s.name                                                           AS site_name,
  mc.location_key,
  mc.loc_ref,
  mc.status                                                        AS connection_status,
  mc.last_successful_sync_at,
  mc.last_sync_at,
  mc.last_sync_error,
  -- Latest sync log data
  ls.latest_status,
  ls.last_sync_at                                                  AS log_last_sync_at,
  ls.last_duration_ms,
  ls.last_error,
  ls.last_sales_records,
  ls.last_labour_records,
  ls.last_business_date,
  -- Aggregates
  COALESCE(f24.cnt, 0)                                             AS failures_24h,
  COALESCE(f7.cnt, 0)                                              AS failures_7d,
  COALESCE(ad.avg_duration_ms, 0)                                  AS avg_duration_ms,
  COALESCE(tt.sales_synced_today, 0)                               AS sales_synced_today,
  COALESCE(tt.labour_synced_today, 0)                              AS labour_synced_today,
  COALESCE(tt.sync_count_today, 0)                                 AS sync_count_today,
  -- Data freshness
  CASE
    WHEN mc.last_successful_sync_at IS NULL THEN NULL
    ELSE ROUND(EXTRACT(EPOCH FROM (now() - mc.last_successful_sync_at)) / 60)
  END                                                              AS data_age_minutes
FROM  micros_connections mc
LEFT  JOIN sites          s   ON s.id   = mc.site_id
LEFT  JOIN latest_sync    ls  ON ls.connection_id = mc.id
LEFT  JOIN failures_24h   f24 ON f24.connection_id = mc.id
LEFT  JOIN failures_7d    f7  ON f7.connection_id  = mc.id
LEFT  JOIN avg_duration   ad  ON ad.connection_id  = mc.id
LEFT  JOIN today_totals   tt  ON tt.connection_id  = mc.id;

COMMENT ON TABLE micros_sync_logs IS
  'One row per MICROS sync attempt. Written by runLocationSync() on every success or failure. '
  'Powers v_micros_system_health and the /dashboard/system-health/micros page.';

COMMENT ON VIEW v_micros_system_health IS
  'Pre-aggregated MICROS health data per connection/site. '
  'Used by the system health API and health scoring engine. '
  'data_age_minutes = NULL means never synced.';
