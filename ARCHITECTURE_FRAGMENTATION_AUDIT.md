# FORGESTACK AFRICA — ARCHITECTURE FRAGMENTATION AUDIT

**Sprint:** Architecture Consolidation  
**Phase:** 1 — Inventory (no code changes in this phase)  
**Date:** 2026-05-31  
**Prepared by:** Principal Platform Architect  
**Scope:** Full codebase — `app/`, `lib/`, `services/`, `components/`

---

## AUDIT SUMMARY

| Category | Total Instances | Critical Risks | Safe Now | Defer |
|----------|-----------------|----------------|----------|-------|
| Service-role client construction | 23 call sites | 3 | 20 | 0 |
| Supabase client patterns | 4 distinct patterns | 2 | 2 | 0 |
| MICROS sync entry points | 12 | 4 overlaps | 6 | 6 |
| Scheduler/cron routes | 7 vercel + 2 orphaned | 2 | 5 | 2 |
| Response envelope formats | 4 distinct patterns | 0 | — | All |
| `as any` casts | 200+ total | ~25 dangerous | ~175 type-gap | ~25 |
| Hardcoded pilot references | 14 | 3 | 8 | 3 |
| Direct site/org filtering | 3 patterns, 20+ sites | 2 | 3 | 0 |
| Duplicated health/status logic | 7 health endpoints | 2 | 5 | 0 |
| Tenant access helpers | 3 patterns, 20+ routes | 1 | — | — |

---

## 1. SERVICE-ROLE CLIENT CONSTRUCTION

### Factory (Approved Path)

**File:** `lib/supabase/service-role-client.ts`

```ts
export function getServiceRoleClient(): ReturnType<typeof createClient<Database>>
export const createServiceRoleClient = getServiceRoleClient; // alias — same singleton
```

Singleton pattern — correct. No per-request reconstruction. Validates env vars on first call. Documented allowed callers in header comment.

### Approved Call Sites (all using factory correctly)

| File | Risk |
|------|------|
| `app/api/admin/platform-health/route.ts` | ✅ cron/admin only |
| `app/api/cron/zombie-sync-cleanup/route.ts` | ✅ cron |
| `lib/monitoring/token-expiry.ts` | ✅ server-only lib |
| `lib/security/audit-log.ts` | ✅ write-only audit |
| `app/api/incidents/performance/route.ts` | ✅ admin, elevated roles |
| `app/api/incidents/sla-summary/route.ts` | ✅ admin |
| `app/api/incidents/weekly-report/route.ts` | ✅ admin |
| `app/api/system-health/checks/route.ts` | ✅ elevated roles guard |
| `app/api/system-health/sync-telemetry/route.ts` | ✅ elevated roles |
| `app/api/system-health/timeline/route.ts` | ✅ elevated roles |
| `app/api/intelligence/incident-clusters/route.ts` | ✅ elevated roles |
| `lib/compliance/queries.ts` | ✅ service layer |
| `lib/commercial/queries.ts` | ✅ service layer |
| `lib/incidents/guard.ts` | ✅ guard utility |
| `lib/micros/micros-location-registry.ts` | ✅ registry lookup |
| `lib/integrations/base/adapter.ts` | ✅ base class for adapters |
| `lib/audit/auditLog.ts` | ✅ audit writes |
| `app/api/admin/users/route.ts` | ✅ admin only |
| `app/api/head-office/sites/route.ts` | ✅ elevated roles |
| `app/api/head-office/site/[siteId]/route.ts` | ✅ elevated roles |
| `app/api/head-office/ops-center/route.ts` | ✅ elevated roles |
| `app/api/head-office/system-health/route.ts` | ✅ elevated roles |

### RISK ITEMS

**RISK-SR-01 — `services/execution/actionWorkflow.ts:26`**
```ts
// Module-level constant — initialized at module load, not per-request
const db = getServiceRoleClient() as any;
```
- **Risk:** Module is imported by user-facing action routes. Service-role in a user action context — every query must have an explicit `site_id` WHERE clause or data leaks cross-tenant.
- **Current pattern:** `as any` cast means no type enforcement on queries.
- **Recommended fix:** Audit every query in this module for explicit tenant scoping. Move to lazy init inside functions.
- **Safe to change now:** Audit only. Code change requires query-by-query review.

**RISK-SR-02 — `app/dashboard/layout.tsx:23`**
```ts
// Service-role client in a Next.js Server Component layout
const db = getServiceRoleClient() as any;
```
- **Risk:** Layout runs for every authenticated page render. Service-role bypasses RLS — if the query does not scope by `user_id` / `site_id`, it can surface cross-tenant data. Session-based client (`createServerClient()`) is the correct choice unless this query genuinely requires cross-tenant access.
- **Recommended fix:** Read the query, determine if it needs service-role. If not, replace with `createServerClient()`.
- **Safe to change now:** Audit the query first.

**RISK-SR-03 — `lib/rbac/guards.ts:16`**
```ts
// Raw import from @supabase/supabase-js with ANON key — bypasses factory
import { createClient } from "@supabase/supabase-js";
// Lines 54-55:
process.env.NEXT_PUBLIC_SUPABASE_URL!,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
```
- **Risk:** Bypasses the factory pattern entirely. Not service-role (uses anon key), but it creates its own client construction instead of using `createServerClient()` which handles cookies and auth context correctly.
- **Recommended fix:** Replace with `createServerClient()` from `@/lib/supabase/server`.
- **Safe to change now:** Yes — server-only context confirmed; swap is safe.

### Orphaned Script Patterns (Acceptable)

`scripts/probe-im-rna.ts` and `scripts/probe-im-soap.ts` construct raw `createClient` with `SERVICE_ROLE_KEY` directly. Acceptable for one-off diagnostic dev scripts, not production paths.

---

## 2. SUPABASE CLIENT CONSTRUCTION PATTERNS

Four distinct patterns exist:

| Pattern | Factory File | Used For | Correct? |
|---------|-------------|----------|----------|
| `createClient()` from `@/lib/supabase/client` | ✅ Browser factory | React client components | ✅ |
| `createServerClient()` from `@/lib/supabase/server` | ✅ Server factory | API routes, Server Components | ✅ |
| `getServiceRoleClient()` from `@/lib/supabase/service-role-client` | ✅ Service factory | Cron, admin, sync workers | ✅ |
| Raw `createClient` from `@supabase/supabase-js` | ❌ No factory | `lib/rbac/guards.ts` | ❌ |

**RISK-SC-01 — `app/api/internal/scheduler/tick/route.ts` uses `createServerClient()` in a cron route**
```ts
import { createServerClient } from "@/lib/supabase/server";
```
The scheduler tick is called by `sync-orchestrator` cron with `Bearer CRON_SECRET`. There is no user session in scope. `createServerClient()` reads auth cookies — in a cron invocation there are none. RLS policies will reject queries silently or return empty sets. Should use `getServiceRoleClient()` with explicit tenant scoping.
- **Safe to change now:** Yes — swap `createServerClient()` to `getServiceRoleClient()`. Verify all queries have WHERE clauses.

**RISK-SC-02 — `app/api/sync/cron/route.ts` uses `createServerClient()` in a cron route**

