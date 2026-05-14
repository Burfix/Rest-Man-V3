-- =============================================================================
-- Migration 086: Activate Sea Castle Hotel in Head Office Sites Overview
-- =============================================================================
--
-- Migration 082 inserted Sea Castle with is_active = false (intentionally
-- deferred pending first MICROS sync).  This migration activates the site
-- so that user_accessible_sites() RPC and v_site_health_summary return it,
-- making Sea Castle appear in the Head Office Sites Overview page.
--
-- Changes:
--   1. Set sites.is_active = true for Sea Castle (00000000-0000-0000-0000-000000000004)
--   2. Correct name to 'Sea Castle Hotel' (shorter canonical name)
--   3. Set store_code to 'SEA-CT'
--   4. Set slug = 'sea-castle' (guarded — column may not exist in all envs)
--   5. Ensure micros_connections row exists and mark status = 'pending'
--      (will auto-update to 'connected' after first successful sync)
-- =============================================================================

-- ── 1. Activate + correct the Sea Castle site row ────────────────────────────

UPDATE sites
SET
  is_active  = true,
  name       = 'Sea Castle Hotel',
  store_code = 'SEA-CT',
  updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000004';

-- ── 2. Set slug if column exists (idempotent) ────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sites' AND column_name = 'slug'
  ) THEN
    UPDATE sites
    SET slug = 'sea-castle'
    WHERE id = '00000000-0000-0000-0000-000000000004'
      AND (slug IS NULL OR slug = '');
  END IF;
END;
$$;

-- ── 3. Ensure micros_connections row is present (safe upsert) ────────────────
--
-- Migration 082 already created this row; this is a no-op if it exists.
-- If somehow absent, we recreate it in pending state so the sync can run.

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
  'Sea Castle Hotel',
  'sea-castle-camps-bay',
  '00000000-0000-0000-0000-000000000004',
  '2001002',
  '',   -- read from MICROS_AUTH_SERVER at runtime
  '',   -- read from MICROS_BI_SERVER at runtime
  '',   -- read from MICROS_CLIENT_ID at runtime
  '',   -- read from MICROS_ORG_SHORT_NAME at runtime
  'pending',
  '',   -- read from MICROS_USERNAME at runtime
  ''    -- read from MICROS_PASSWORD at runtime
)
ON CONFLICT (site_id) WHERE site_id IS NOT NULL
DO UPDATE
  SET location_name = 'Sea Castle Hotel',
      location_key  = 'sea-castle-camps-bay',
      loc_ref       = '2001002';

-- Note: status is intentionally NOT updated here.
-- If the backfill already ran and status = 'connected', keep it.
-- If still 'pending', the next sync will update it.

-- ── Verify ───────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_active boolean;
  v_name   text;
  v_code   text;
  v_conn   text;
BEGIN
  SELECT is_active, name, store_code INTO v_active, v_name, v_code
  FROM sites
  WHERE id = '00000000-0000-0000-0000-000000000004';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sea Castle site row not found — migration 082 may not have been applied.';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Sea Castle is_active is still false after update — check RLS or trigger conflicts.';
  END IF;

  SELECT status INTO v_conn
  FROM micros_connections
  WHERE site_id = '00000000-0000-0000-0000-000000000004'
  LIMIT 1;

  RAISE NOTICE 'Sea Castle activated: name=%, store_code=%, is_active=%, micros_status=%',
    v_name, v_code, v_active, COALESCE(v_conn, 'NO CONNECTION ROW');
END;
$$;
