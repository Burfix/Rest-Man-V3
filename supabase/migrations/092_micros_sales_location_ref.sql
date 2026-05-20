-- Migration 092: Add sales_location_ref to micros_connections
--
-- Root cause: Oracle MICROS BI uses DIFFERENT location hierarchies for
--   getGuestChecks  (revenue/sales)  → enterprise revenue-center location ID
--   getTimeCardDetails (labour)       → employee/labour location ID
--
-- For most sites these are the same value. For Primi Camps Bay they differ:
--   loc_ref              = 101003  (valid for getTimeCardDetails / labour)
--   sales_location_ref   = ???     (set this to the correct Oracle revenue-center ref)
--
-- When sales_location_ref IS SET, MicrosSyncService uses it for getGuestChecks.
-- When NULL, MicrosSyncService falls back to loc_ref (existing behaviour).

ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS sales_location_ref text;

COMMENT ON COLUMN micros_connections.sales_location_ref IS
  'Optional separate Oracle BI location ref for getGuestChecks (sales). '
  'Override when Oracle uses a different location hierarchy for sales vs labour. '
  'When NULL, the main loc_ref is used for both sales and labour syncs.';