Same issue. Cron route with no user session using a session-based client.

---

## 3. MICROS SYNC ENTRY POINTS

**12 distinct paths** can trigger MICROS data ingestion. This is the single largest architectural risk — overlapping paths create redundant API calls, potential race conditions on upsert writes, and split observability.

### Complete Map

| Route | Trigger | Underlying Engine | Status |
|-------|---------|-------------------|--------|
| `GET /api/cron/daily-sync` | Vercel Cron 00:00 UTC | `runLocationSync` (V3) + `runLabourDeltaSync` directly | Active |
| `POST /api/cron/sync-orchestrator` | Vercel Cron 02:00 UTC | → `/api/internal/scheduler/tick` | Active |
| `POST /api/internal/scheduler/tick` | Via sync-orchestrator | `runSyncJobBatch` via `lib/scheduler/worker` | Active |
| `POST /api/micros/sync` | Manual / admin | Branches: `MicrosSyncService` (V1) OR `dispatchSync` (V3) | Active — dual-path |
| `POST /api/integrations/micros/sync` | Manual / admin | `runLocationSync` (V3) by locationKey | Active |
| `POST /api/sync/run` | Manual / user | `runSync` V2 adapter per siteId | Active |
| `GET /api/sync/cron` | NOT in vercel.json | `runSync` V2 per all active sites | Orphaned |
| `POST /api/system-health/micros/sync` | Admin | (investigate — may delegate) | Unknown |
| `POST /api/micros/labour-sync` | Admin | Labour delta sync | Active |
| `POST /api/micros/inventory-sync` | Admin | Inventory via MICROS | Active |
| `POST /api/inventory/micros-sync` | Admin | Inventory sync | Active |
| `POST /api/inventory/food-cost-sync` | Admin | Food cost sync | Active |

### Critical Risks

**RISK-SYNC-01 — `daily-sync` and `sync-orchestrator` overlap**
- `daily-sync` (midnight UTC) directly calls `runLocationSync` for all enabled locations in a background promise.
- `sync-orchestrator` (2am UTC) triggers scheduler tick which dispatches `runSyncJobBatch` — the same locations.
- Both write to `micros_sales_daily` via upsert. Data integrity is preserved (upsert), but MICROS API is called twice per site per day in the automated window.
- **Recommended fix:** `daily-sync` should only enqueue daily report async jobs. Remove the `runLocationSync` call from it. Let `sync-orchestrator` own all MICROS ingestion.

**RISK-SYNC-02 — `GET /api/sync/cron` not in `vercel.json`**
- This route is cron-protected but never scheduled. It uses the V2 sync engine (`runSync` per site) which is a different path than V3.
- **Recommended fix:** Confirm it is dead code. If so, remove. If it has manual use, document it clearly.

**RISK-SYNC-03 — Three concurrent sync service layers**
- V1: `MicrosSyncService` — original sync service with application-level zombie cleanup
- V2: `lib/sync/` adapters — typed adapter system with `microsSalesAdapter`, `microsLabourAdapter`
- V3: `lib/scheduler/` + `services/micros/location-sync` — orchestrated, lease-based, queue-driven
- All three are in active use. V3 is the production path and should be authoritative. V1 and V2 should be limited to manual/diagnostic use.
- **Do not decommission in this sprint.** Document ownership clearly in Phase 6.

**RISK-SYNC-04 — `/api/micros/sync` has dual-path branching**
```ts
if (rawBody.sync_type) {
  // V3 path: dispatchSync
} else {
  // V1 path: MicrosSyncService
}
```
Two code paths with different observability, error handling, and retry semantics depending on whether `sync_type` is supplied. Should be consolidated to always use V3.

---

## 4. SCHEDULER AND CRON ROUTES

### Vercel-Scheduled Crons (from `vercel.json`)

| Path | Schedule (UTC) | SAST Equivalent | Purpose |
|------|---------------|-----------------|---------|
| `/api/cron/daily-sync` | `0 0 * * *` | 02:00 | MICROS sync + daily report enqueue |
| `/api/accountability/calculate` | `0 1 * * *` | 03:00 | MPS score computation |
| `/api/cron/sync-orchestrator` | `0 2 * * *` | 04:00 | Scheduler tick trigger |
| `/api/cron/brain-dispatch` | `0 3 * * *` | 05:00 | AI brain dispatch |
| `/api/reviews/google-sync` | `0 6 * * *` | 08:00 | Google reviews |
| `/api/reports/weekly` | `0 6 * * 1` | Mon 08:00 | Weekly report |
| `/api/cron/zombie-sync-cleanup` | `0 * * * *` | Hourly | Zombie sync cleanup |

### Non-Scheduled Routes

| Path | Status |
|------|--------|
| `/api/sync/cron` | NOT in vercel.json — never auto-triggered. Orphaned. |
| `/api/system-health/jobs/run` | Manual admin trigger only |

**RISK-CRON-01 — `accountability/calculate` is outside `app/api/cron/` and uses wrong client**
- Route lives at `app/api/accountability/calculate/route.ts`, not in the `cron/` directory — visually indistinguishable from user-facing routes.
- Uses `createServerClient() as any` in a cron context (no session available).
- **Recommended fix:** Move to `app/api/cron/mps-calculate/route.ts`. Switch to `getServiceRoleClient()`.

**RISK-CRON-02 — Potential schedule conflict**
`daily-sync` (00:00 UTC) kicks off MICROS sync in a background promise. `sync-orchestrator` (02:00 UTC) triggers scheduler tick. If daily-sync background promise is still running when orchestrator fires, both are writing to MICROS tables simultaneously. Upserts protect correctness but observability shows conflated run counts.

---

## 5. RESPONSE ENVELOPE FORMATS

`lib/api/response.ts` exists with `ApiEnvelope<T>`, `jsonSuccess`, `jsonError`, `jsonCompatSuccess`, `jsonCompatError`. It is partially adopted.

### Pattern Inventory

**Pattern A — `jsonCompatSuccess/jsonCompatError` (partial adoption — backward compat)**
Routes: `head-office/summary`, `head-office/system-health`, `cron/zombie-sync-cleanup`
```ts
// Merges legacy flat keys with envelope:
return jsonCompatSuccess({ stores, accountability }, envelopedData, { meta });
// Consumer gets: { stores, accountability, data, error: null, meta }
```

**Pattern B — `jsonSuccess/jsonError` (clean envelope — new routes)**
Routes: `admin/platform-health`
```ts
return jsonSuccess(data, { meta });
// Consumer gets: { data, error: null, meta }
```

**Pattern C — Raw `NextResponse.json` with named keys (majority of routes)**
```ts
return NextResponse.json({ ok: true, enqueued, date: today }); // cron routes
return NextResponse.json({ data: stores, summary, error: null }); // health routes
return NextResponse.json({ stores: [], accountability: [] }); // summary error path
```
No envelope typing. Frontend must know each route's shape independently. Consumer can't distinguish route-level error from empty data.

**Pattern D — Mixed per status code**
Several routes return Pattern A on success, Pattern C on error — different shapes for different HTTP codes. Frontends must handle both.

