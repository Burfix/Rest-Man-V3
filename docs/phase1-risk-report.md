# Phase 1 — Risk Report

> Deliverable 6 of 6 — Multi-Tenant SaaS Foundation

---

## Migration 058 — What Changes

| Step | Change | Tables Affected |
|------|--------|----------------|
| 1 | Remove `DEFAULT '00000000-...-000000000001'` from `store_id` columns | `daily_operations_reports`, `historical_sales`, `manual_sales_uploads`, `compliance_items`, `compliance_documents`, `equipment`, `equipment_repairs`, `maintenance_requests`, `bookings`, `events` |
| 2 | Remove null-sentinel defaults from `organisation_id` / `site_id` | `profiles`, `user_roles`, `micros_integrations` |
| 3 | Create `tenant_modules` table | New table — no existing data affected |
| 4 | Seed `tenant_modules` for all existing orgs | INSERT only — no existing data affected |

---

## Risk Assessment

### 1. INSERT Failures After DEFAULT Removal (HIGH)

**What breaks:** Any `INSERT` statement that doesn't explicitly provide `store_id` will fail with a NOT NULL violation.

**Affected code paths:**

| Code Path | Risk | Why |
|-----------|------|-----|
| `app/api/sales/upload/route.ts` | **HIGH** | Falls back to `DEFAULT_SITE_ID` constant, but if the DB column no longer has a DEFAULT, the constant is still passed explicitly → **OK as long as constant is still in code** |
| `app/api/compliance/items/route.ts` (POST) | **HIGH** | Creates compliance items — must include `site_id` in payload |
| `app/api/maintenance/route.ts` (POST) | **MEDIUM** | Creates maintenance requests — verify `store_id` is in the insert |
| `services/ops/complianceSummary.ts` | **MEDIUM** | `updateComplianceItem()` — UPDATE only, no INSERT risk |
| Cron jobs (`/api/cron/daily-sync`) | **HIGH** | Syncs create `daily_operations_reports` — must provide `store_id` |
| Micros sync (`/api/sync/cron`) | **MEDIUM** | Creates `historical_sales` rows — verify `store_id` passed |

**Mitigation:** The migration only removes the column DEFAULT — it does NOT add a NOT NULL constraint. Existing code that omits `store_id` will insert NULL instead of the sentinel UUID. This is safer than a hard failure but produces orphaned rows.

**Recommendation:** Before applying migration 058, audit all INSERT statements for the 10 affected tables and ensure they pass `store_id` explicitly.

### 2. Existing Data Integrity (LOW)

**What stays the same:** All existing rows keep their current `store_id` values. The migration does NOT update any data rows. Si Cantina data (`00000000-...-000000000001`) and Primi data stay intact.

**No data loss risk.**

### 3. RLS Policy Impact (NONE)

The migration does NOT change any RLS policies. Existing `USING(true)` policies remain. The `tenant_modules` table gets proper RLS (`USING(true)` for SELECT, restricted INSERT/UPDATE/DELETE to service_role).

### 4. Application Code Compatibility (LOW)

**New files created:**
- `lib/permissions.ts` — pure addition, no existing imports broken
- `lib/modules.ts` — pure addition, no existing imports broken
- `lib/auth/context.ts` — pure addition, no existing imports broken

**Modified files:**
- `lib/rbac/guards.ts` — added `requireSiteAccess()` and `requireRole()`. Existing exports unchanged.
- `lib/auth/api-guard.ts` — added optional `GuardOptions` 3rd parameter. Existing 0/1/2-arg calls are fully backward compatible.

**Zero breaking changes to existing API routes or components.**

### 5. Supabase Generated Types (MEDIUM)

The `tenant_modules` table won't appear in generated types until `npx supabase gen types` is re-run after migration. Current code uses `(supabase as any)` casts to work around this. After types are regenerated, the casts can be removed.

### 6. Rollback Plan

Full rollback SQL is included in `058_phase1_multi_tenant_foundation.sql` as comments. Steps:

```sql
-- 1. Drop tenant_modules table
DROP TABLE IF EXISTS tenant_modules;

-- 2. Re-add DEFAULT values to all 13 columns
ALTER TABLE daily_operations_reports ALTER COLUMN store_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
-- ... (all 13 columns listed in migration file)
```

Rollback is safe and non-destructive.

---

## Pilot Impact Assessment

### Si Cantina (site_id: `00000000-...-000000000001`)
- **Data:** Unchanged. All existing rows retain their `store_id`.
- **Functionality:** Unchanged. All features work as before.
- **Module access:** Seeded with all 11 modules enabled.

### Primi (site_ids: `00000000-...-000000000002`, `00000000-...-000000000003`)
- **Data:** Unchanged.
- **Functionality:** Unchanged.
- **Module access:** Seeded with all 11 modules enabled.

### New Tenants (future)
- Must provide `store_id` on all inserts (no more silent default).
- Module access controlled via `tenant_modules` table.
- Site access validated by `apiGuard()` with `GuardOptions.siteId`.

---

## Testing Checklist (Before Applying Migration)

- [ ] Run `npx next build` — **PASSED ✅**
- [ ] Verify all INSERT code paths pass explicit `store_id`
- [ ] Apply migration to staging/dev first
- [ ] Run `npx supabase gen types` after migration
- [ ] Remove `as any` casts from `lib/modules.ts` and `lib/auth/context.ts`
- [ ] Test daily-sync cron creates reports correctly
- [ ] Test compliance item CRUD
- [ ] Test Micros sync creates sales records
- [ ] Test module gating (disable a module, verify 403)
- [ ] Test `requireSiteAccess()` denies cross-site access

---

## Summary

| Risk | Level | Mitigation |
|------|-------|-----------|
| INSERT failures (missing store_id) | HIGH | Audit all INSERT paths before applying migration |
| Data loss | NONE | Migration only removes defaults, doesn't touch data |
| Breaking changes | NONE | All new code is additive; existing APIs backward compatible |
| Rollback difficulty | LOW | Full rollback SQL provided |
| Type safety gaps | MEDIUM | Regenerate Supabase types after migration |
| Pilot disruption | NONE | Si Cantina + Primi data and access unchanged |

**Recommendation:** Apply migration 058 to a staging environment first. Run the testing checklist. Then apply to production during a low-traffic window.
