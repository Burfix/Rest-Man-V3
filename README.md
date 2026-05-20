# ForgeStack

**The operating brain for restaurant GMs.**

ForgeStack turns fragmented restaurant data into a single operating intelligence layer. At any moment it knows: what is the highest-risk issue right now, what action produces the fastest result, and what happens if nothing is done. It does not report — it operates.

---

## What it does

- Monitors revenue pace, labour cost, duties completion, maintenance status, and compliance in real time
- Generates a single operating score and grade (A–F) updated every 3 minutes
- Surfaces a prioritised action queue — not a list of metrics
- Issues consequence language tied to guest experience, financial impact, or legal risk
- Tracks GM accountability and scores performance daily
- Delivers a morning brief and end-of-day sync via email

---

## Architecture

```
Next.js 14 App Router (server components + client leaves)
Supabase (Postgres + row-level security + service-role client)
Vercel (deployment + cron jobs)
Resend (transactional email)
MICROS POS (revenue sync via micros_sales_daily)
```

**Core intelligence stack:**

```
services/brain/operating-brain.ts        ← runOperatingBrain() — master orchestrator
services/brain/voice-generator.ts        ← 18-state situational briefing
services/intelligence/context-builder.ts ← buildOperationsContext() — all module data
services/intelligence/signal-detector.ts ← detectSignals() — S1–S11 cross-module signals
services/forecasting/forecast-engine.ts  ← historical pattern-based revenue projection
services/accountability/score-calculator.ts ← GM performance scoring
```

**Command Center (dashboard first screen):**

```
Layer 1 — HeroStrip: score + grade + voice line + 4 KPI pills + sync
Layer 2 — PriorityActionBoard: ranked action cards + brain recommendation + score bars
Layer 3 — ServicePulse, CommandFeed, BusinessStatusRail, FeedbackLoop
```

---

## Scheduler architecture

ForgeStack uses a DB-backed scheduler and queue instead of route-level cron execution.

### Tables (Supabase)

| Table | Purpose |
|---|---|
| `sync_schedules` | Per-site, per-sync-type cadence config. Controls when jobs are enqueued. |
| `sync_job_queue` | Claimable sync work items with leases, retry logic, and priority. |
| `async_job_queue` | Non-sync background jobs: reports, score computes, Google reviews. |

### Job lifecycle

```
queued → leased → running → succeeded
                          ↘ failed → queued (retry with backoff)
                                   → dead_letter (max_attempts reached)
```

- **queued**: Available to be claimed
- **leased**: Claimed by a worker, lease held, not yet executing
- **running**: Worker has started execution (marked explicitly via `mark_*_running`)
- **succeeded**: Completed successfully
- **failed → queued**: Transient failure, requeued with exponential backoff
- **dead_letter**: Exhausted all retries; requires manual intervention

**Attempt semantics**: `attempts` increments only at `mark_*_failed` — not at claim time. A worker crash before execution does not consume a retry.

### Key files

```
lib/scheduler/types.ts          — SyncJobStatus, AsyncJobStatus, SchedulerTickSummary
lib/scheduler/claim.ts          — claimSyncJobs, claimAsyncJobs, markRunning, markSuccess, markFailed
lib/scheduler/sync-scheduler.ts — enqueueDueSyncJobs: reads sync_schedules → enqueues sync_job_queue
lib/scheduler/worker.ts         — executeSyncJob: leased → running → dispatchSync → succeeded/failed
lib/scheduler/async-scheduler.ts — executeAsyncJob: handles all AsyncJobType dispatches
app/api/internal/scheduler/tick/route.ts — POST-only tick entrypoint
app/api/cron/sync-orchestrator/route.ts  — Vercel cron shim that POSTs to the tick route
```

### Tick flow (POST /api/internal/scheduler/tick)

1. `releaseStaleLeases` — recover jobs stuck in `leased` or `running` past their `leased_until`
2. `enqueueDueSyncJobs` — for each due schedule, insert a `sync_job_queue` row (idempotent)
3. `claimSyncJobs` — atomically claim up to N jobs using `SKIP LOCKED`
4. `runSyncJobBatch` — for each claimed job: mark `running` → `dispatchSync` → mark `succeeded`/`failed`
5. `claimAsyncJobs` → `runAsyncJobBatch` — same pattern for async jobs
6. Return `SchedulerTickSummary` JSON with counters: `schedules_due`, `sync_jobs_enqueued`, `*_claimed`, `*_succeeded`, `*_failed`

### Retry / backoff

Failed jobs are requeued with exponential backoff: `base_delay_secs × 2^(attempts - 1)`, capped at 4 hours (sync) / 2 hours (async). After `max_attempts` failures the job moves to `dead_letter`.

### Auth

The tick route is protected by `Bearer $CRON_SECRET`. The Vercel cron sets this header automatically.

---

## Operating score

| Module      | Weight |
|-------------|--------|
| Revenue     | 30 pts |
| Labour      | 20 pts |
| Duties      | 20 pts |
| Maintenance | 15 pts |
| Compliance  | 15 pts |

Grades: A (90+) · B (80–89) · C (65–79) · D (50–64) · F (<50)

---

## Current pilots

- **Si Cantina Sociale** — V&A Waterfront, Cape Town
- **Primi** — Camps Bay, Cape Town

---

## Roadmap

- [ ] Inventory module
- [ ] WhatsApp alert delivery
- [ ] Mobile-native app
- [ ] Multi-brand support
- [ ] API for third-party integrations
- [ ] Predictive staffing recommendations
- [ ] AI-powered shift briefings

---

## Status

Active development. Founder-led. Pilots live.

---

*Built by Burfix · Cape Town*