### Routes NOT on Envelope (Platform-Critical, Phase 3 targets)

| Route | Current | Priority |
|-------|---------|----------|
| `system-health/checks` | Pattern C | HIGH |
| `system-health/sync-telemetry` | Pattern C | HIGH |
| `cron/daily-sync` | Pattern C | MEDIUM |
| `cron/brain-dispatch` | Pattern C | MEDIUM |
| `health/route.ts` | Pattern C | LOW (public uptime check) |
| `sync/run` | Pattern C | MEDIUM |

---

## 6. `as any` USAGE — CATEGORISED

Total `as any` in production code (excl. tests, scripts): ~200+

### Category 1 — Supabase Type Gap (~175 instances, harmless)

Pattern: `(supabase as any).from("table")` where table exists in DB but not in generated types.

Expected — generated types lag schema migrations. Safe as long as query result shape is correct.

Highest density: `services/decisions/alertEngine.ts` (28), `services/alerts/engine.ts` (16), `services/reports/weeklyReport.ts` (14), `services/reports/dailyReport.ts` (14).

**Recommended fix:** Regenerate `types/database.ts` after every migration batch. Don't chase individually.

### Category 2 — Unvalidated Result Cast (~25 instances, DANGEROUS)

Pattern: DB result cast to `any[]` then property-accessed without runtime check.

```ts
return ((data ?? []) as any[]).map((row: any) => ({
  siteId: row.site_id as string,  // undefined if schema changes — silent
}));
```

**Dangerous instances in platform-critical paths:**

| File | Cast | Risk |
|------|------|------|
| `app/api/admin/platform-health/route.ts` (lines 77, 124, 176, 182) | Sync staleness, zombie, MPS rows | HIGH |
| `lib/monitoring/token-expiry.ts` (line 129) | Token expiry connection rows | HIGH |
| `app/api/head-office/summary/route.ts` (10 casts) | Store rows | HIGH |
| `app/api/head-office/sites/route.ts` (8 casts) | Site cards | HIGH |
| `services/execution/actionWorkflow.ts` (module-level) | DB client | MEDIUM |
| `lib/security/audit-log.ts` (line 65) | Audit writes | MEDIUM |
| `app/api/accountability/calculate/route.ts` (line 204) | Score rows | MEDIUM |

**Recommended fix (Phase 4):** Add Zod schemas for DB row shapes in these modules. Validate at query boundary.

### Category 3 — Structural Insert/Update Cast (~5 instances, review)

Pattern: `supabase.from("x").insert(payload as any)` — papering over generated type mismatch on insert.

Valid if shape is correct. Should be replaced with typed insert interfaces when types are regenerated.

---

## 7. HARDCODED PILOT REFERENCES

### DANGEROUS — Remove with tests

| File | Line | Reference | Risk |
|------|------|----------|------|
| `app/api/head-office/sites/route.ts` | 26–27 | Hardcoded Si Cantina UUIDs for sandbox exclusion | Adding a 4th sandbox site requires code change |
| `app/api/head-office/summary/route.ts` | 89 | `.neq("store_code", "TEST-01")` | Magic store code in platform query |
| `lib/profit/engine.ts` | 795 | `.neq("store_code", "TEST-01")` | Same magic code in revenue path |

**Fix:** Add `is_sandbox boolean DEFAULT false` to `sites` table. Replace `.neq("store_code", "TEST-01")` with `.eq("is_sandbox", false)`.

### TEMPORARY OVERRIDE — Move to config

| File | Line | Reference |
|------|------|----------|
| `lib/demo/isSandboxSite.ts` | 17 | `storeCode === "TEST-01"` check |
| `lib/demo/getSandboxData.ts` | entire | Si Cantina as sandbox mirror reference |
| `components/dashboard/head-office/SiteOverviewCard.tsx` | 85 | `"Si Cantina"` as demo fallback label |
| `components/dashboard/ops/DashboardTopBar.tsx` | 234 | `"Si Cantina Sociale"` hardcoded in UI |

### SAFE — Document only (comments / examples / non-logic)

| File | Nature |
|------|--------|
| `lib/micros/location-auth.ts` lines 107, 292 | Auth flow labels in comments |
| `lib/micros/auth.ts` line 593 | Dev comment about SCS/Si Cantina vars |
| `lib/sync/simphony-client.ts` lines 118, 137 | Error message examples referencing `primi-camps-bay` |
| `app/api/reports/daily-ops/route.ts` lines 491, 493 | Pilot names in LLM prompt examples |
| `lib/copilot/service-window.ts` line 7 | Comment only |
| `lib/commandCenter.ts` line 531 | Comment only |

---

## 8. DIRECT SITE/ORG FILTERING LOGIC

Three access-gate patterns co-exist:

### Pattern A — `apiGuard()` (Recommended)

```ts
const guard = await apiGuard(PERMISSIONS.X, "POST /api/x");
if (guard.error) return guard.error;
const { ctx } = guard; // ctx.siteId, ctx.siteIds, ctx.role — validated
```

Used in: `sync/run`, `micros/sync`, `integrations/micros/sync`, `accountability/*`

### Pattern B — `getUserContext()` + manual role check (Inconsistent)

```ts
const ctx = await getUserContext();
if (!new Set(["super_admin", "head_office", ...]).has(ctx.role)) return 403;
```

Used in: `head-office/summary`, `head-office/system-health`, `admin/platform-health`, `incidents/*`

**RISK-FILTER-01 — `ELEVATED_ROLES` set defined inline in multiple routes**

Every route that uses Pattern B creates its own `Set(["super_admin", "head_office", "executive", ...])`. If `area_manager` is added as an elevated role, it must be updated in every route independently.

**Fix:** Export `ELEVATED_ROLES: ReadonlySet<UserRole>` from `lib/rbac/roles.ts`.

### Pattern C — Service-role query with manual site_id parameter (Risk if caller fails to validate)

Used in service-layer functions that accept a `site_id` arg and trust the caller validated it. Covered by RLS in DB but not in application layer.

**RISK-FILTER-02 — `head-office/summary` bypasses RPC in favour of direct `user_roles` lookup**

```ts
// head-office/summary/route.ts:6 comment:
// via a direct user_roles lookup — NOT via user_accessible_sites RPC.
```

Documented deviation — handles a GM user (Portia) edge case where RPC would over-include or under-include sites. This is pilot-specific logic in a platform route. Should be generalised or moved to the access helper.

---

## 9. DUPLICATED HEALTH/STATUS LOGIC

### Health Endpoint Map

| Endpoint | Auth | Audience | Data Source | Staleness Logic? |
|----------|------|----------|-------------|-----------------|
| `/api/health` | None | Uptime monitors | DB + scheduler ping | No |
| `/api/system-health` | Session | GM | Delegates to `/checks` | No |
| `/api/system-health/checks` | Elevated | GM/Admin | `micros_connections`, `sync_runs` | Yes (inline) |
| `/api/system-health/sync-telemetry` | Elevated | Admin | `micros_sync_runs` | Implied |
| `/api/system-health/timeline` | Elevated | Admin | Timeline events | No |
| `/api/head-office/system-health` | Head Office | Head Office | `v_site_health_summary` | Yes (inline) |
| `/api/admin/platform-health` | Admin/Cron | Engineering | All signals aggregated | Yes (inline) |

