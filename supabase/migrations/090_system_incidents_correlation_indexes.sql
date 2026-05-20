-- =============================================================================
-- Migration 090: system_incidents — Correlation Indexes
-- =============================================================================
--
-- Adds two indexes missing from migration 080 that are required for
-- Tier-6 multi-site incident correlation queries.
--
-- What 080 already covers:
--   idx_system_incidents_site_created   → (site_id, created_at DESC)
--   idx_system_incidents_status_created → (status, created_at DESC)
--   idx_system_incidents_severity       → (severity, created_at DESC)
--
-- What is missing:
--   1. (source, created_at DESC)             — rolling-window same-source queries
--   2. (site_id, source, created_at DESC)    — composite for multi-site correlation
--
-- Column confirmed as `source TEXT NOT NULL` (not `source_key`).
-- =============================================================================

-- Index 1: same-source rolling-window queries
--   Used by: SELECT ... WHERE source = 'ops.revenue_stale' AND created_at >= $since
CREATE INDEX IF NOT EXISTS idx_system_incidents_source_created_at
  ON system_incidents (source, created_at DESC);

-- Index 2: composite for multi-site correlation
--   Used by: SELECT ... WHERE site_id IN (...) AND source = $key AND created_at >= $since
--   This is the hot path for correlateIncidents() — avoids a seq scan over all rows
--   when filtering to a site list + source within a rolling window.
CREATE INDEX IF NOT EXISTS idx_system_incidents_site_source_created_at
  ON system_incidents (site_id, source, created_at DESC)
  WHERE site_id IS NOT NULL;
