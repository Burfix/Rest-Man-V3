# ForgeStack Ops Engine — Deployment Audit Report

**Date:** 2026-05-05  
**Auditor role:** Senior QA Engineer / CTO / Hospitality Operations Auditor  
**Build:** commit `6bc6c56` (main)  
**Live environment:** https://ops.forgestackafrica.dev  
**Scope:** Read-only static + code audit. No runtime execution, no DB mutations.

---

## 1. Executive Summary

The ForgeStack Ops Engine is a multi-tenant Next.js 14 (App Router) restaurant intelligence platform backed by Supabase/PostgreSQL and integrated with Oracle MICROS BI API. Two client organisations are configured in the database: **Si Cantina** (org `0001`) and **Primi** (org `0002`).

**Si Cantina** is in a production-grade state. Its POS integration (sales + labour via MICROS), compliance, maintenance, accountability, Head Office, and AI brain modules are all wired up. Neutral fallbacks prevent crashes when live data is briefly unavailable.

**Primi** is a database stub, not a live deployment. The Oracle MICROS integration is physically incapable of serving two concurrent sites; all sync traffic goes to a single hardcoded location reference. Primi's dashboard also inherits a dangerous `DEFAULT_SITE_ID` fallback that silently loads Si Cantina data under certain failure modes.

**Go / No-Go for Primi rollout: NO-GO.** Two blockers are critical (C1 and C2 below). Neither is a minor configuration tweak — both require code changes and infrastructure work.

---

## 2. Si Cantina — Module Status

| Module | Status | Notes |
|---|---|---|
| **Revenue (System Pulse)** | ✅ LIVE | MICROS sales sync active; pace-based scoring |
| **Labour** | ✅ LIVE | MICROS labour/timecard delta sync active |
| **Compliance** | ⚠️ PARTIAL | Tables and scoring engine exist; depends on `compliance_items` being seeded with real data |
| **Maintenance** | ⚠️ PARTIAL | Tables and API exist; depends on `maintenance_logs` and `equipment` rows |
| **Food Cost** | 🟡 FALLBACK | Defaults to 8/15 pts if `food_cost_snapshots` is empty; never shows true zero |
| **Inventory Risk** | 🟡 FALLBACK | Defaults to `riskScore = 7` and `riskLevel = "medium"` when no inventory data |
| **AI Brain** | ✅ LIVE | Contextualised by real revenue and labour data from MICROS |
| **Head Office** | ✅ LIVE | Multi-site summary views, risk flags, drilldown all scoped to org |
| **Accountability / Actions** | ⚠️ PARTIAL | Requires `action_daily_stats` rows; empty table = no actions shown |
| **Daily Report (Email)** | ✅ LIVE | Cron at midnight UTC triggers per-site report dispatch |
| **Heatmap** | ⚠️ PARTIAL | Falls back to `DEFAULT_SITE_ID` if `getUserContext()` fails |
| **Forecast** | ⚠️ PARTIAL | Falls back to `DEFAULT_SITE_ID` if `getUserContext()` fails |
| **GM Performance** | ⚠️ PARTIAL | `getGMPerformance()` defaults to `DEFAULT_SITE_ID` — must be called with explicit siteId |

**Overall Si Cantina Assessment:** Production-ready for core operations. Three modules (compliance, maintenance, accountability) will appear incomplete until operational data is seeded or recorded by staff.

---

## 3. Primi — Module Status