**RISK-HEALTH-01 — `classifyStaleness()` defined three times**

The GREEN/AMBER/RED staleness classification logic is implemented inline in:
- `app/api/admin/platform-health/route.ts` — thresholds: <30min GREEN, <120min AMBER, ≥120min RED
- `app/api/system-health/checks/route.ts` — similar but with different naming
- `app/api/head-office/system-health/route.ts` — implied via `v_site_health_summary` view logic

If thresholds need to change, they change in multiple places and can drift.

**Fix (Phase 5):** Move to `lib/observability/platform-health.ts` as `classifyStaleness(minutesSince: number | null): "GREEN" | "AMBER" | "RED"`.

**RISK-HEALTH-02 — Token expiry not wired into `system-health/checks`**

`lib/monitoring/token-expiry.ts` exports `getTokenExpiryReport()`. It is consumed by `admin/platform-health` and `head-office/system-health`. The `system-health/checks` endpoint has its own MICROS connection check that does NOT include token expiry — GMs see a different (incomplete) health picture than Head Office users.

### MICROS Status Overlap (3 routes with overlapping purpose)

| Route | Consumer | Purpose |
|-------|----------|---------|
| `/api/micros/status` | GM dashboard | Per-site connection status |
| `/api/integrations/micros/status` | Integration admin | Status by locationKey |
| `/api/admin/integrations/micros/health` | Engineering | Env var / config health |

These can be unified under a shared MICROS health service in Phase 5.

---

## 10. TENANT ACCESS HELPER USAGE

### Helper Inventory

| Helper | Source | Purpose |
|--------|--------|---------|
| `getUserContext()` | `lib/auth/get-user-context` | Reads session cookies, returns role/siteId/orgId/siteIds |
| `authErrorResponse(e)` | same | Produces 401/403 from `AuthError` |
| `apiGuard(perm, ctx)` | `lib/auth/api-guard` | `getUserContext()` + permission check in one call |
| `user_accessible_sites(uid)` | DB RPC | Returns `uuid[]` of sites accessible to user |
| `fs_user_can_access_site(site_id)` | DB function | Boolean gate for RLS |

### Pattern Inconsistency

20+ routes call `getUserContext()` directly. 10+ routes use `apiGuard()`. They are semantically equivalent but `apiGuard()` is more composable and adds permission checking. New routes should use `apiGuard()`.

**RISK-TENANT-01 — `getUserContext()` called without try/catch in some routes**

```ts
// RISKY — throws AuthError if session missing, producing 500 instead of 401:
const ctx = await getUserContext();

// CORRECT pattern:
try { ctx = await getUserContext(); }
catch (e) { if (e instanceof AuthError) return authErrorResponse(e); throw e; }
```

Routes in `incidents/` use the correct pattern. Some routes added recently do not. Fix is low-risk: wrap the call.

---

## CONSOLIDATED RISK REGISTER

| ID | Category | Severity | Phase | Safe Now |
|----|----------|----------|-------|----------|
| RISK-SR-02 | layout.tsx service-role | HIGH | 2 | Audit first |
| RISK-SR-03 | rbac/guards.ts raw createClient | HIGH | 2 | ✅ Yes |
| RISK-SC-01 | scheduler/tick session client | HIGH | 2 | ✅ Yes |
| RISK-SC-02 | sync/cron session client | MEDIUM | 2 | ✅ Yes |
| RISK-SYNC-01 | daily-sync + orchestrator overlap | HIGH | 6 | ✅ Yes |
| RISK-SYNC-02 | sync/cron orphaned | MEDIUM | 6 | ✅ Deprecate |
| RISK-SYNC-03 | 3 sync service layers | HIGH | 6 | Doc only |
| RISK-SYNC-04 | micros/sync dual-path | MEDIUM | 6 | ✅ Yes |
| RISK-CRON-01 | accountability/calculate session + wrong dir | MEDIUM | 2 | ✅ Yes |
| RISK-FILTER-01 | ELEVATED_ROLES not shared | HIGH | 3 | ✅ Yes |
| RISK-FILTER-02 | head-office/summary manual user_roles | LOW | 7 | Defer |
| RISK-HEALTH-01 | staleness classification duplicated | HIGH | 5 | ✅ Yes |
| RISK-HEALTH-02 | token expiry not in checks | MEDIUM | 5 | ✅ Yes |
| RISK-TENANT-01 | getUserContext unguarded | HIGH | 3 | ✅ Yes |
| Hardcoded TEST-01 filters | Pilot leak | MEDIUM | 7 | ✅ Yes |
| Hardcoded sandbox UUID array | Pilot leak | MEDIUM | 7 | ✅ Yes |
| `as any` in platform health/scoring | Type safety | HIGH | 4 | ✅ Yes |
| Response envelope inconsistency | Contract | MEDIUM | 3 | ✅ Yes |

---

## WHAT MUST NOT CHANGE WITHOUT TESTS

1. Any MICROS auth path (`lib/micros/auth.ts`, `lib/micros/location-auth.ts`)
2. Per-site credential isolation in `micros_connections` rows
3. `MicrosSyncService` internal sync flow
4. `runLocationSync` call chain and registry lookup
5. Scheduler tick job dispatching (`lib/scheduler/worker`, `lib/scheduler/claim`)
6. RLS policy `USING` clauses on any table
7. `fs_user_can_access_site()` DB function body
8. Revenue ingestion (`micros_sales_daily` write path)
9. Any route that currently has passing integration tests

---

*Audit complete — zero application code was changed in this phase.*
*ForgeStack Africa Engineering | Architecture Consolidation Sprint | Phase 1*

## Executive Summary

The platform already contains several strong consolidation points, but they are not yet enforced consistently. The largest architectural risk is that `lib/supabase/server.ts` is named like a session-aware server client while actually constructing a service-role client. That makes RLS bypass appear normal in user-facing routes and server components. A proper service-role factory already exists at `lib/supabase/service-role-client.ts`, but many critical routes still create service-role clients inline or through the misleading `createServerClient()` helper.

Scheduler ownership is also fragmented. There is a newer internal scheduler tick path (`/api/internal/scheduler/tick`) and a typed MICROS dispatch path (`lib/sync/orchestrator.ts`), but legacy cron/manual paths still directly execute sync logic. API responses are similarly inconsistent across `{ ok }`, `{ success }`, raw arrays, raw objects, and partial `{ data, error }` envelopes.

Recommended consolidation order:

1. Rename/split Supabase helpers so service-role and user-scoped clients cannot be confused.
2. Replace direct service-role construction with `getServiceRoleClient()` in server-only sync/admin contexts.
3. Move platform-critical API routes onto a typed envelope adapter without breaking existing frontend field names.
4. Consolidate platform health logic into one tenant-aware service.
5. Make `/api/internal/scheduler/tick` the scheduler owner and demote older cron paths to compatibility shims.

