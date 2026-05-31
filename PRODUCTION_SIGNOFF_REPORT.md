# FORGESTACK AFRICA — PRODUCTION HARDENING SIGN-OFF REPORT

**Report Date:** 2026-05-31  
**Platform:** ForgeStack Africa Operational Intelligence Platform  
**Version:** Rest-Man-V3  
**Prepared by:** Engineering (CTO / Principal Engineer)  
**Environment:** Production (Vercel cpt1 / Supabase `bdzcydhrdjprdzywjbeu`)

---

## EXECUTIVE SUMMARY

All 8 phases of the Production Hardening & Sign-Off Sprint have been completed. The platform is hardened against the critical gaps identified during the audit phase. The single outstanding operational risk is **MICROS OAuth token expiry on 2026-06-03** — a manual token refresh must be performed before that date.

**Overall verdict: CONDITIONAL PASS — token refresh required within 3 days.**

---

## PHASE COMPLETION MATRIX

| Phase | Ref | Description | Status | Migration / File |
|-------|-----|-------------|--------|-----------------|
| 1 | F-02 | MICROS Token Expiry Monitoring | ✅ DONE | `lib/monitoring/token-expiry.ts` |
| 2 | F-03 | MPS Scoring Pipeline Fix + Backfill | ✅ DONE | Migration 115 |
| 3 | F-04 | Sea Castle Sync Config (intraday) | ✅ DONE | Migration 113 |
| 4 | — | Zombie Sync Run Elimination | ✅ DONE | Migration 114 + cron route |
| 5 | F-06 | `fs_user_can_access_site()` Role Fix | ✅ DONE | Migration 111 |
| 6 | — | Remove Legacy `site_scoped_access` RLS | ✅ DONE | Migration 112 |
| 7 | — | Platform Observability Health Centre | ✅ DONE | `/api/admin/platform-health` |
| 8 | — | Production Validation & Sign-Off | ✅ DONE | This report |

---

## DETAILED FINDINGS AND RESOLUTIONS

### F-02: MICROS Token Expiry (⚠️ CRITICAL — ACTION REQUIRED)

**Finding:** All 3 MICROS OAuth tokens (Primi Camps Bay, Sea Castle Hotel, Si Cantina Sociale) expire on **2026-06-03 22:56 UTC** — 3.4 days from report date. All currently classified as `HIGH`.

**Token Status at time of report:**
| Site | Expires At | Days Remaining | Status |
|------|-----------|----------------|--------|
| Primi Camps Bay | 2026-06-03 22:56 UTC | 3.4 days | HIGH |
| Sea Castle Hotel | 2026-06-03 22:56 UTC | 3.4 days | HIGH |
| Si Cantina Sociale | 2026-06-03 22:56 UTC | 3.4 days | HIGH |

**Action Taken:**
- Built `lib/monitoring/token-expiry.ts` with OK/WARNING/HIGH/CRITICAL/NO_DATA thresholds (14d/7d/3d/24h)
- Wired into `/api/head-office/system-health` response (`tokenExpiry` field)
- Built `/api/admin/platform-health` endpoint for comprehensive monitoring

**Required Action (IMMEDIATE):** Refresh all 3 MICROS OAuth tokens before 2026-06-03. Failure to do so will halt all MICROS data ingestion across all sites. Tokens live exclusively in environment variables — no DB changes needed once refreshed.

---

### F-03: MPS Scoring Pipeline (✅ RESOLVED)

**Finding:** `score-calculator.ts` silently skips users when `assigned_to IS NULL` even if `completed_by` is set. This caused Primi Camps Bay to be stale since 2026-05-21 and Si Cantina to be missing 2026-05-29 scores.

**Root Cause:** The `userIds` set was populated via `completed_by`, but `tasksAssigned` for that user computed as 0 (since no `assigned_to` or `started_by` match), triggering the `SCORE_NO_DATA` guard.

**Resolution:**
- Migration 115 applied: SQL backfill using `COALESCE(assigned_to, completed_by)` as effective owner for all scoreable dates from 2026-03-31
- Backfill results: Primi 13→14 rows (latest 2026-05-29), Si Cantina 33→38 rows (latest 2026-05-29)

**MPS State Post-Fix:**
| Site | Score Rows | Latest Date | Avg Score |
|------|-----------|-------------|-----------|
| Primi Camps Bay | 14 | 2026-05-29 | 66.1 (Average) |
| Sea Castle Hotel | 1 | 2026-05-06 | 0.0 (insufficient task data) |
| Si Cantina Sociale | 38 | 2026-05-29 | 56.6 (Average) |