| Module | Status | Notes |
|---|---|---|
| **Revenue (System Pulse)** | ❌ FALLBACK | MICROS is a single global connection; cannot serve Primi (`loc_ref` points to Si Cantina) |
| **Labour** | ❌ FALLBACK | Same MICROS constraint — timecard sync goes to Si Cantina location only |
| **Compliance** | ❓ UNKNOWN | Requires a row in `compliance_users` table (separate from `user_roles`); not verified for Primi |
| **Maintenance** | ⚠️ PARTIAL | Schema exists; service is site-scoped; no Primi equipment seeded |
| **Food Cost** | 🟡 FALLBACK | Same as Si Cantina default — 8/15 pts regardless of actual data |
| **Inventory Risk** | 🟡 FALLBACK | Defaults to `riskScore = 7` |
| **AI Brain** | 🟡 FALLBACK | Will reason over fallback/neutral data; outputs will be misleading |
| **Head Office** | ⚠️ PARTIAL | Primi's two sites appear in DB; `v_site_health_summary` and org scoping work; but `store_snapshots` has no Primi rows post-migration 048 |
| **Accountability** | ❌ BROKEN | No `action_daily_stats` rows for Primi sites |
| **Daily Report** | ❓ UNKNOWN | Cron dispatches per `active` sites — depends on whether Primi sites are marked `is_active` |
| **Camps Bay Route Visibility** | ⚠️ LIMITED | `allowed_routes` restricts to `/dashboard`, `/dashboard/daily-ops`, `/dashboard/maintenance`, `/dashboard/compliance`, `/dashboard/access-restricted` only |
| **Constantia Route Visibility** | 🔴 OVER-EXPOSED | `allowed_routes = NULL` — Primi Constantia users can access ALL modules, including Head Office and Admin panel |
| **Dashboard Fallback** | 🔴 DATA LEAK RISK | If `getUserContext()` throws, dashboard silently loads Si Cantina Sociale data (see Critical Bug C2) |

**Overall Primi Assessment:** Primi is a database skeleton. Revenue and labour data will always be fallback/neutral. The dashboard has a cross-tenant data leak risk. **Not production-ready.**

---

## 4. Critical Bugs

### C1 — MICROS Single-Connection Architecture Blocks Multi-Tenancy

**File:** `lib/micros/config.ts`, `services/micros/MicrosSyncService.ts`, `app/api/micros/sync/route.ts`  
**Severity:** CRITICAL  
**Impact:** Primi cannot have any real POS data.

The `micros_connections` table has no `site_id` column. The system reads exactly one connection row (the newest), and all sync flows are routed to a single `MICROS_LOCATION_REF` env var. There is no mechanism to route different sync requests to different Oracle MICROS locations.

```
micros_connections (latest row only, no site_id)
    ↓
Single loc_ref (e.g. "2000002") → Si Cantina's MICROS instance
    ↓
micros_sales_daily, labour_timecards — all records belong to site 0001
```

Attempts to sync Primi will either overwrite Si Cantina data or produce no rows for Primi's site IDs. The sync API does accept an optional `loc_ref` parameter in the request body, but the authentication, connection metadata, and token are all shared — no per-site MICROS credentials are supported.

**Fix required:** Add `site_id` to `micros_connections`; support per-site MICROS credentials (separate `MICROS_CLIENT_ID`, `MICROS_ORG_SHORT_NAME`, `MICROS_LOCATION_REF` per site, or a connection-object lookup keyed on site_id).

---

### C2 — `DEFAULT_SITE_ID` Fallback Silently Exposes Si Cantina Data

**File:** [app/dashboard/page.tsx](../app/dashboard/page.tsx#L126), [app/dashboard/heatmap/page.tsx](../app/dashboard/heatmap/page.tsx#L20), [app/dashboard/forecast/page.tsx](../app/dashboard/forecast/page.tsx#L44)  
**Severity:** CRITICAL  
**Impact:** A Primi user whose session is broken, expired, or whose `getUserContext()` call throws will silently receive Si Cantina Sociale's full operational data.

```typescript
// app/dashboard/page.tsx
const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001"; // Si Cantina Sociale
let siteId = DEFAULT_SITE_ID;
try {
  const ctx = await getUserContext();
  siteId = ctx.siteId;
} catch {
  // fallback to DEFAULT_SITE_ID — Primi user now sees Si Cantina
}
```

The same pattern is repeated independently in `heatmap/page.tsx` and `forecast/page.tsx`. Additionally, `lib/copilot/decision-store.ts` and `services/ops/gmPerformance.ts` carry function-default variants of the same constant.

**Fix required:** Remove the `try/catch` silent fallback. Any failure in `getUserContext()` should result in a redirect to `/login` or an HTTP 401 response, not a fallback to a hardcoded site.

---

## 5. High-Risk Issues

### H1 — Row-Level Security Policies Are Broadly Permissive

**File:** `supabase/migrations/009_*.sql` (and repeated in 020, 030 series)  
**Severity:** HIGH  
**Impact:** Multi-tenancy is enforced entirely at the API layer. A single bug in an API route WHERE clause can leak all organisations' data.

```sql
-- Example from migration 020
CREATE POLICY "authenticated_all" ON store_snapshots
  FOR ALL TO authenticated USING (true);
```

This pattern (`USING (true)`) grants any authenticated Supabase user read/write access to every row in the table. The API routes correctly apply `WHERE organisation_id = ctx.orgId`, but this is a defence-in-depth failure: if any API route omits the org filter (accidental or otherwise), all tenants' data is returned.

**Risk:** The Head Office routes use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS entirely) with manual WHERE filters. A developer adding a new query route and forgetting the org filter would expose all orgs with no RLS backstop.