## 1. Service-Role Client Creation

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `lib/supabase/service-role-client.ts` | Canonical `getServiceRoleClient()` singleton using `SUPABASE_SERVICE_ROLE_KEY`. | Correct target exists but is not universally used. | Keep as target factory; add server-only import/static check in Phase 2. | Yes. |
| `lib/supabase/server.ts` | `createServerClient()` constructs a service-role Supabase client. | High. Misleading name encourages service-role use in user-facing APIs and server components, bypassing RLS. | Replace internals with import from `service-role-client`, then introduce clearly named user/session server client usage where required. | Partially. Alias first to avoid blast radius. |
| `lib/auth/get-user-context.ts` | Inline `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` for role/site lookup. | Medium. Legitimate privileged lookup, but duplicated construction. | `getServiceRoleClient()`, with role lookup scoped by authenticated `user.id`. | Yes, with auth regression tests. |
| `lib/incidents/guard.ts` | Local service-role factory for incident guard. | Medium. RLS bypass in write guard can leak if route scope is wrong. | `getServiceRoleClient()` plus typed incident access helper. | Yes, if incident tests pass. |
| `lib/micros/micros-location-registry.ts` | Inline service-role factory for MICROS location config. | Medium. Server-only and legitimate, but duplicate privileged path. | `getServiceRoleClient()`; keep MICROS auth/location behaviour unchanged. | Yes. |
| `lib/audit/auditLog.ts` and `lib/security/audit-log.ts` | Audit writes use service-role; `lib/security/audit-log.ts` already imports factory. | Low to medium. Audit writes are legitimate privileged writes; duplication remains in `lib/audit/auditLog.ts`. | Standardize both on `getServiceRoleClient()`. | Yes. |
| `lib/compliance/queries.ts`, `lib/commercial/queries.ts` | Local service-role construction in query modules. | High if used by user-facing routes without explicit tenant filters. | Prefer user-scoped client for user reads; otherwise factory plus explicit `site_id`/`organisation_id` contracts. | No until route consumers are checked. |
| `lib/intelligence/incident-correlator.ts` | Inline service-role factory for cross-site correlation. | Medium. Cross-site reads must be org/persona-scoped. | Factory plus explicit `organisationId`/authorised site list input. | Not until tenant-scoped tests exist. |
| `lib/integrations/base/adapter.ts` | Protected field creates service-role client directly. | Medium. Integration adapters may be legitimate workers, but base class hides RLS bypass. | Inject service-role client from factory or typed worker context. | Yes with adapter tests. |
| `app/dashboard/layout.tsx` | Server component creates service-role client directly. | High. User-facing render path uses RLS bypass. | Session/user-scoped client or `apiGuard` equivalent server helper. | Not without dashboard/site-switching regression. |
| `app/login/actions.ts` | Server action creates service-role client after sign-in. | Medium. Likely role/profile bootstrap; still duplicated service-role. | Factory with minimal role/profile query helper. | Yes, with login regression. |
| `app/api/head-office/sites/route.ts` | Inline service-role client for Head Office data. | High. Manual accessible-site filtering is the only tenant boundary. | Service layer with `authorisedSiteIds` input; response envelope adapter. | Partially after tests. |
| `app/api/head-office/system-health/route.ts`, `app/api/head-office/site/[siteId]/route.ts`, `app/api/head-office/ops-center/route.ts` | Local `serviceDb()` factories using `SUPABASE_SERVICE_ROLE_KEY`. | High. Critical executive views bypass RLS manually. | `lib/observability/platform-health.ts` and head-office query services. | Yes only after contract/tenant tests. |
| `app/api/admin/platform-health/route.ts`, `app/api/cron/zombie-sync-cleanup/route.ts`, `lib/monitoring/token-expiry.ts` | Already import `getServiceRoleClient()`. | Low. Correct direction, but response shapes are not standard. | Keep factory usage; move health logic to platform health service. | Yes. |
| `app/api/system-health/checks/route.ts`, `app/api/system-health/sync-telemetry/route.ts`, `app/api/system-health/timeline/route.ts` | Local service-role factories. | High. System-health reads include cross-site telemetry and must be persona-scoped. | `platform-health` service with authorised site list. | Not until persona tests exist. |
| `app/api/incidents/performance/route.ts`, `app/api/incidents/sla-summary/route.ts`, `app/api/incidents/weekly-report/route.ts`, `app/api/intelligence/incident-clusters/route.ts` | Local service-role factories. | Medium to high. Incident intelligence can cross site/org boundaries. | Shared incident intelligence service with `ctx.siteIds`/`ctx.orgId`. | Partial after tests. |
| `app/api/commercial/expenses/route.ts`, `app/api/admin/users/route.ts`, `app/api/admin/impersonate/status/route.ts` | Inline admin/service-role construction. | Medium. Admin operations legitimate but construction duplicated. | Factory plus stricter admin service modules. | Yes with RBAC tests. |
| `scripts/*` service-role usage | Operational scripts create service clients directly. | Low for runtime bundle, medium for drift. | Optional script helper wrapping factory or standalone script factory. | Defer; not production route risk. |

## 2. Supabase Client Construction

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `lib/supabase/client.ts` | Browser client using anon key. | Low. Correct for client components. | Keep. Add static check to prevent service-role imports into client files. | Yes. |
| `lib/supabase/user-scoped-client.ts` | `@supabase/ssr` client using anon key and cookies. | Low to medium. Correct idea, but cookie access uses `as any` due Next cookie typing. | Use for user-facing route handlers where RLS should apply. | Yes incrementally. |
| `lib/supabase/server.ts` | Service-role client exposed as `createServerClient()`. | Critical naming/ownership problem. | Rename or alias to `createServiceRoleClient()`; introduce `createUserScopedClient()` in user-facing routes. | Alias now; full migration later. |
| `lib/auth/api-guard.ts` | Returns `supabase: createServerClient()` after auth. | High. Guard gives user-facing routes a service-role client. | Return user-scoped Supabase client by default; expose service-role only through explicit admin/sync helper. | Not safe until route-by-route regression. |
| `services/**` | Many service modules call `createServerClient()`. | Mixed. Worker services may need service-role; user-facing services may not. | Split services into worker-only privileged services and user-scoped query services. | Inventory first; change selectively. |
| `app/api/**` | Mixed `apiGuard().supabase`, `createServerClient()`, inline service-role, browser-style clients. | High. Inconsistent tenant enforcement and response contracts. | Route handlers should do auth + response only; service layer receives `ctx` or authorised site IDs. | Critical routes first. |

