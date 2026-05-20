-- =============================================================================
-- Migration 082: Sea Castle Hotel Camps Bay MICROS Connection
-- =============================================================================
--
-- Sea Castle shares all Oracle MICROS auth credentials with Si Cantina
-- (same enterprise, same PKCE API account, same auth + BI servers).
-- Only the MICROS location reference differs: 2001002.
--
-- This migration idempotently creates:
--   1. Sea Castle site row in `sites`.
--   2. Sea Castle row in `micros_connections`, linked to the site.
--      Status starts as 'pending' — becomes 'connected' on first successful sync.
--   3. A unique constraint on (location_key) in micros_connections to prevent
--      duplicate registry entries.
--   4. A unique index on (loc_ref) WHERE loc_ref IS NOT NULL to enforce
--      per-location isolation at the DB layer.
--
-- Credentials are NOT stored in the DB — they are read from server-side
-- env vars at runtime (MICROS_* shared vars + MICROS_SEA_CASTLE_LOCATION_REF).
-- =============================================================================

-- ── 1. Ensure Sea Castle site exists ─────────────────────────────────────

INSERT INTO sites (id, name, store_code, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  'Sea Castle Hotel Camps Bay',
  'SCH',
  false
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name;

-- ── 2. Upsert Sea Castle micros_connections row ───────────────────────────
--
-- auth_server_url / app_server_url / client_id / org_identifier are seeded
-- with the known Si Cantina values; they are overridden at runtime by the
-- registry reading env vars.
--
-- The loc_ref '2001002' is the Sea Castle MICROS location reference.
-- It differs from Si Cantina to guarantee per-location data isolation.

INSERT INTO micros_connections (
  location_name,
  location_key,
  site_id,
  loc_ref,
  auth_server_url,
  app_server_url,
  client_id,
  org_identifier,
  status,
  username,
  encrypted_password
)
VALUES (
  'Sea Castle Hotel Camps Bay',
  'sea-castle-camps-bay',
  '00000000-0000-0000-0000-000000000004',
  '2001002',                                  -- Sea Castle MICROS location ref
  '',                                         -- shared: read from MICROS_AUTH_SERVER at runtime
  '',                                         -- shared: read from MICROS_BI_SERVER at runtime
  '',                                         -- shared: read from MICROS_CLIENT_ID at runtime
  '',                                         -- shared: read from MICROS_ORG_SHORT_NAME at runtime
  'pending',
  '',                                         -- shared: read from MICROS_USERNAME at runtime
  ''                                          -- shared: read from MICROS_PASSWORD at runtime
)
ON CONFLICT (site_id) WHERE site_id IS NOT NULL
DO UPDATE
  SET location_name = EXCLUDED.location_name,
      location_key  = EXCLUDED.location_key,
      loc_ref       = EXCLUDED.loc_ref;

-- ── 3. Unique constraint on location_key (prevents duplicate registry rows) ─

-- Location keys must be unique: one micros_connections row per registry entry.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'micros_connections_location_key_key'
  ) THEN
    ALTER TABLE micros_connections
      ADD CONSTRAINT micros_connections_location_key_key
      UNIQUE (location_key);
  END IF;
END $$;

-- ── 4. Unique index on loc_ref (prevents cross-site sync data leakage) ────
--
-- If two connections accidentally share the same loc_ref, every upsert into
-- micros_sales_daily / labour_daily_summary / labour_timecards would
-- produce indeterminate results.  Block it at the DB layer.

CREATE UNIQUE INDEX IF NOT EXISTS idx_micros_connections_loc_ref_unique
  ON micros_connections (loc_ref)
  WHERE loc_ref IS NOT NULL AND loc_ref <> '';

-- ── 5. Ensure loc_ref index for fast per-location lookups ─────────────────

CREATE INDEX IF NOT EXISTS idx_micros_connections_loc_ref
  ON micros_connections (loc_ref)
  WHERE loc_ref IS NOT NULL;

COMMENT ON TABLE micros_connections IS
  'Per-store Oracle MICROS BIAPI connection config and sync state. '
  'Credentials are server-side only (env vars); never returned to client layers. '
  'location_key maps to lib/micros/micros-location-registry.ts. '
  'loc_ref is unique per active connection to prevent cross-site data leakage.';
