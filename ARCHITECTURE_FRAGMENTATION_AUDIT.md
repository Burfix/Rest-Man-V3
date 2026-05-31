# ForgeStack Africa Architecture Fragmentation Audit

Date: 2026-05-31  
Scope: Phase 1 inventory only. No application code was changed.

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