## 3. MICROS Sync Entry Points

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `lib/sync/orchestrator.ts` | Typed `dispatchSync()` chokepoint using `SyncRequest` and connection lookup scoped by `site_id`. | Low. This is the desired direction. It still imports misleading service-role `createServerClient()`. | Keep as sync execution owner; switch to service-role factory only in worker/server contexts. | Yes with MICROS tests. |
| `lib/sync/engine.ts` with `app/api/sync/run` and `app/api/sync/cron` | V2 sync engine path using `runSync()` and adapters. | Medium. Parallel sync architecture beside `dispatchSync()`. | Decide whether V2 engine wraps `dispatchSync()` or remains only for non-MICROS generic sync. | Not without sync regression. |
| `app/api/micros/sync/route.ts` | Manual route supports new orchestrator path when `sync_type` is supplied, otherwise legacy `MicrosSyncService.runFullSync()`. GET cron path runs all connections directly. | High. Mixed manual/cron/sync execution logic in one route. | Route should trigger orchestrator only; legacy path stays as compatibility until tests prove replacement. | No for full removal; yes for response adapter. |
| `services/micros/MicrosSyncService.ts` | Legacy full sales/labour sync service. | Medium. Working pilot behaviour likely depends on it. | Preserve as MICROS service implementation behind orchestrator until replaced by tests. | Do not remove now. |
| `services/micros/location-sync.ts` | Per-location sync using registry/config, supports all registered location keys. | Medium. Important for Primi/Sea Castle credential isolation. | Treat as MICROS service implementation; ensure orchestrator owns triggering. | No behavioural change now. |
| `services/micros/labour/sync.ts` | Dedicated labour sync and delta sync path. | Medium. Separate from main sales sync and daily cron. | Keep execution service; orchestrator/scheduler should trigger it. | No behavioural change now. |
| `app/api/integrations/micros/sync/route.ts`, `app/api/system-health/micros/sync/route.ts`, `app/api/system-health/micros/backfill/route.ts` | Location-key based manual/test sync endpoints. | Medium. Useful operator tooling, but bypasses central ownership. | Convert to orchestrator-backed commands or explicitly classify as admin diagnostic routes. | Only after operator UI tests. |
| `app/api/inventory/food-cost-sync/route.ts`, `app/api/inventory/micros-sync/route.ts`, `app/api/micros/inventory-sync/route.ts` | Inventory/food-cost MICROS sync routes separate from sales/labour. | Medium. Different MICROS modules and auth assumptions. | Register as separate sync domains under scheduler ownership. | No immediate change. |
| `scripts/run-sync-primi.ts`, `scripts/run-sync-sea-castle.ts`, `scripts/backfill-*.ts` | Pilot-specific operational sync scripts. | Low runtime risk, high drift risk. | Keep as explicit pilot runbooks until scheduler fully owns same flows. | Do not remove now. |

## 4. Scheduler / Cron Routes

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `app/api/internal/scheduler/tick/route.ts` | Main internal scheduler: release stale leases, enqueue due sync jobs, claim/run sync jobs, claim/run async jobs. | Low. Good owner candidate. Response not standard envelope. | Keep as scheduler owner; wrap response in typed API envelope with compatibility fields if needed. | Yes after tests. |
| `lib/scheduler/sync-scheduler.ts`, `lib/scheduler/claim.ts`, `lib/scheduler/worker.ts`, `lib/scheduler/async-scheduler.ts` | Queue/schedule worker modules. | Low to medium. Good separation but uses `any` for new RPCs/tables. | Keep; replace dangerous casts with Zod schemas/RPC result types. | Yes. |
| `app/api/cron/sync-orchestrator/route.ts` | Thin shim forwarding to internal tick. | Low. Good pattern. | Keep as external cron shim. | Yes. |
| `app/api/cron/daily-sync/route.ts` | Cron route both starts background MICROS syncs and enqueues reports; POST sends report. | High. Violates ownership model: cron contains sync business logic. | Split: cron triggers scheduler/report enqueue only; sync work through orchestrator. | Not safe until daily report and sync tests. |
| `app/api/cron/brain-dispatch/route.ts` | Cron route dispatches operating brain/alerts. | Medium. Async job ownership unclear. | Register as async scheduler job type or document separate brain scheduler. | Later. |
| `app/api/cron/zombie-sync-cleanup/route.ts` | Cron route invokes cleanup function via canonical service-role client. | Low. Ownership clear as maintenance job. | Keep; include in platform health service. | Yes. |
| `app/api/sync/cron/route.ts` | Legacy cron directly loops active sites and runs sales sync via V2 engine. | High duplicate scheduler path. | Convert to shim or deprecate behind internal scheduler. | No until MICROS regression. |
| `app/api/micros/sync/route.ts` GET | Cron-style full sync for all connections directly in route. | High duplicate scheduler path. | Replace with scheduler/orchestrator trigger after parity tests. | No. |
| `app/api/bookings/reminders/run/route.ts`, `app/api/alerts/run/route.ts`, `app/api/actions/daily-reset/route.ts`, `app/api/accountability/calculate/route.ts` | Cron-like or batch routes outside scheduler namespace. | Medium. Ownership unclear; some support both user and cron auth. | Register job ownership map; move scheduled concerns to scheduler/async jobs. | Later. |

## 5. Response Envelope Formats

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `app/api/action-events/route.ts` | Already returns `{ data, error, meta }`. | Low. Closest to target envelope. | Use as compatibility reference. | Yes. |
| `app/api/head-office/summary/route.ts` | Returns raw summary object; errors use `{ error }`. | High for contract drift. | `apiSuccess(summary, meta)` plus compatibility adapter if frontend expects top-level fields. | Yes with frontend contract test. |
| `app/api/head-office/system-health/route.ts` | Returns `{ data, summary, tokenExpiry, error }`. | Medium. Near envelope but `summary/tokenExpiry` are top-level. | Envelope `data: { stores, summary, tokenExpiry }`; compatibility fields during transition. | Yes. |
| `app/api/admin/platform-health/route.ts` | Returns health object directly, likely `{ ok, ... }`/raw sections. | Medium. Admin consumers may couple to raw shape. | Envelope with meta; preserve existing top-level keys temporarily. | Yes. |
| `app/api/internal/scheduler/tick/route.ts` | Returns raw `SchedulerTickSummary`; errors `{ error, detail, tick_id }`. | Medium. Internal route but platform-critical. | Envelope `data: summary`, error code `SCHEDULER_TICK_FAILED`. | Yes. |
| `app/api/cron/sync-orchestrator/route.ts` | Proxies internal response directly; GET returns `{ ok, endpoint, method }`. | Low. Cron shim. | Proxy envelope after internal tick standardisation. | Later. |
| `app/api/sync/run/route.ts`, `app/api/sync/cron/route.ts`, `app/api/sync/status/route.ts` | `{ ok, ... }` and custom status maps. | Medium. Sync routes need typed result contract. | Envelope around existing sync result. | Yes with client compatibility. |
| `app/api/system-health/checks/route.ts`, `app/api/system-health/sync-telemetry/route.ts`, `app/api/system-health/timeline/route.ts` | Custom `ok` payloads and raw arrays. | Medium. System health UI couples to multiple bespoke shapes. | `platform-health` service + typed envelope. | Yes after UI tests. |
| `app/api/reviews/*`, `app/api/inventory/*`, `app/api/compliance/*`, `app/api/daily-ops/*` | Mixed raw arrays, `{ error }`, `{ ok }`, `{ success }`. | Medium outside Phase 3 critical path. | Later route-group migration. | Defer. |