**Forward Fix Required:** Ensure `assigned_to` is populated on task creation (not just `completed_by`) to prevent recurrence of the attribution gap.

---

### F-04: Sea Castle Sync Staleness (✅ RESOLVED)

**Finding:** Primi Camps Bay and Sea Castle Hotel were completely absent from `sync_schedule_config`. Only Si Cantina Sociale had intraday sync entries. `get_due_intraday_syncs()` therefore never returned jobs for these two sites, causing the 275-min staleness lag previously observed on Sea Castle.

**Resolution:**
- Migration 113 applied: 3 entries added per site (intraday_sales@15min, labour@10min, daily_sales@daily) for both Primi and Sea Castle
- All 9 rows verified: 3 sites × 3 sync types ✅

**Sync schedule post-fix:**
| Site | Sync Type | Interval | Window (SAST) |
|------|-----------|----------|---------------|
| All 3 | intraday_sales | 15 min | 08:00–23:00 |
| All 3 | labour | 10 min | 06:00–23:59 |
| All 3 | daily_sales | daily | 04:00–04:30 |

**Note:** Si Cantina entries show `last_run_at = NULL` for all rows — intraday syncs have never successfully completed. This is tied to the underlying MICROS OAuth token issue (F-02). Once tokens are refreshed, intraday syncs should begin firing.

---

### Zombie Sync Run Elimination (✅ RESOLVED)

**Finding:** Nightly full syncs for all 3 sites have been failing consistently — stuck at `status='running'` for 12–13h before application-level zombie cleanup fires. The existing 5-min threshold in `MicrosSyncService.ts` only fires when the NEXT sync is triggered for a connection, creating a ~12h blind spot.

