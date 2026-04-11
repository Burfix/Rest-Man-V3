# Phase 1 — Hardcoded Values Report

> Deliverable 5 of 6 — Multi-Tenant SaaS Foundation

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Hardcoded UUIDs (app code) | 7 files | CRITICAL |
| Hardcoded UUIDs (migrations/seeds) | 12 files | LOW (historical, immutable) |
| Hardcoded UUIDs (scripts) | 2 files | MEDIUM |
| Hardcoded business names | 8 files | HIGH |
| Hardcoded emails | 2 files | CRITICAL |
| Hardcoded URLs | 4 files | HIGH |
| Unguarded API routes | 5 routes | CRITICAL |

---

## 1. DEFAULT_SITE_ID — `"00000000-0000-0000-0000-000000000001"`

### App Code (MUST FIX)

| File | Line | Usage | Fix |
|------|------|-------|-----|
| `types/universal.ts` | 285 | `export const DEFAULT_SITE_ID` | Remove constant. Callers must pass explicit siteId from context. |
| `lib/constants.ts` | 80 | `export const DEFAULT_ORG_ID` | Remove constant. Callers must pass explicit orgId from context. |
| `lib/config/site.ts` | 34 | `const DEFAULT_SITE_ID` — used as function default | Remove default param. Require callers to pass siteId. |
| `lib/copilot/decision-store.ts` | 18 | Hardcoded fallback | Replace with `ctx.siteId` from caller. |
| `app/dashboard/page.tsx` | 126 | Dashboard site selection fallback | Use `ctx.siteIds[0]` from auth context. |
| `app/dashboard/forecast/page.tsx` | 44 | Forecast page fallback | Use `ctx.siteIds[0]` from auth context. |
| `app/api/sales/upload/route.ts` | 216 | Upload route fallback | Require `site_id` in request body; reject if missing. |

### Scripts (LOWER PRIORITY)

| File | Line | Usage | Fix |
|------|------|-------|-----|
| `scripts/manual-inventory-sync.ts` | 31 | Hardcoded site for manual use | Accept CLI arg or env var. |
| `scripts/manual-food-cost-sync.ts` | 26 | Same | Same. |

### Database Migrations (NO ACTION — historical records)

These are in applied migration files and cannot be changed retroactively:
`012`, `013`, `020`, `022`, `027`, `043`, `046`, `047`, `048`, `056`, `apply_migrations_010_to_015.sql`

---

## 2. Hardcoded Business Names

| File | Line | Value | Fix |
|------|------|-------|-----|
| `lib/constants.ts` | 6 | `VENUE_LOCATION = "V&A Waterfront, Silo District, Cape Town"` | Move to `sites.address` column (already exists). |
| `lib/micros/auth.ts` | 61 | `USER_AGENT = "SiCantinaConcierge/1.0"` | Change to `"ForgeStack/1.0"` or read from env. |
| `components/dashboard/ops/DashboardTopBar.tsx` | 230 | Venue name displayed | Read from site context. |
| `components/dashboard/UserProfile.tsx` | 45 | Location info | Read from site context. |
| `app/login/page.tsx` | 70 | Location info | Make generic or read from org config. |
| `lib/commandCenter.ts` | 531 | Comment referencing Si Cantina | Update comment text. |
| `components/dashboard/settings/MicrosSettingsCard.tsx` | 323 | Placeholder text | Make generic placeholder. |
| `app/api/debug-bookings/route.ts` | 15 | `sicantinasociale.co.za/api/reservations` | Remove debug route or parameterise per site. |

---

## 3. Hardcoded Emails

| File | Line | Value | Severity | Fix |
|------|------|-------|----------|-----|
| `lib/admin/helpers.ts` | 10 | `SUPER_ADMIN_EMAIL = "newburf@gmail.com"` | **CRITICAL** | Move to `PLATFORM_ADMIN_EMAIL` env var. `isSuperAdmin()` should check role only. |
| `services/notifications/maintenanceNotifications.ts` | 18 | `NOTIFY_EMAIL = "burfix@gmail.com"` | HIGH | Move to per-org notification config or env var. |

Fallback emails (`onboarding@resend.dev`) in notification services are acceptable as defaults but should be configurable per org.

---

## 4. Hardcoded URLs

| File | Line | Value | Fix |
|------|------|-------|-----|
| `app/login/actions.ts` | 78 | `https://si-cantina-concierge.vercel.app` | Use `NEXT_PUBLIC_APP_URL` env var. |
| `app/api/admin/users/route.ts` | 118 | Same URL | Same fix. |
| `app/api/admin/users/[id]/resend-invite/route.ts` | 46 | Same URL | Same fix. |
| `scripts/manual_sync.js` | 60,64 | Hardcoded sync URLs | Use env vars. |

---

## 5. Unguarded API Routes (No Authentication)

| Route | Method | Risk | Fix |
|-------|--------|------|-----|
| `GET /api/actions/performance` | GET | Exposes action metrics | Add `apiGuard()`. |
| `GET /api/micros/diagnose` | GET | Exposes Micros config | Add `apiGuard("manage_integrations")`. |
| `GET /api/micros/status` | GET | Exposes integration status | Add `apiGuard()`. |
| `POST /api/micros/test-connection` | POST | Allows unauthenticated Micros connection test | Add `apiGuard("manage_integrations")`. |
| `GET /api/debug-bookings` | GET | Exposes booking data with external API URL | Remove or add `apiGuard("super_admin")`. |

---

## 6. Cross-Tenant Data Leaks (Unscoped Queries)

These are service functions that query tables without `site_id` filtering:

| Module | Files Affected | Tables | Fix Priority |
|--------|---------------|--------|--------------|
| Compliance | `services/ops/complianceSummary.ts`, `services/ops/dataFreshness.ts`, `services/ops/operatingScore.ts`, `services/ops/consequences.ts`, `services/intelligence/context-builder.ts`, `app/api/compliance/items/route.ts`, `app/api/compliance/items/[id]/route.ts` | `compliance_items`, `compliance_documents` | P0 — any user can CRUD any site's compliance data |
| Revenue/Forecast | `services/revenue/forecast.ts`, `lib/forecast/inputs.ts` | `historical_sales`, `daily_operations_reports`, `events` | P0 — financial data across all sites |
| Actions | `lib/copilot/action-impact.ts`, `services/execution/actionWorkflow.ts` | `action_events` | P1 — no site_id column exists on this table |

---

## Remediation Priority

### Phase 1 (This migration — already addressed)
- ✅ Remove `DEFAULT` UUID values from 13 DB columns (migration 058)
- ✅ Create `tenant_modules` table for per-org module gating
- ✅ Enhanced `apiGuard()` with site access + module validation
- ✅ `requireSiteAccess()` and `requireRole()` guard functions

### Phase 2 (Next sprint)
1. Replace `DEFAULT_SITE_ID` / `DEFAULT_ORG_ID` constants with context-derived values
2. Add `apiGuard()` to 5 unguarded routes
3. Add `site_id` filters to all compliance and revenue queries
4. Move `SUPER_ADMIN_EMAIL` to env var
5. Replace hardcoded URLs with `NEXT_PUBLIC_APP_URL`

### Phase 3 (Following sprint)
1. Add `site_id` column to `action_events` table
2. Add proper RLS policies (replace `USING(true)`)
3. Move business names to site/org config
4. Parameterise notification emails per org