## 6. `as any` Usage

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `app/api/head-office/summary/route.ts` | Route-level DB cast, role rows, site rows, MPS/tasks/maintenance/actions rows, `catch (err: any)`. | High. Dangerous contract bypass in head-office tenant and scoring logic. | Zod schemas for query rows and typed Head Office summary contract. | Yes in Phase 4 with tests. |
| `app/api/head-office/system-health/route.ts` | Service-role DB cast and untyped role rows. | High. Tenant-scoped health route. | Typed platform health row schema and authorised site resolver. | Yes after response contract. |
| `app/api/admin/platform-health/route.ts` | Multiple `supabase as any` queries and row maps. | High. Platform health correctness depends on these rows. | `platform-health` service with Zod row schemas. | Yes. |
| `app/api/system-health/checks/route.ts`, `app/api/system-health/sync-telemetry/route.ts`, `app/api/system-health/timeline/route.ts` | Service-role casts and untyped telemetry rows. | High. Cross-site observability. | Shared observability contracts. | Yes after service extraction. |
| `app/api/sync/status/route.ts` | Casts against `sync_runs` for type gaps. | Medium. Sync status route. | Explicit `SyncRunStatusRow` interface or generated Supabase types. | Yes. |
| `lib/sync/scheduler.ts`, `lib/scheduler/sync-scheduler.ts`, `lib/scheduler/claim.ts` | RPC/table type gaps; some Zod parsing already exists. | Medium. Scheduler correctness. | Local RPC result types and Zod schemas. | Yes. |
| `lib/monitoring/token-expiry.ts` | Service-role cast and row map. | Medium. MICROS token observability. | `TokenExpiryRecord` Zod schema. | Yes. |
| `lib/auth/get-user-context.ts`, `lib/auth/api-guard.ts` | Cookie typing and service-role/profile casts. | Medium. Auth context correctness. | Narrow cookie helper and typed role/site rows. | Yes with auth tests. |
| `services/reports/dailyReport.ts`, `services/reports/weeklyReport.ts` | Broad `eslint-disable no-explicit-any`. | Medium. Reports are not immediate platform route contracts, but data drift likely. | Typed report row contracts. | Defer after critical routes. |
| `components/**` UI state casts | UI-only `any` for component state/API payloads. | Low compared with tenant/sync/health contracts. | Generated API response types after envelope migration. | Defer. |

## 7. Hardcoded Pilot References

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `app/api/head-office/sites/route.ts` | Hardcoded Si Cantina UUIDs and sandbox mirror logic; excludes sandbox through `TEST-01` elsewhere. | High. Pilot/demo leakage in Head Office platform route. | Typed demo/sandbox config file or database flag; never live-route hardcoded UUIDs. | Not until Head Office tests. |
| `lib/demo/getSandboxData.ts`, `lib/demo/isSandboxSite.ts` | Mirrors Si Cantina metrics into demo site; identifies sandbox by `TEST-01`. | Medium. Demo behaviour should be isolated/configured. | `lib/config/demo-sites.ts` or database site flags. | Yes if Head Office route updated together. |
| `app/api/head-office/summary/route.ts`, `lib/profit/engine.ts` | `.neq("store_code", "TEST-01")`. | Medium. Magic sandbox exclusion. | Central `isSandboxSite`/site flags. | Yes with query tests. |
| `app/api/inventory/food-cost-sync/route.ts`, `scripts/manual-food-cost-sync.ts`, probe scripts | Fallback loc ref `"2000002"`. | High if production route. Could send wrong location to MICROS. | Require connection-scoped `loc_ref`; scripts may keep explicit runbook defaults only if labeled. | Route: yes with tests. Scripts: later. |
| `app/api/micros/labour-sync/route.ts`, `app/api/micros/sync/route.ts`, `app/api/micros/labour-upload/route.ts` | `MICROS_LOCATION_REF` fallback in body/config. | Medium. Global MICROS fallback can leak across sites. | Resolve by site/location registry only. | No until MICROS regression. |
| `lib/micros/auth.ts` | Comment says global `MICROS_*` env vars are SCS/Si Cantina; callers must use location token for others. | Medium. Known compatibility trap. | Keep legacy function internal; enforce `acquireLocationToken()` in new paths. | Do not alter auth now. |
| `lib/micros/location-auth.ts`, `lib/sync/simphony-client.ts`, `services/micros/labour/client.ts` | Comments and errors name Si Cantina, Primi, Sea Castle auth patterns. | Low. Documentation of real tenant-specific auth patterns. | Eventually move to typed location auth config docs. | Defer. |
| `services/forecasting/forecast-engine.ts`, `services/forecasting/si-cantina-historical.ts`, `services/forecasting/events-calendar.ts` | Forecast defaults to Si Cantina dataset; `siteId = "si-cantina"`. | High for SaaS forecasting correctness. | Site-specific forecasting data contract keyed by site/org. | Not in consolidation Phase 1; needs product/data work. |
| `services/reviews/reviewIntelligence.ts` | Default property name `"Sea Castle Hotel Camps Bay"`. | Medium. Customer-specific default in shared service. | Require caller-supplied property/site name. | Yes with review tests. |
| `scripts/run-sync-primi.ts`, `scripts/run-sync-sea-castle.ts`, `scripts/backfill-*.ts`, `scripts/verify-sites.ts` | Pilot-specific operations scripts. | Low runtime risk. | Keep as runbooks; do not import into platform code. | Do not remove now. |

## 8. Direct Site/Org Filtering Logic

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `lib/auth/get-user-context.ts` | Resolves `siteIds` via `user_accessible_sites`, selected site via cookie. | Low to medium. Correct core helper but uses inline service-role. | Keep as central source; type role/site rows. | Yes. |
| `lib/auth/api-guard.ts` | Validates optional `siteId` against `ctx.siteIds`; returns service-role client. | High because guarded routes then query with RLS bypass. | Keep guard for RBAC/context; return user-scoped client or no DB client by default. | Not globally safe yet. |
| `app/api/head-office/summary/route.ts` | Manual role/org/site scoping using role rows and `.in("site_id", accessibleSiteIds)`. | High. Any missed filter leaks tenant data. | Shared `resolveAuthorisedSiteScope(ctx)` helper. | Yes with tests. |
| `app/api/head-office/sites/route.ts`, `app/api/head-office/site/[siteId]/route.ts`, `app/api/head-office/ops-center/route.ts` | Each route independently resolves accessible org/site lists. | High. Duplicated tenant access logic. | `lib/auth/tenant-scope.ts` or platform health/head-office service inputs. | Yes after contract tests. |
| `app/api/admin/data-health/route.ts`, `app/api/admin/sync-logs/route.ts`, `app/api/admin/stores/route.ts` | Manual `isSuperAdmin`/`ctx.orgId` filtering. | Medium. Admin org scoping duplicated. | Central admin scope helper. | Yes. |
| `app/api/accountability/*`, `app/api/daily-ops/*`, `app/api/actions/*` | Route-local `ctx.siteId` filtering. | Medium. Mostly single-site, but inconsistent site override validation. | `apiGuard(..., { siteId })` and typed site resolver. | Incremental. |
| `services/ops/*`, `services/state/*`, `services/universal/*` | Services accept optional `siteId` and sometimes return global data if omitted. | High for shared services called by user-facing routes. | Make `siteId`/`authorisedSiteIds` mandatory in tenant-sensitive services. | Not globally; critical paths first. |

