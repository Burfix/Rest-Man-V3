-- ============================================================
-- Migration 067: v_risk_flags
--
-- PURPOSE:
--   A contract-layer view that aggregates actionable store-level
--   risk signals from already-computed contract views.
--   Powering the RiskRadarPanel on the Head Office dashboard.
--
-- SOURCE VIEWS (no raw tables queried):
--   v_site_health_summary — sync health, errors, sales freshness
--
-- TENANCY:
--   Filter by org_id in the API layer. RLS unchanged.
--
-- SEVERITY:
--   critical — immediate action required
--   warning  — attention needed before next service
--   info     — monitor only
-- ============================================================

DROP VIEW IF EXISTS v_risk_flags;

CREATE VIEW v_risk_flags AS

-- ── 1. Stale sync ─────────────────────────────────────────────────────────────
-- Store connected but no sync in last 24 h (data gap risk).
SELECT
  site_id,
  store_name,
  org_id,
  'stale_sync'                                                  AS issue_type,
  CASE
    WHEN stale_minutes > 2880 THEN 'No sync for ' || (stale_minutes / 60) || ' hours — data gap risk'
    ELSE 'No sync for ' || stale_minutes || ' minutes'
  END                                                           AS issue,
  CASE
    WHEN stale_minutes > 2880 THEN 'critical'
    ELSE 'warning'
  END                                                           AS severity,
  stale_minutes                                                 AS metric_value,
  'minutes since last sync'                                     AS metric_label
FROM v_site_health_summary
WHERE health IN ('warning', 'critical')
  AND stale_minutes IS NOT NULL
  AND integration_status != 'none'

UNION ALL

-- ── 2. Sync errors ────────────────────────────────────────────────────────────
-- Stores with repeated sync errors in the last 7 days.
SELECT
  site_id,
  store_name,
  org_id,
  'sync_errors'                                                 AS issue_type,
  recent_errors || ' sync error' || CASE WHEN recent_errors > 1 THEN 's' ELSE '' END || ' in last 7 days' AS issue,
  CASE
    WHEN recent_errors >= 5 THEN 'critical'
    WHEN recent_errors >= 2 THEN 'warning'
    ELSE 'info'
  END                                                           AS severity,
  recent_errors                                                 AS metric_value,
  'errors in 7 days'                                            AS metric_label
FROM v_site_health_summary
WHERE recent_errors > 0

UNION ALL

-- ── 3. No revenue data ────────────────────────────────────────────────────────
-- Active stores with no sales data in the last 3 days (revenue reporting risk).
SELECT
  site_id,
  store_name,
  org_id,
  'no_revenue_data'                                             AS issue_type,
  CASE
    WHEN last_sales_date IS NULL THEN 'No revenue data received'
    ELSE 'No revenue data since ' || last_sales_date::text
  END                                                           AS issue,
  'warning'                                                     AS severity,
  NULL::integer                                                 AS metric_value,
  NULL::text                                                    AS metric_label
FROM v_site_health_summary
WHERE is_active = true
  AND (
    last_sales_date IS NULL
    OR last_sales_date < (CURRENT_DATE - INTERVAL '3 days')::date
  )

UNION ALL

-- ── 4. Failed sync runs ───────────────────────────────────────────────────────
-- Stores with multiple failed sync runs in last 7 days.
SELECT
  site_id,
  store_name,
  org_id,
  'failed_runs'                                                 AS issue_type,
  failed_runs || ' failed sync run' || CASE WHEN failed_runs > 1 THEN 's' ELSE '' END || ' this week' AS issue,
  CASE
    WHEN failed_runs >= 3 THEN 'critical'
    ELSE 'warning'
  END                                                           AS severity,
  failed_runs                                                   AS metric_value,
  'failed runs this week'                                       AS metric_label
FROM v_site_health_summary
WHERE failed_runs > 1;

COMMENT ON VIEW v_risk_flags IS
  'Contract layer: per-store risk signals derived from v_site_health_summary. '
  'No raw table queries. Filter by org_id for tenant scoping. '
  'Sort by severity (critical first) and take top 10 for Risk Radar panel.';
