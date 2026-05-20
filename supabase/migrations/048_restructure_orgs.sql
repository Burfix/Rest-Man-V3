-- ============================================================
-- Migration 048: Restructure into two organisations
--
--   Org 0001  "Si Cantina"  →  Sociale  +  Test Store (Sandbox)
--   Org 0002  "Primi"       →  Camps Bay  +  Constantia
-- ============================================================

-- ── 1. Rename organisations (swap slugs via temp to avoid unique conflict) ─────

-- Step A: org 0001 primi → temp slug
UPDATE organisations
   SET slug = 'si-cantina-temp'
 WHERE id = '00000000-0000-0000-0000-000000000001';

-- Step B: org 0002 si-cantina → primi (now free)
UPDATE organisations
   SET name = 'Primi', slug = 'primi'
 WHERE id = '00000000-0000-0000-0000-000000000002';

-- Step C: org 0001 temp → si-cantina (now free)
UPDATE organisations
   SET name = 'Si Cantina', slug = 'si-cantina'
 WHERE id = '00000000-0000-0000-0000-000000000001';

-- ── 2. Fix Si Cantina sites (org 0001) ─────────────────────────────────────────

-- Sociale: remove "(Test)" label, restore proper name + store code
UPDATE sites
   SET name       = 'Si Cantina Sociale',
       store_code = 'SC-SOC',
       address    = 'Silo District, V&A Waterfront',
       is_active  = true
 WHERE id = '00000000-0000-0000-0000-000000000001';

-- Test Store stays as-is under org 0001 (id ff01)

-- ── 3. Repurpose Gardens → Primi Constantia (org 0002) ─────────────────────────

UPDATE sites
   SET name            = 'Primi Constantia',
       store_code      = 'PRIMI-CN',
       address         = 'Constantia Main Road, Constantia',
       organisation_id = '00000000-0000-0000-0000-000000000002',
       region_id       = '00000000-0000-0000-0000-000000000020',
       is_active       = true
 WHERE id = '00000000-0000-0000-0000-000000000002';

-- Camps Bay: rename to Primi branding, stays under org 0002
UPDATE sites
   SET name       = 'Primi Camps Bay',
       store_code = 'PRIMI-CB'
 WHERE id = '00000000-0000-0000-0000-000000000003';

-- ── 4. Remove the cloned Sociale (no longer needed) ────────────────────────────

DELETE FROM user_site_access
 WHERE site_id = 'a0000000-0000-0000-0000-000000000001';

DELETE FROM sites
 WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- ── 5. Update region names for Primi org ───────────────────────────────────────

UPDATE regions
   SET name = 'Western Cape'
 WHERE id = '00000000-0000-0000-0000-000000000020'
   AND organisation_id = '00000000-0000-0000-0000-000000000002';