**Fix required:** Replace `USING (true)` policies with org-scoped policies using `auth.uid()` → `user_roles.organisation_id` lookups, at minimum for tables containing business-sensitive data (`store_snapshots`, `revenue_records`, `micros_sales_daily`, `labour_timecards`).

---

### H2 — Labour Fallback to Yesterday Is Silent

**File:** [app/dashboard/page.tsx](../app/dashboard/page.tsx) (approx. line 171)  
**Severity:** HIGH  
**Impact:** If today's labour summary is empty (e.g. sync hasn't run yet, or shift data isn't posted), the dashboard silently loads yesterday's labour data with no visual warning.

A GM checking labour cost at 9am after a late-night shift change may see stale figures and make staffing decisions based on them. There is no "data is from yesterday" badge on the Labour component of the System Pulse widget.

**Fix required:** When falling back to yesterday's data, pass a `dataDate` prop to the widget and render a "Data from {date}" badge.

---

### H3 — Primi Constantia Has No Route Restrictions

**File:** `supabase/migrations/056_site_module_visibility.sql`  
**Severity:** HIGH  
**Impact:** Primi Constantia users (`site_id = 0002`) can access every dashboard module, including Head Office (which shows all Primi sites), Admin panel, and the AI Brain. This is not consistent with a controlled rollout.

Primi Camps Bay correctly has `allowed_routes` restricted to 5 routes. Constantia has `allowed_routes = NULL` which means all routes pass through.

**Fix required:**
```sql
UPDATE sites
SET allowed_routes = ARRAY[
  '/dashboard',
  '/dashboard/daily-ops',
  '/dashboard/maintenance',
  '/dashboard/compliance',
  '/dashboard/access-restricted'
]
WHERE id = '00000000-0000-0000-0000-000000000002';
```

---

### H4 — `store_snapshots` Still Contains Old Si Cantina Seed Data for Repurposed Site IDs

**File:** `supabase/migrations/020_head_office.sql`  
**Severity:** HIGH  
**Impact:** Sites `0002` and `0003` were originally "Si Cantina Gardens" and "Si Cantina Stellenbosch" and were seeded with Si Cantina performance data. Migration 048 repurposed these site IDs to Primi Constantia and Primi Camps Bay, but the `store_snapshots` seed data was never updated.

This means:
- Head Office's "Primi Camps Bay" historical chart is actually showing *Si Cantina Stellenbosch* data (grades F, D — a permanently distressed store).
- Head Office's "Primi Constantia" chart is showing *Si Cantina Gardens* data.

**Fix required:** Delete or replace `store_snapshots` rows for site IDs `0002` and `0003` post-migration 048.

---

## 6. Misleading Data Risks

### M1 — Operating Score Shows Grade B/C With Zero Real Data

The new scoring engine awards neutral raw scores when the POS is connected but has no data for today:
- Revenue: `rawScore = 60` (neutral fallback when connected, no sales yet)
- Labour: `rawScore = 50` (neutral fallback)

A 60 × 0.45 + 50 × 0.30 = 27 + 15 = **42 weighted points** before compliance (15) and maintenance (10). Even before those, the System Pulse can show a `C` grade (≥40) with zero actual sales. Staff unfamiliar with the confidence badge may interpret this as a passing score.

The `confidence: "medium"` badge is rendered as "Partial data" in the widget — but it does not clearly communicate "no revenue data exists yet today".

