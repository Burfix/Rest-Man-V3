# Tier-1 Hardening — Implementation Notes

**Date:** 2025-05  
**Scope:** Pre-production hardening for Primi Camps Bay + Sea Castle Hotel rollout  
**Risk Level:** Low — all changes are additive or remove silent fallbacks (fail-closed)

---

## What Changed

### Fix 1 — Remove `DEFAULT_ORG_ID` / `DEFAULT_SITE_ID` Fallbacks

| File | Change |
|------|--------|
| `app/api/reports/weekly/route.ts` | Removed the env-var fallback that pushed `process.env.DEFAULT_ORG_ID` into the active-orgs list when the DB returned none. The existing `"No active organisations"` return path now fires unconditionally when the DB is empty. |

**Why:** The fallback was silently generating weekly reports for Si Cantina even if all organisations were deactivated. With multiple tenants, pulling from an env var is a misconfiguration risk — the DB is the source of truth.

**Rollback:** Add back `const envOrg = process.env.DEFAULT_ORG_ID; if (envOrg) orgIds.push(envOrg);` after the empty-check.

---

### Fix 2 — Per-Site MICROS Connection Isolation

| File | Change |
|------|--------|
| `services/micros/inventorySync.ts` | Added `.eq("site_id", siteId)` to the `micros_connections` query so the token cache seed always uses the connection for the requested site, not whichever row happens to be first in the DB. |
| `services/micros/inventory/sync.ts` | Replaced deprecated global `getMicrosConnection()` with `getMicrosConnectionBySiteId(siteId)`. Added `siteId` as a required first parameter. Removed the `store_id` fallback that queried `inventory_items` for a store_id and fell back to the Si Cantina UUID `00000000-0000-0000-0000-000000000001`. |

**Why:** With three sites now sharing the same database, a global `SELECT * FROM micros_connections LIMIT 1` will return a random site's connection. The inventory sync must always target the site it was invoked for.

**Callers of `syncInventoryFromMicros`:** This function was not called anywhere in the codebase at the time of this change (the active path is `syncMicrosInventory` in the same service). The signature was updated to require `siteId: string` as a breaking-change guard for any future callers.

**Rollback:** Revert the `.eq("site_id", siteId)` line in `inventorySync.ts`. Revert `syncInventoryFromMicros` signature and restore `getMicrosConnection()` import.

---

### Fix 3 — RLS Hardening Migration 088

**File:** `supabase/migrations/088_rls_tier1_hardening.sql`

Extends the work started in migration 083, which hardened 13 tables. Migration 088 covers the remaining 15 tables that still had `USING(true)` for the `authenticated` role.

| Table | Approach | Notes |
|-------|----------|-------|
| `zone_snapshots` | Direct `site_id` | `site_id NOT NULL` from migration 013 |
| `asset_service_history` | Direct `site_id` | Same |
| `action_events` | JOIN via `actions.site_id` | No direct site_id; SELECT allows NULL parent (legacy) |
| `sales_uploads` | Direct `site_id` | `site_id NOT NULL` backfilled in migration 043 |
| `forecast_runs` | Direct `store_id` | `store_id` is the site FK (named for historical reasons) |
| `reservations` | Add `site_id` nullable + backfill | All existing rows → Si Cantina Sociale |
| `events` | Add `site_id` nullable + backfill | Same |
| `maintenance_logs` | JOIN via `equipment.site_id` | No direct site_id |
| `historical_sales` | Add `site_id` nullable + backfill | Same |
| `sales_targets` | Add `site_id` nullable + backfill | Same |
| `forecast_snapshots` | Add `site_id` nullable + backfill | Same |
| `daily_operations_labor` | JOIN via `daily_operations_reports.site_id` | Scoped via parent DOR |
| `daily_operations_revenue_centers` | JOIN via `daily_operations_reports.site_id` | Same |
| `venue_settings` | Add `site_id` nullable + backfill | Authenticated read only; writes via service_role |
| `sales_items` | JOIN via `sales_uploads.site_id` | POS line items scoped via upload |

