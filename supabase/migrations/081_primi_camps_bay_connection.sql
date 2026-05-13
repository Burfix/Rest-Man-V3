-- =============================================================================
-- Migration 081: Primi Camps Bay MICROS Connection
-- =============================================================================
--
-- Idempotently creates / updates:
--   1. The Primi Camps Bay site row (already exists from migration 075,
--      but we ensure all required columns are present).
--   2. A micros_connections row for Primi Camps Bay, linked to the site.
--      Status starts as 'pending' — it becomes 'connected' once a live
--      token test passes via GET /api/integrations/micros/test-token.
--   3. Adds a location_key TEXT column to micros_connections so each row
--      carries its stable registry key ('si-cantina', 'primi-camps-bay').
--
-- The micros_location_ref is seeded from the known placeholder value.
-- It must be replaced with the real Oracle locRef once Primi goes live.
-- =============================================================================

-- ── 1. Add location_key column (idempotent) ───────────────────────────────

ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS location_key TEXT;

COMMENT ON COLUMN micros_connections.location_key IS
  'Stable registry key matching lib/micros/micros-location-registry.ts '
  '(e.g. ''si-cantina'', ''primi-camps-bay'').';

-- ── 2. Backfill Si Cantina connection (if it exists without a location_key) ──

UPDATE micros_connections
   SET location_key = 'si-cantina'
 WHERE location_key IS NULL
   AND (
     location_name ILIKE '%si cantina%'
     OR org_identifier IN ('SCS', 'SIC')
     OR site_id = '00000000-0000-0000-0000-000000000001'
   );

-- ── 3. Ensure Primi Camps Bay site is present ────────────────────────────

INSERT INTO sites (id, name, store_code, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  'Primi Camps Bay',
  'PCB',
  false
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name;

-- ── 4. Add 'pending' to allowed status values (before INSERT needs it) ───

ALTER TABLE micros_connections
  DROP CONSTRAINT IF EXISTS micros_connections_status_check;

ALTER TABLE micros_connections
  ADD CONSTRAINT micros_connections_status_check
    CHECK (status IN ('awaiting_setup', 'pending', 'connected', 'syncing', 'stale', 'error'));

-- ── 5. Upsert Primi Camps Bay micros_connections row ──────────────────────
--
-- We use a DO UPDATE so this migration is safe to re-run.
-- The real locRef and org details will be confirmed once the env vars are
-- set and a token test passes.
--
-- auth_server_url / app_server_url / client_id / org_identifier are seeded
-- from the known values; the actual live values come from env vars at
-- runtime (read by micros-location-registry.ts).

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
  'Primi Camps Bay',
  'primi-camps-bay',
  '00000000-0000-0000-0000-000000000003',
  '',                                                              -- to be set from MICROS_PRIMI_CAMPS_BAY_LOCATION_REF at sync time
  'https://ors-idm.msaf.oraclerestaurants.com',
  'https://simphony-home.msaf.oraclerestaurants.com',
  'UFJJLmQ1Zjg3YjNlLWM4MmItNDM0ZC05OTZlLWM5NzVlZjVjN2VhYQ',    -- client ID (public, non-sensitive)
  'PRI',
  'pending',
  '',                                                              -- no username — uses client_credentials
  ''                                                               -- no password — uses client_credentials
)
ON CONFLICT (site_id) WHERE site_id IS NOT NULL
DO UPDATE
  SET location_name    = EXCLUDED.location_name,
      location_key     = EXCLUDED.location_key,
      auth_server_url  = EXCLUDED.auth_server_url,
      app_server_url   = EXCLUDED.app_server_url,
      client_id        = EXCLUDED.client_id,
      org_identifier   = EXCLUDED.org_identifier;

-- ── 6. Index for location_key lookups ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_micros_connections_location_key
  ON micros_connections (location_key)
  WHERE location_key IS NOT NULL;

COMMENT ON TABLE micros_connections IS
  'Per-store Oracle MICROS BIAPI connection config and sync state. '
  'Credentials (access_token, encrypted_password) are server-side only, '
  'never returned to client layers.';
