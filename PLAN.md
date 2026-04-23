# ForgeStack Sync Engine — Production Rebuild Plan

**Author:** GitHub Copilot (Claude Sonnet 4.6)  
**Date:** 2026-04-23  
**Status:** IN PROGRESS — building vertical slices

---

## Codebase State at Handoff

### What Already Exists

| Path | Description |
|---|---|
| `lib/sync/engine.ts` | 11-phase orchestration engine (V2) — fully functional |
| `lib/sync/types.ts` | Legacy type definitions (no Zod, no contract types) |
| `lib/sync/adapters/micros-sales.adapter.ts` | Sales adapter — works, but not called by any scheduler |
| `lib/sync/adapters/micros-labour.adapter.ts` | Labour adapter — delegates to inner service |
| `lib/micros/auth.ts` | Oracle PKCE 4-step flow (in-memory token cache) |
| `lib/micros/client.ts` | HTTP wrapper with 2 retries + auth |
| `app/api/micros/sync` | Sales sync endpoint — works but NOT scheduled |
| `app/api/micros/labour-sync` | Labour sync endpoint — `full` mode does delta only |
| `app/api/cron/daily-sync` | Midnight report cron — not a sync scheduler |
| `vercel.json` | 7 crons (all midnight/early-morning, none intraday) |
| `components/brain/SyncNowButton.tsx` | **BUG: only calls `router.refresh()`, never hits API** |
| `components/dashboard/labour/LabourSyncButton.tsx` | "Full Sync" button — misleadingly named |
| `lib/brain/cache.ts` | Brain output cache |
| `services/brain/operating-brain.ts` | **BUG: compares raw revenue to full-day target at noon** |

### What Does NOT Exist (to be built)

- `lib/sync/contract.ts` — canonical Zod types (new addition alongside existing types.ts)
- `lib/sync/simphony-client.ts` — thin client wrapping `lib/micros/client.ts`
- `lib/sync/handlers/` — per-type handlers using new contract
- `lib/sync/orchestrator.ts` — central chokepoint calling Supabase RPCs
- `lib/sync/auth.ts` — HMAC cron auth
- `lib/sync/scheduler.ts` — `tick()` function
- `lib/brain/revenue-evaluator.ts` — pace-adjusted revenue (P0 trust fix)
- `lib/alerts/slack.ts` — structured Slack alerting
- `app/api/cron/sync-orchestrator/route.ts` — 5-minute intraday cron
- `app/api/admin/sync/route.ts` — admin backfill API
- `app/(admin)/admin/sync/page.tsx` — admin UI
- `app/dashboard/settings/integrations/page.tsx` — GM-facing sync status

---

## File Tree Diff

```diff
lib/sync/
+ contract.ts                    # Zod SyncRequest/SyncResult/SyncOutcome types
+ simphony-client.ts             # thin Oracle client (wraps lib/micros/client.ts)
+ handlers/
+   sales-daily.ts               # intraday_sales + daily_sales handler
+   guest-checks.ts              # NEW guest check handler
+   intervals.ts                 # NEW sales intervals handler 
+   labour.ts                    # unified labour handler
+ orchestrator.ts                # central dispatch (calls DB RPCs)
+ observability.ts               # structured log + trace
+ auth.ts                        # verifyCronAuth (HMAC)
+ scheduler.ts                   # tick() — claims work, dispatches, reports back
  engine.ts                      # UNCHANGED (keep existing V2 engine)
  types.ts                       # UNCHANGED (keep existing types)

lib/brain/
+ revenue-evaluator.ts           # pace-adjusted revenue (PaceInputs → PaceResult)

lib/alerts/
+ slack.ts                       # three alert classes + 6-hour dedup

app/api/
  micros/
    sync/route.ts                # EXTENDED — accepts new SyncRequest, keeps old shape
    labour-sync/route.ts         # EXTENDED — same
+ cron/
+   sync-orchestrator/
+     route.ts                   # POST (Vercel Cron 5min) + runtime config
+ admin/
+   sync/
+     route.ts                   # GET health/gaps, POST queue backfill

components/
  brain/
    SyncNowButton.tsx            # FIXED — calls /api/micros/sync + labour-sync in parallel
  dashboard/
    labour/
      LabourSyncButton.tsx       # RENAMED "Full Sync" → "Backfill…" with modal
      LabourDashboardClient.tsx  # UPDATED to use new button variants

app/
+ (admin)/admin/sync/page.tsx    # admin sync management UI
  dashboard/
    settings/
+     integrations/
+       page.tsx                 # GM-facing sync health dashboard

vercel.json                      # ADD /api/cron/sync-orchestrator every 5 min
```

---

## Migration List

No new migrations needed — the DB tables listed in the spec already exist in Supabase:
- `sync_schedule_config`
- `sync_backfill_queue`
- `sync_data_gaps` (view)
- `sync_health_monitor` (view)
- `suspicious_sync_runs` (view)
- `sync_scheduler_ticks`
- `scheduler_auth_keys`
- RPCs: `claim_sync_work`, `complete_sync_work`, `get_due_intraday_syncs`, `record_scheduled_sync_run`, `enqueue_sync_gaps`

One new table is needed for Slack alert dedup:
- `sent_alerts` — `(alert_class, connection_id, sync_type, date_key, sent_at)`

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| `scheduler_auth_keys` RPC signature differs from assumed | Medium | Auth falls back to `CRON_SECRET` env var comparison |
| `get_due_intraday_syncs()` returns unexpected columns | Medium | Parse defensively with Zod, log unrecognized fields |
| `claim_sync_work` TTL semantics differ | Low | Acceptance criteria #9 validates TTL-release |
| Building pace evaluator breaks existing brain output | Low | Feature-flagged behind `brain.pace_adjusted_revenue` |
| New cron at 5-min conflicts with existing midnight crons | None | Independent paths, no shared state |
| Backward compat break on `/api/micros/sync` | Low | old `{loc_ref, date}` shape still accepted, `sync_type` is optional |

---

## Build Order

1. ✅ `lib/sync/contract.ts`
2. ✅ `lib/sync/observability.ts`
3. ✅ `lib/sync/simphony-client.ts`
4. ✅ `lib/sync/handlers/sales-daily.ts`
5. ✅ `lib/sync/handlers/guest-checks.ts`
6. ✅ `lib/sync/handlers/intervals.ts`
7. ✅ `lib/sync/handlers/labour.ts`
8. ✅ `lib/sync/orchestrator.ts`
9. ✅ `lib/sync/auth.ts`
10. ✅ `lib/sync/scheduler.ts`
11. ✅ `app/api/cron/sync-orchestrator/route.ts`
12. ✅ `vercel.json` — add 5-min cron
13. ✅ Extend micros sync routes
14. ✅ `lib/brain/revenue-evaluator.ts`
15. ✅ `lib/alerts/slack.ts`
16. ✅ `app/api/admin/sync/route.ts`
17. ✅ `app/(admin)/admin/sync/page.tsx`
18. ✅ Fix `SyncNowButton.tsx`
19. ✅ Fix Labour buttons
20. ✅ `app/dashboard/settings/integrations/page.tsx`
21. ✅ Tests

---

## Progress Log

- 2026-04-23 — Plan written, exploration complete
- 2026-04-23 — Building vertical slices in order above