**Security model** (identical to migration 083):
- `fs_user_can_access_site(site_id)` — SECURITY DEFINER function checks `user_roles` for super_admin / site match / org match
- `service_role` bypasses all RLS (required for cron/sync workers)
- Legacy rows with `NULL site_id` use `site_id IS NULL OR fs_user_can_access_site(site_id)` so they remain visible without breaking existing queries

**Backfill note:** Tables that needed `site_id` added use Si Cantina Sociale UUID `00000000-0000-0000-0000-000000000001` for all existing rows. This is safe because the platform was single-tenant before migration 046.

**Rollback:** For each table:
```sql
DROP POLICY "auth_select_<table>" ON <table>;
DROP POLICY "auth_write_<table>"  ON <table>;
DROP POLICY "srole_full_<table>"  ON <table>;
CREATE POLICY "authenticated_all" ON <table>
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```
For new `site_id` columns:
```sql
ALTER TABLE <table> DROP COLUMN site_id;
```

---

## Verification Checklist

Run after applying changes:

```bash
# TypeScript
npm run typecheck

# Unit tests (should all pass)
npm test

# Lint
npm run lint

# Grep for remaining DEFAULT_SITE_ID / DEFAULT_ORG_ID usage in app code
grep -r "DEFAULT_SITE_ID\|DEFAULT_ORG_ID\|00000000-0000-0000-0000-000000000001" \
  --include="*.ts" --include="*.tsx" \
  app/ lib/ services/ \
  | grep -v "test\|spec\|\.test\.\|\.spec\.\|migration\|backfill\|// \|/\*" \
  | grep -v "node_modules"
# Expected: zero matches (or only comments / test fixtures)

# Grep for remaining USING(true) in authenticated policies
grep -A2 "CREATE POLICY" supabase/migrations/ -r \
  | grep -B1 "USING (true)" \
  | grep -v "service_role\|srole" \
  | grep -v "^--"
# Expected: zero matches
```

---

## Tables NOT Covered (intentional)

| Table | Reason |
|-------|--------|
| `user_roles` | Managed by Supabase Auth admin; service_role only |
| `organisations` | Read-only via API layer; no auth bypass risk |
| `sites` | Covered by migration 083 (§13) |
| `tenant_modules` | Service_role only; no user-facing reads |
| `micros_inventory_items/locations/groups` | Covered by migration 083 (§14) |
| `audit_logs` / `security_audit_log` | Insert-only for authenticated; service_role reads |

---

## Site UUIDs Reference

| Site | UUID | Org |
|------|------|-----|
| Si Cantina Sociale | `00000000-0000-0000-0000-000000000001` | Si Cantina (0001) |
| Primi Camps Bay | `00000000-0000-0000-0000-000000000003` | Primi (0002) |
| Sea Castle Hotel Camps Bay | `00000000-0000-0000-0000-000000000004` | Sea Castle (TBD) |
| Test Store (Sandbox) | `00000000-0000-0000-0000-00000000ff01` | Si Cantina (0001) |

---

## Already Hardened (Pre-Existing)

The following were already correct **before** this hardening pass:

- `app/dashboard/page.tsx` and all dashboard sub-pages — fail-closed via `AuthError` → `/login` redirect; shows "No site assigned" when `ctx.siteId` is absent
- `services/micros/MicrosSyncService.ts` — requires `{siteId, organisationId, microsLocationRef}`; cross-checks requested locRef vs DB; throws `SECURITY` error on mismatch
- `lib/micros/micros-location-registry.ts` — three separate builders per location; each reads its own env var prefix
- Migrations 081, 082 — inserted per-site `micros_connections` rows for Primi Camps Bay and Sea Castle
- Migration 083 — hardened 13 core tables (micros_connections, alerts, compliance, equipment, reviews, etc.)
- Migration 085 — `micros_sync_logs` site-scoped read policy
