-- Migration 109: Fix profit_settings.target_labour_pct for restaurant sites
--
-- Context:
--   The previous default of 30% for Primi Camps Bay and Si Cantina Sociale was
--   the schema fallback value — never set intentionally. Operator confirmed 20%
--   is the target labour % for these two restaurant sites.
--
--   Sea Castle Hotel remains at 28% (already correct for a hotel property).
--
-- Target labour % by site:
--   SC-SOC  (Si Cantina Sociale)  → 20%
--   PRIMI-CB (Primi Camps Bay)    → 20%
--   SEA-CT  (Sea Castle Hotel)    → 28%  (unchanged)
--
-- Note: profit_settings.target_labour_pct takes priority over sites.target_labour_pct
-- in the profit engine (engine.ts > loadProfitSettings).

UPDATE profit_settings
SET
  target_labour_pct = 20.00,
  updated_at        = now()
WHERE site_id IN (
  '00000000-0000-0000-0000-000000000001',  -- Si Cantina Sociale
  '00000000-0000-0000-0000-000000000003'   -- Primi Camps Bay
);

-- Verify: confirm expected rows updated
DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM profit_settings
  WHERE site_id IN (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003'
  )
  AND target_labour_pct = 20.00;

  IF updated_count <> 2 THEN
    RAISE EXCEPTION 'Migration 109 validation failed: expected 2 rows with target_labour_pct = 20, found %', updated_count;
  END IF;
END $$;
