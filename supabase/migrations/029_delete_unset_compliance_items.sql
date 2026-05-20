-- ============================================================
-- Delete "Not Set Up" compliance items
-- Migration: 029_delete_unset_compliance_items.sql
--
-- Removes all compliance_items with no next_due_date configured
-- (these show as "Not Set Up" / status = unknown on the dashboard).
-- Also cleans up any associated documents and obligations.
-- ============================================================

-- Documents are cascaded automatically via ON DELETE CASCADE,
-- but obligations link via ON DELETE SET NULL — clean up explicitly.
delete from obligations
where compliance_item_id in (
  select id from compliance_items where next_due_date is null
);

-- Delete the items themselves
delete from compliance_items
where next_due_date is null;