**Recommendation:** When `revenuePacePct` cannot be calculated (no sales data), label the revenue bar explicitly as "Awaiting first sale" rather than showing a neutral bar fill.

---

### M2 — Food Cost Always Shows Partial Score Even Without Data

**File:** `services/ops/operatingScore.ts`  
The food cost supplementary component defaults to `rawScore = 8` out of 15 when `food_cost_snapshots` is empty. This score contributes to the overall impression of the widget even though it is not part of the main 100-point formula. A user reading the food cost bar at 8/15 may believe food cost has been measured and is slightly below target, when in fact no data has been recorded.

**Recommendation:** Show a "No data" state (grey, dashed) for food cost and inventory risk bars when the underlying tables are empty.

---

### M3 — AI Brain Reasons Over Fallback Data

The AI Brain/Copilot module generates text explanations and action recommendations based on the operating score components. When those components are fallbacks (revenue = neutral 60, labour = neutral 50, food cost = default 8/15), the AI will produce contextualised but factually incorrect insights, e.g. "Labour is tracking well at 50% efficiency" or "Revenue pace is on track".

For Primi, where all POS data is fallback, the AI Brain will confidently narrate fictional operational conditions.

**Recommendation:** Check `score.confidence` before rendering AI insights. If `confidence === "low"`, replace the AI narrative with "Awaiting live data — insights will appear once POS sync is active."

---

## 7. Missing Integrations

### I1 — MICROS Inventory Module (IM) Not Active

**Files:** `services/micros/inventory/sync.ts`, `lib/sync/adapters/micros-inventory.adapter.ts`  
The inventory sync code is written and tables are created (migration 059), but the feature is gated behind `MICROS_IM_ENABLED !== "true"`. Unless this environment variable is set, every inventory sync attempt immediately returns an error. Oracle MICROS IM requires a separate module licence.

**Impact:** `inventory_risk` component in the operating score is always a fallback. The heatmap cannot show real stock data.

---

### I2 — No Bookings / Reservations Integration

There is no connection to any reservations system (e.g. OpenTable, SevenRooms, ResX). The forecast module currently uses historical MICROS sales data only. Cover counts come from MICROS guest check data, not from advance reservations, so the forecast cannot account for large pre-booked parties.

**Impact:** Forecasting accuracy is limited to retrospective pattern matching. No proactive cover-count visibility for the GM.

---

### I3 — No Supplier / Purchase Order Integration

Food cost tracking relies on manual `food_cost_snapshots` entries. There is no connection to a procurement or supplier system. The fallback default (8/15 pts) will remain active until manual data entry begins.

---

## 8. Super Admin Visibility

| Check | Result |
|---|---|
| Super admin bypasses org filter in Head Office routes | ✅ PASS — `isSuperAdmin` check correctly removes all `WHERE organisation_id` constraints |
| Super admin sees all sites in Head Office summary | ✅ PASS — `v_stores` returns all active sites when called with service role |
| Super admin can drilldown into Primi sites | ✅ PASS — site drilldown validates site existence only, no org restriction for super admin |
| Si Cantina admin cannot see Primi | ✅ PASS — org filter `WHERE organisation_id = ctx.orgId` limits results to Si Cantina's org |
| Primi admin cannot see Si Cantina | ✅ PASS — same mechanism |
| Super admin in `user_roles` maps to `compliance_users` super admin | ⚠️ UNVERIFIED — `compliance_users` is a separate table with its own role column; a `super_admin` in `user_roles` may not have elevated rights in the compliance module if no corresponding `compliance_users` row exists |
| Super admin access to Admin panel | ✅ PASS — admin page checks `ctx.role === "super_admin"` via `getUserContext()` |
| Token/secret exposure in MICROS status endpoint | ✅ PASS — `password`, `id_token`, `refresh_token`, `access_token` are all sanitised before response |

**Compliance module gap:** The compliance module uses a separate `compliance_users` table distinct from `user_roles`. A super admin whose account exists in `user_roles` but not in `compliance_users` will receive no elevated access in the compliance module. This should be verified against the production database for the super admin account.

---

## 9. Recommended Fixes in Priority Order