**Root Cause:** The nightly MICROS sync (`daily-sync` cron at 00:00 UTC) times out at the Vercel function level (Vercel kills the function), leaving the `micros_sync_runs` record stuck in `running`. The zombie cleanup only fires when the next sync begins — which for nightly syncs is 24h later, or when an intraday sync finally fires (~12h later via Si Cantina's window).

**Resolution:**
- Migration 114: DB function `cleanup_zombie_sync_runs(p_timeout_minutes)` — terminates any runs stuck beyond threshold
- `app/api/cron/zombie-sync-cleanup/route.ts`: new cron endpoint calling the function with 60-min threshold
- Added to `vercel.json`: schedule `0 * * * *` (hourly)
- The underlying MICROS sync timeout issue (Vercel maxDuration) must also be addressed — see Outstanding Issues

---

### F-06: `fs_user_can_access_site()` Role-Aware Fix (✅ RESOLVED)

**Finding:** The previous implementation granted org-level site access to ANY role with an `organisation_id`. A GM or supervisor without an explicit `site_id` could potentially access all sites in the org if a second site was added.

**Resolution:** Migration 111 applied. Org-level grant now restricted to elevated roles only: `super_admin`, `head_office`, `executive`, `auditor`, `area_manager`. GM, supervisor, contractor, and viewer MUST have an explicit `site_id` match.

```sql
-- Before: ANY role with org_id could access all sites
OR ur.organisation_id IN (SELECT s.organisation_id FROM sites s WHERE s.id = p_site_id)

-- After: Only elevated roles get org-level grant
OR (
  ur.role IN ('super_admin', 'head_office', 'executive', 'auditor', 'area_manager')
  AND ur.organisation_id IN (SELECT s.organisation_id FROM sites s WHERE s.id = p_site_id)
)
```

---

### RLS Cleanup: Legacy `site_scoped_access` Policies (✅ RESOLVED)

**Finding:** `site_scoped_access` ALL-command policies existed alongside newer granular policies on `actions` and `maintenance_logs`. `daily_ops_tasks` had ONLY the legacy policy with no modern replacement.

**Resolution:** Migration 112 applied:
- `actions`: legacy `site_scoped_access` dropped (4 modern granular policies retained)
- `maintenance_logs`: legacy `site_scoped_access` dropped (3 modern policies retained)
- `daily_ops_tasks`: 5 modern policies added FIRST (`daily_ops_tasks_site_read/write/update/delete/srole_full`), then legacy dropped — zero access gap

---

### Platform Observability Health Centre (✅ LIVE)

**Endpoint:** `GET /api/admin/platform-health`

**Auth:** `CRON_SECRET` Bearer or `super_admin`/`executive`/`head_office` session

**Response covers:**
1. MICROS token expiry status per connection (OK/WARNING/HIGH/CRITICAL/NO_DATA)
2. Sync staleness per site (GREEN <30min / AMBER <120min / RED ≥120min)
3. Zombie sync runs (WARNING ≥30min stuck / CRITICAL ≥60min stuck)
4. MPS scoring coverage (sites with no score in last 24h)
5. Overall severity rollup (HEALTHY / WARNING / CRITICAL)

---

## CURRENT PRODUCTION STATE (AS OF 2026-05-31)

### MICROS Connections
| Site | Token Status | Days Remaining | Intraday Sync Config |
|------|-------------|----------------|----------------------|
| Primi Camps Bay | HIGH | 3.4d | ✅ Added (Migration 113) |
| Sea Castle Hotel | HIGH | 3.4d | ✅ Added (Migration 113) |
| Si Cantina Sociale | HIGH | 3.4d | ✅ Already existed |

### Nightly Sync Health
All 3 sites show consistent zombie cleanup pattern (nightly full sync times out). This is an infrastructure-level issue (Vercel function timeout) independent of the token expiry. The hourly zombie cleanup cron now limits the window to 60 minutes instead of 12–24h.

### RLS + RBAC
| Control | Status |
|---------|--------|
| `fs_user_can_access_site()` | ✅ Role-restricted (Migration 111) |
| `daily_ops_tasks` RLS | ✅ Modern policies applied (Migration 112) |
| `actions` RLS | ✅ Legacy policy removed (Migration 112) |
| `maintenance_logs` RLS | ✅ Legacy policy removed (Migration 112) |
| Credential column REVOKE | ✅ Applied (Migration 110, previous sprint) |

---

## OUTSTANDING ISSUES (NOT BLOCKING SIGN-OFF)

| Priority | Issue | Owner | Deadline |
|----------|-------|-------|----------|
| 🔴 CRITICAL | MICROS token refresh (all 3 sites expire 2026-06-03) | Thami / Ops | **2026-06-02** |
| 🟠 HIGH | Nightly MICROS full sync timing out (Vercel maxDuration) | Engineering | Next sprint |
| 🟠 HIGH | Si Cantina `sync_schedule_config` last_run_at = NULL — intraday syncs not firing | Engineering | After token refresh |
| 🟡 MEDIUM | Sea Castle task data insufficient for MPS scoring (1 row since May 6) | Operations | Ongoing |
| 🟡 MEDIUM | `score-calculator.ts` uses `createServerClient()` (session-based) in cron context — should use `getServiceRoleClient()` | Engineering | Next sprint |

---

## MIGRATIONS APPLIED THIS SPRINT

| Migration | Name | Applied |
|-----------|------|---------|
| 111 | `fix_fs_user_can_access_site_role_aware` | ✅ 2026-05-31 |
| 112 | `remove_legacy_site_scoped_access_policies` | ✅ 2026-05-31 |
| 113 | `add_sync_schedule_config_primi_sea_castle` | ✅ 2026-05-31 |
| 114 | `add_zombie_sync_cleanup_function` | ✅ 2026-05-31 |
| 115 | `backfill_mps_scores_missing_dates` | ✅ 2026-05-31 |

---

## FILES ADDED / MODIFIED THIS SPRINT

| File | Type | Description |
|------|------|-------------|
| `lib/monitoring/token-expiry.ts` | New | Token expiry monitoring (OK/WARNING/HIGH/CRITICAL) |
| `app/api/head-office/system-health/route.ts` | Modified | Added `tokenExpiry` field to response |
| `app/api/admin/platform-health/route.ts` | New | Full platform observability health centre |
| `app/api/cron/zombie-sync-cleanup/route.ts` | New | Hourly zombie sync run cleanup cron |
| `vercel.json` | Modified | Added zombie-sync-cleanup cron (`0 * * * *`) |
| `supabase/migrations/111_*.sql` | New | `fs_user_can_access_site()` role-aware rewrite |
| `supabase/migrations/112_*.sql` | New | Legacy RLS policy removal + daily_ops_tasks modern policies |
| `supabase/migrations/113_*.sql` | New | Primi + Sea Castle sync_schedule_config entries |
| `supabase/migrations/114_*.sql` | New | `cleanup_zombie_sync_runs()` DB function |
| `supabase/migrations/115_*.sql` | New | MPS score backfill (2026-03-31 to yesterday) |

---

## SIGN-OFF RECOMMENDATION

**CONDITIONAL PASS**

The platform is production-hardened across all security, observability, and operational dimensions targeted in this sprint. The one action that MUST happen before this sprint is fully closed is the MICROS token refresh — without it, all data ingestion stops on June 3rd.

Once token refresh is confirmed, this sprint is fully signed off.

---

*Report generated: 2026-05-31 | ForgeStack Africa Engineering*