## 9. Duplicated Health / Status Logic

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `app/api/admin/platform-health/route.ts` | Calculates token expiry, zombie runs, MPS coverage inline. | High. One of several health definitions. | `lib/observability/platform-health.ts`. | Yes. |
| `app/api/head-office/system-health/route.ts` | Reads `v_site_health_summary`, computes summary/token expiry. | High. Duplicates admin/platform health semantics. | Same platform health service, persona-scoped. | Yes after response adapter. |
| `app/api/admin/data-health/route.ts` | Reads `v_site_health_summary` and maps health rows. | Medium. Another health surface. | Platform health service. | Later. |
| `app/api/system-health/checks/route.ts` | Computes data-source and job health. | Medium. Likely overlaps platform health. | Platform health service modules for data source/job health. | Yes after test coverage. |
| `app/api/system-health/micros/route.ts`, `lib/system-health/getMicrosHealth.ts` | MICROS health specific route/service. | Medium. May diverge from Head Office/Admin health. | Platform health service should call or absorb it. | Later. |
| `services/micros/status.ts`, `lib/integrations/status.ts`, dashboard integrations page | Integration status derived in multiple places. | Medium. Status labels can drift. | Single integration status resolver. | Later. |
| `lib/reliability/score.ts`, `lib/reliability/trend.ts`, `app/api/system-health/reliability-trend/route.ts` | Reliability metrics from sync runs. | Low to medium. Good service separation but separate from platform health. | Platform health consumes reliability services. | Yes. |
| `services/ops/dataFreshness.ts`, `lib/commandCenter.ts` | Data freshness/POS status derived for operations UI. | Medium. Can disagree with system health. | Shared data freshness/status service. | Later. |

## 10. Tenant Access Helper Usage

| File path | Current pattern | Risk | Recommended consolidation target | Safe to change now |
|---|---|---|---|---|
| `lib/auth/get-user-context.ts` | Primary context helper: user, role, org, site, siteIds, impersonation. | Low if typed and tested. | Keep central; remove inline service-role construction. | Yes. |
| `lib/auth/api-guard.ts` | Most route-level RBAC helper. | Medium. Good pattern, but DB client returned is service-role. | Separate guard result from privileged DB access. | Not globally. |
| `lib/rbac/guards.ts` | Additional RBAC guard code with service-role construction. | Medium. Duplicates auth/RBAC paths. | Merge or wrap around `apiGuard`/context helper. | Needs audit before change. |
| `lib/auth/resolve-site.ts` | Site resolution helper for active/all modes. | Low. Useful for site switching consistency. | Use in Head Office and dashboard routes. | Yes. |
| `lib/modules.ts` | Module access helper using service-role `createServerClient()`. | Medium. Module access is tenant-sensitive. | Accept user/context or use scoped helper. | Later. |
| `app/api/*` | Many routes use `apiGuard`; some use `getUserContext`; some do manual auth. | Medium. Inconsistent observability and response shape. | Route template: `apiGuard` -> service call -> `apiSuccess/apiError`. | Incremental. |

## Phase 2 Starting Targets

Safe first moves, assuming type-check/tests are run after each group:

1. Change `lib/supabase/server.ts` to delegate to `getServiceRoleClient()` and mark it deprecated. This creates one physical service-role construction path without changing call sites.
2. Replace inline service-role constructors in low-risk internal files: `lib/auth/get-user-context.ts`, `lib/micros/micros-location-registry.ts`, `lib/audit/auditLog.ts`, `lib/incidents/guard.ts`.
3. Add a static test that fails if `SUPABASE_SERVICE_ROLE_KEY` or `service-role-client` appears in client components or browser Supabase files.
4. Do not yet convert `apiGuard` to user-scoped clients globally; that would be a major behavioural change.

Rollback path: revert each file to prior inline construction or restore `lib/supabase/server.ts` implementation. No schema changes are required for Phase 2.

## Phase 3 Starting Targets

Introduce `lib/api/response.ts` with `ApiEnvelope<T>`, `apiSuccess()`, `apiError()`, and optionally `withCompatibilityFields()` for routes where frontend consumers expect top-level fields.

Apply first to:

1. `app/api/head-office/system-health/route.ts`
2. `app/api/admin/platform-health/route.ts`
3. `app/api/internal/scheduler/tick/route.ts`
4. `app/api/cron/zombie-sync-cleanup/route.ts`
5. `app/api/head-office/summary/route.ts` only with compatibility fields preserved.

Rollback path: keep response helpers additive and preserve top-level legacy fields until frontend consumers are migrated.

## Phase 4 Starting Targets

Dangerous `as any` replacements should focus on:

1. Head Office summary/system health row schemas.
2. Platform health rows: MICROS connections, sync runs, MPS scores.
3. Scheduler RPC rows.
4. Sync status rows.
5. Auth role/access rows.

Harmless UI casts and broad report-generation casts should be deferred.

## Phase 5 Starting Targets

Create `lib/observability/platform-health.ts` with inputs:

```ts
type PlatformHealthScope = {
  role: string;
  organisationId: string | null;
  authorisedSiteIds: string[];
  includeAllTenants: boolean;
};
```

The service should return typed sections for MICROS token status, sync staleness, zombie runs, MPS coverage, site health, scheduler health, and RBAC anomalies. Routes should only authenticate, resolve scope, call the service, and format the response.

## Phase 6 Ownership Map

Target ownership:

| Concern | Owner |
|---|---|
| External cron authentication | `app/api/cron/*` thin shims |
| Scheduler decision/enqueue/claim | `app/api/internal/scheduler/tick` + `lib/scheduler/*` |
| Sync execution | `lib/sync/orchestrator.ts` and MICROS service implementations |
| MICROS auth/location resolution | `lib/micros/*`, `services/micros/*` with location registry |
| Observability/status | `lib/observability/platform-health.ts` |
| User-facing/manual route | Auth, validation, orchestration trigger, response only |

Legacy paths requiring compatibility protection:

- `app/api/micros/sync/route.ts`
- `app/api/sync/cron/route.ts`
- `app/api/sync/run/route.ts`
- `app/api/cron/daily-sync/route.ts`

## Phase 7 Pilot Logic Classification

| Classification | Files |
|---|---|
| Safe platform config candidate | `lib/demo/*`, `scripts/verify-sites.ts`, location-key references in MICROS config/registry docs |
| Temporary pilot override | Si Cantina sandbox mirror in `app/api/head-office/sites/route.ts`; pilot sync scripts |
| Dangerous hardcoded logic | `TEST-01` filters in platform routes, `"2000002"` fallback in production sync route, Si Cantina forecast defaults in shared forecasting engine, Sea Castle default property name in reviews intelligence |

The fourth-customer readiness blocker is not the presence of pilot scripts. It is pilot/site defaults inside shared production services and platform routes.

## Verification Not Run

Phase 1 is documentation-only. I did not run type-checks, tests, MICROS checks, migrations, or browser verification because no runtime code was changed.

Recommended verification before Phase 2 commit:

```bash
npm run type-check
npm test
npm run micros:validate
npm run verify:sites
```

If available with live credentials, also run:

```bash
npm run micros:check:primi
```
