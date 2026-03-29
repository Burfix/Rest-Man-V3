-- ============================================================
-- Migration 047: Clone Si Cantina production sites
--
-- Org 0001 "Si Cantina Restaurant Group" keeps its demo/test
-- sites (Sociale, Gardens, Stellenbosch, Test Sandbox).
--
-- Org 0002 "Si Cantina" gets real production sites:
--   • Si Cantina Sociale (V&A Waterfront)     — the flagship
--   • Si Cantina Camps Bay                     — already exists
--
-- This separates test/demo data from real client data.
-- ============================================================

-- ── Production sites under Si Cantina (org 0002) ────────────────────────────

-- Sociale (flagship) — new UUID, distinct from demo site 0001
INSERT INTO sites (id, name, site_type, address, city, timezone, organisation_id, region_id, store_code, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Si Cantina Sociale',
  'restaurant',
  'Silo District, V&A Waterfront',
  'Cape Town',
  'Africa/Johannesburg',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000020',
  'SC-SOC',
  true
) ON CONFLICT (id) DO NOTHING;

-- Camps Bay already exists as site 00000000-0000-0000-0000-000000000003
-- under org 0002 (from migration 046) — no action needed.

-- ── Grant super_admin access to new production site ─────────────────────────

INSERT INTO user_site_access (user_id, site_id) VALUES
  ('5fa15569-8415-4118-9d83-1fd7d8408963', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ── Label demo sites clearly as test ────────────────────────────────────────
-- Rename the demo sites under org 0001 so they are clearly test data

UPDATE sites SET name = 'Si Cantina Sociale (Test)'
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND organisation_id = '00000000-0000-0000-0000-000000000001';

UPDATE sites SET name = 'Si Cantina Gardens (Test)'
WHERE id = '00000000-0000-0000-0000-000000000002'
  AND organisation_id = '00000000-0000-0000-0000-000000000001';

-- Note: site 0003 (was Stellenbosch) was already overwritten to
-- "Si Cantina Camps Bay" under org 0002 in migration 046.

-- Rename the master org to clarify it's for testing
UPDATE organisations SET name = 'Si Cantina Restaurant Group (Test)'
WHERE id = '00000000-0000-0000-0000-000000000001';