| # | Priority | Issue | File(s) | Effort |
|---|---|---|---|---|
| 1 | 🔴 CRITICAL | Remove `DEFAULT_SITE_ID` silent fallback — throw 401/redirect to login instead | `app/dashboard/page.tsx`, `heatmap/page.tsx`, `forecast/page.tsx` | 1h |
| 2 | 🔴 CRITICAL | Add `site_id` column to `micros_connections`; support per-site MICROS credentials | `lib/micros/config.ts`, new migration, env vars | 3–5 days |
| 3 | 🔴 HIGH | Delete/replace seed `store_snapshots` rows for site IDs `0002` and `0003` (now Primi) | New migration | 30m |
| 4 | 🔴 HIGH | Set `allowed_routes` restriction for Primi Constantia (`site_id = 0002`) | New migration | 15m |
| 5 | 🟡 HIGH | Add RLS org-scoped policies on sensitive tables (replace `USING (true)`) | New migration | 4h |
| 6 | 🟡 HIGH | Show "data from {date}" badge when labour falls back to yesterday | `app/dashboard/page.tsx`, `OperatingScoreWidget.tsx` | 2h |
| 7 | 🟡 MEDIUM | Suppress AI Brain narrative when `confidence === "low"` | `components/brain/` or `components/copilot/` | 1h |
| 8 | 🟡 MEDIUM | Show "No data" state (not fallback score bar) for food cost and inventory risk | `components/dashboard/ops/OperatingScoreWidget.tsx` | 2h |
| 9 | 🟡 MEDIUM | Revenue bar: label as "Awaiting first sale" when `revenuePacePct` is null | `lib/scoring/operatingScore.ts`, widget | 1h |
| 10 | 🟡 MEDIUM | Verify compliance module super admin row exists in `compliance_users` | DB check only | 30m |
| 11 | 🟢 LOW | Remove `DEFAULT_SITE_ID` default from `getGMPerformance()` and `decision-store.ts` — require explicit siteId | `services/ops/gmPerformance.ts`, `lib/copilot/decision-store.ts` | 1h |
| 12 | 🟢 LOW | Enable MICROS IM module once Oracle licence provisioned (`MICROS_IM_ENABLED=true`) | Env config + Oracle licensing | — |
| 13 | 🟢 LOW | Add bookings/reservations integration for forecast accuracy | New integration layer | Weeks |

---

## 10. Go / No-Go Recommendation for Expanding Primi Rollout

### **VERDICT: NO-GO ❌**

**Blocking issues (must be resolved before Primi goes live):**

1. **MICROS single-connection architecture** (C1) — Primi will never have real revenue or labour data until each site has its own MICROS connection credentials and the sync engine supports per-site routing. This is the single most significant infrastructure gap. Without it, the System Pulse for Primi is theatre.

2. **DEFAULT_SITE_ID cross-tenant data leak** (C2) — Under a broken or expired session, any Primi user will silently receive Si Cantina Sociale's full operational dashboard. This is a data privacy breach. It must be fixed before any real Primi staff are given accounts.

3. **Stale Si Cantina seed data in Primi site IDs** (H4) — The Head Office view for Primi will show historical data from Si Cantina Stellenbosch (which was a chronically failing store), misleading any exec using the multi-org dashboard. Fix is a simple migration.

4. **Primi Constantia route over-exposure** (H3) — Primi Constantia currently has zero route restrictions, meaning users there can access the Admin panel, Head Office, and all AI modules — none of which have real data for them.

**Conditions for GO:**

| Condition | Current State |
|---|---|
| MICROS per-site connection support | ❌ Not implemented |
| DEFAULT_SITE_ID fallback removed | ❌ Still in code |
| Seed data corrected for Primi site IDs | ❌ Still polluted |
| Primi Constantia route restrictions set | ❌ NULL (unrestricted) |
| Compliance module validated for Primi users | ❓ Unverified |
| Primi staff accounts created and tested | ❓ Unverified |

**Si Cantina** may continue to operate in production with its current configuration. Fixes #6–#11 above are recommended quality improvements but are not blocking.

---

*Report generated by static code analysis. No database state was read from the live environment. Findings based on migration history, source code, and service layer logic.*
