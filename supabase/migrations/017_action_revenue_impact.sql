-- Migration 017: Revenue impact tracking on action completion
-- Adds revenue snapshot columns to the actions table so we can measure
-- the sales delta between when an action was created and when it was resolved.

ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS revenue_before      numeric(14,2),
  ADD COLUMN IF NOT EXISTS revenue_after       numeric(14,2),
  ADD COLUMN IF NOT EXISTS revenue_delta       numeric(14,2),
  ADD COLUMN IF NOT EXISTS revenue_date_before date,
  ADD COLUMN IF NOT EXISTS revenue_date_after  date;

COMMENT ON COLUMN actions.revenue_before      IS 'sales_net_vat snapshot taken when the action was created';
COMMENT ON COLUMN actions.revenue_after       IS 'sales_net_vat snapshot taken when the action was completed';
COMMENT ON COLUMN actions.revenue_delta       IS 'revenue_after - revenue_before (positive = recovered, negative = declined)';
COMMENT ON COLUMN actions.revenue_date_before IS 'report_date of the before snapshot';
COMMENT ON COLUMN actions.revenue_date_after  IS 'report_date of the after snapshot';
