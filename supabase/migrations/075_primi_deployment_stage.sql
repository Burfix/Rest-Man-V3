-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 075: Primi deployment stage + data cleanup
--
-- Changes:
--   1. Add deployment_stage column to sites table
--   2. Mark Primi Constantia and Primi Camps Bay as 'partial' (POS not live yet)
--   3. Restrict Primi Constantia allowed_routes (was NULL — unrestricted)
--   4. Delete stale store_snapshots seed data for Primi site IDs
--      (Migration 020 seeded these as "Si Cantina Gardens" and
--       "Si Cantina Stellenbosch"; migration 048 repurposed the IDs to Primi)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add deployment_stage to sites ─────────────────────────────────────────

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS deployment_stage TEXT NOT NULL DEFAULT 'live'
    CHECK (deployment_stage IN ('live', 'partial', 'pending'));

COMMENT ON COLUMN sites.deployment_stage IS
  'Deployment readiness: live = fully operational with live POS/data, '
  'partial = some modules awaiting data or integration, '
  'pending = site exists in DB but not yet deployed to operators.';

-- ── 2. Mark Primi sites as partial ───────────────────────────────────────────

UPDATE sites
   SET deployment_stage = 'partial'
 WHERE id IN (
   '00000000-0000-0000-0000-000000000002',  -- Primi Constantia
   '00000000-0000-0000-0000-000000000003'   -- Primi Camps Bay
 );

-- ── 3. Restrict Primi Constantia routes (was NULL = unrestricted) ─────────────

UPDATE sites
   SET allowed_routes = ARRAY[
     '/dashboard',
     '/dashboard/daily-ops',
     '/dashboard/maintenance',
     '/dashboard/compliance',
     '/dashboard/access-restricted'
   ]
 WHERE id = '00000000-0000-0000-0000-000000000002'  -- Primi Constantia
   AND allowed_routes IS NULL;

-- ── 4. Delete stale store_snapshots seed data for Primi site IDs ─────────────
--
-- These rows were seeded in migration 020 when these site IDs belonged to
-- "Si Cantina Gardens" and "Si Cantina Stellenbosch". They must not appear
-- in Primi's Head Office view.

DELETE FROM store_snapshots
 WHERE site_id IN (
   '00000000-0000-0000-0000-000000000002',  -- now Primi Constantia
   '00000000-0000-0000-0000-000000000003'   -- now Primi Camps Bay
 );
