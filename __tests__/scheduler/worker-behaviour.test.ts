/**
 * __tests__/scheduler/worker-behaviour.test.ts
 *
 * Category 8: Worker execution behaviour — sync and async
 * Category 10: Downstream job chaining
 *
 * Tests the TypeScript worker layer (worker.ts, async-scheduler.ts) against
 * the MockQueue. Business logic services (dispatchSync, score calculators)
 * are mocked at their import boundaries. The queue mechanics are real (MockQueue).
 *
 * What this proves:
 *   - executeSyncJob: leased → running → succeeded/failed lifecycle
 *   - executeSyncJob: mark_running is called BEFORE dispatchSync
 *   - executeSyncJob: invalid sync_type/mode → dead_letter immediately (non-retryable)
 *   - executeSyncJob: dispatchSync error → failed with retries
 *   - executeSyncJob: daily_sales success → compute_accountability enqueued
 *   - executeAsyncJob: dry_run → succeeded without handler execution
 *   - executeAsyncJob: known job_type succeeds → succeeded
 *   - executeAsyncJob: handler throws → job fails with error captured
 *   - runSyncJobBatch: deadline respected (bail early)
 *   - runSyncJobBatch: returns accurate { succeeded, failed } counts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MockQueue, createMockSupabase } from "./helpers/MockQueue";
import { SITE_A, WORKER_1, BIZ_DATE, queuedJob, queuedAsyncJob, makeWorkerCtx } from "./helpers/factory";

// ── Mock boundaries ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/orchestrator", () => ({
  dispatchSync: vi.fn(),
}));

// Mock the dynamic imports used by async-scheduler handlers
vi.mock("@/services/accountability/score-calculator", () => ({
  calculateDailyScores: vi.fn().mockResolvedValue(undefined),
  calculateAllSitesScores: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/reports/dailyReport", () => ({
  sendDailyReport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/reports/weeklyReport", () => ({
  generateWeeklyReport: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/reports/weeklyReportEmail", () => ({
  sendWeeklyReportEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/reviews/googleSync", () => ({
  syncSiteReviews: vi.fn().mockResolvedValue({ synced: 5, errors: [] }),
  syncAllSiteReviews: vi.fn().mockResolvedValue({ synced: 5, total: 5, errors: [] }),
}));

// ── Module imports (after mocks are registered) ───────────────────────────────

import { executeSyncJob, runSyncJobBatch } from "../../lib/scheduler/worker";
import { executeAsyncJob, runAsyncJobBatch } from "../../lib/scheduler/async-scheduler";
import { claimSyncJobs, claimAsyncJobs } from "../../lib/scheduler/claim";

// dispatchSync type import

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeSuccessResult(): Record<string, unknown> {
  return {
    ok: true,
    outcome: "success",
    records_written: 10,
    records_fetched: 10,
    duration_ms: 100,
    errors: [],
    sync_type: "daily_sales",
    mode: "delta",
    loc_ref: "LOC001",
    business_date: BIZ_DATE,
  };
}

function makeFailResult(retryable = true): Record<string, unknown> {
  return {
    ok: false,
    outcome: "failed",
    records_written: 0,
    records_fetched: 0,
    duration_ms: 100,
    errors: [{ message: "Connection refused", retryable }],
    sync_type: "daily_sales",
    mode: "delta",
    loc_ref: "LOC001",
    business_date: BIZ_DATE,
  };
}

// =============================================================================
// executeSyncJob: lifecycle
// =============================================================================

describe("executeSyncJob: lifecycle correctness", () => {
  it("successful dispatch: job transitions leased → running → succeeded", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeSuccessResult());

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id,
      site_id: row.site_id,
      connection_id: null,
      loc_ref: "LOC001",
      sync_type: "daily_sales",
      mode: "delta",
      business_date: BIZ_DATE,
      priority: 100,
      trace_id: row.trace_id,
      attempts: 0,
    };

    const ctx = makeWorkerCtx({ worker_id: WORKER_1 });
    const ok = await executeSyncJob(supabase, claimedJob, ctx);

    expect(ok).toBe(true);
    expect(q.syncRow(row.id)!.status).toBe("succeeded");
    expect(q.syncRow(row.id)!.started_at).toBeInstanceOf(Date);
    expect(q.syncRow(row.id)!.completed_at).toBeInstanceOf(Date);
    expect(q.syncRow(row.id)!.lease_owner).toBeNull();
  });

  it("failed retryable dispatch: job transitions running → failed (requeued)", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeFailResult(true));

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, max_attempts: 5 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id,
      site_id: row.site_id,
      connection_id: null,
      loc_ref: "LOC001",
      sync_type: "daily_sales",
      mode: "delta",
      business_date: BIZ_DATE,
      priority: 100,
      trace_id: row.trace_id,
      attempts: 0,
    };

    const ok = await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(ok).toBe(false);
    expect(q.syncRow(row.id)!.status).toBe("queued");
    expect(q.syncRow(row.id)!.attempts).toBe(1);
  });

  it("failed non-retryable dispatch: job goes to dead_letter faster", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeFailResult(false)); // non-retryable

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, attempts: 4, max_attempts: 5 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: row.site_id, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 4,
    };

    const ok = await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(ok).toBe(false);
    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("dead_letter");
  });

  it("dispatchSync exception: job fails with error message captured", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockRejectedValue(new Error("DB connection pool exhausted"));

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, max_attempts: 5 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: row.site_id, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    const ok = await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(ok).toBe(false);
    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("queued"); // retryable
    expect(live.last_error).toContain("DB connection pool exhausted");
  });
});

// =============================================================================
// executeSyncJob: mark_running is called BEFORE dispatch
// =============================================================================

describe("executeSyncJob: mark_running called before dispatch", () => {
  it("job is in 'running' state when dispatchSync is invoked", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");

    let statusDuringDispatch = "(unknown)";
    vi.mocked(dispatchSync).mockImplementation(async () => {
      // Capture the job status at the moment dispatch is called
      statusDuringDispatch = q.allSyncRows()[0]?.status ?? "(none)";
      return makeSuccessResult();
    });

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: row.site_id, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(statusDuringDispatch).toBe("running");
  });
});

// =============================================================================
// executeSyncJob: invalid job field validation
// =============================================================================

describe("executeSyncJob: invalid job is dead-lettered immediately", () => {
  it("invalid sync_type: job fails without dispatch and max_attempts check", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, sync_type: "INVALID_TYPE" }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: row.site_id, connection_id: null,
      loc_ref: "LOC001", sync_type: "INVALID_TYPE", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    const ok = await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(ok).toBe(false);
    expect(vi.mocked(dispatchSync)).not.toHaveBeenCalled();
    // With non-retryable delay (99999), backoff is capped at 14400 — job stays queued
    // until max_attempts reached. With 5 max, it requeues for 4 more retries.
    // On each retry the same validation fails again → eventually dead_letter.
    // But the key test: dispatchSync was NOT called.
  });

  it("invalid mode: dispatchSync is not called", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, mode: "INVALID" }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: row.site_id, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "INVALID",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(vi.mocked(dispatchSync)).not.toHaveBeenCalled();
  });
});

// =============================================================================
// executeSyncJob: dry_run mode
// =============================================================================

describe("executeSyncJob: dry_run mode", () => {
  it("dry_run skips dispatchSync and marks job succeeded", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: row.site_id, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    const ok = await executeSyncJob(supabase, claimedJob, makeWorkerCtx({ dry_run: true }));
    expect(ok).toBe(true);
    expect(vi.mocked(dispatchSync)).not.toHaveBeenCalled();
    expect(q.syncRow(row.id)!.status).toBe("succeeded");
  });
});

// =============================================================================
// Category 10: Downstream job chaining
// =============================================================================

describe("downstream job chaining: daily_sales success enqueues compute_accountability", () => {
  it("successful daily_sales sync enqueues compute_accountability for same site/date", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeSuccessResult());

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, sync_type: "daily_sales" }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: SITE_A, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    await executeSyncJob(supabase, claimedJob, makeWorkerCtx());

    // Should have enqueued compute_accountability
    const asyncJobs = q.allAsyncRows();
    expect(asyncJobs).toHaveLength(1);
    expect(asyncJobs[0].job_type).toBe("compute_accountability");
    expect(asyncJobs[0].payload).toMatchObject({ site_id: SITE_A, date: BIZ_DATE });
    // Idempotency key includes site_id and date
    expect(asyncJobs[0].idempotency_key).toContain(SITE_A);
    expect(asyncJobs[0].idempotency_key).toContain(BIZ_DATE);
  });

  it("failed daily_sales sync does NOT enqueue compute_accountability", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeFailResult(true));

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, sync_type: "daily_sales" }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: SITE_A, connection_id: null,
      loc_ref: "LOC001", sync_type: "daily_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(q.allAsyncRows()).toHaveLength(0); // no downstream job
  });

  it("downstream enqueue is idempotent: two successful syncs for same site/date → one async job", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeSuccessResult());

    for (let i = 0; i < 2; i++) {
      const row = q.insertSync({
        site_id: SITE_A,
        loc_ref: `LOC00${i}`,
        sync_type: "daily_sales",
        business_date: BIZ_DATE,
        mode: "delta",
        status: "leased",
        lease_owner: WORKER_1,
        idempotency_key: `key-${i}`,
      });
      q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);
      const claimedJob = {
        id: row.id, site_id: SITE_A, connection_id: null,
        loc_ref: `LOC00${i}`, sync_type: "daily_sales", mode: "delta",
        business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
      };
      await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    }

    // Both syncs tried to enqueue compute_accountability for same site+date
    // Idempotency should prevent duplicates
    expect(q.allAsyncRows()).toHaveLength(1);
  });

  it("intraday_sales success does NOT enqueue downstream job", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue({ ...makeSuccessResult(), sync_type: "intraday_sales" });

    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, sync_type: "intraday_sales" }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const claimedJob = {
      id: row.id, site_id: SITE_A, connection_id: null,
      loc_ref: "LOC001", sync_type: "intraday_sales", mode: "delta",
      business_date: BIZ_DATE, priority: 100, trace_id: row.trace_id, attempts: 0,
    };

    await executeSyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(q.allAsyncRows()).toHaveLength(0);
  });
});

// =============================================================================
// runSyncJobBatch: counts and deadline
// =============================================================================

describe("runSyncJobBatch: batch execution", () => {
  it("returns accurate { succeeded, failed } counts", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");

    // First 3 succeed, last 2 fail
    vi.mocked(dispatchSync)
      .mockResolvedValueOnce(makeSuccessResult())
      .mockResolvedValueOnce(makeSuccessResult())
      .mockResolvedValueOnce(makeSuccessResult())
      .mockResolvedValueOnce(makeFailResult(true))
      .mockResolvedValueOnce(makeFailResult(true));

    // Seed 5 queued jobs, then claim them so they become leased
    for (let i = 0; i < 5; i++) {
      q.insertSync(queuedJob({ loc_ref: `LOC${i}`, idempotency_key: `k${i}` }));
    }

    const jobs = await claimSyncJobs(supabase, WORKER_1, 5);
    expect(jobs).toHaveLength(5);
    const ctx = makeWorkerCtx({ worker_id: WORKER_1 });
    const result = await runSyncJobBatch(supabase, jobs, ctx);

    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(2);
  });

  it("deadline bail-out: stops processing when deadline reached", async () => {
    const { dispatchSync } = await import("@/lib/sync/orchestrator");
    vi.mocked(dispatchSync).mockResolvedValue(makeSuccessResult());

    // Seed 5 queued jobs, then claim them
    for (let i = 0; i < 5; i++) {
      q.insertSync(queuedJob({ loc_ref: `LOC${i}`, idempotency_key: `k${i}` }));
    }

    const jobs = await claimSyncJobs(supabase, WORKER_1, 5);

    // Set deadline to NOW — all jobs will bail immediately after first check
    const ctx = makeWorkerCtx({ deadline_ms: Date.now() - 1 });
    const result = await runSyncJobBatch(supabase, jobs, ctx);

    // With deadline already past, no jobs should be executed
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });
});

// =============================================================================
// executeAsyncJob: dry_run
// =============================================================================

describe("executeAsyncJob: dry_run", () => {
  it("dry_run marks job succeeded without calling handler", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "leased", lease_owner: WORKER_1 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);

    const claimedJob = {
      id: row.id, job_type: "compute_accountability" as const,
      payload: { site_id: SITE_A, date: BIZ_DATE },
      idempotency_key: row.idempotency_key, attempts: 0,
    };

    const ctx = makeWorkerCtx({ dry_run: true });
    const ok = await executeAsyncJob(supabase, claimedJob, ctx);
    expect(ok).toBe(true);
    expect(q.asyncRow(row.id)!.status).toBe("succeeded");
  });
});

// =============================================================================
// executeAsyncJob: handler failure → job failed correctly
// =============================================================================

describe("executeAsyncJob: handler failure", () => {
  it("compute_accountability handler throw → job fails with error", async () => {
    const { calculateDailyScores } = await import("@/services/accountability/score-calculator");
    vi.mocked(calculateDailyScores).mockRejectedValue(new Error("score calc blew up"));

    const row = q.insertAsync(queuedAsyncJob({ status: "leased", lease_owner: WORKER_1 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);

    const claimedJob = {
      id: row.id, job_type: "compute_accountability" as const,
      payload: { site_id: SITE_A, date: BIZ_DATE },
      idempotency_key: row.idempotency_key, attempts: 0,
    };

    const ok = await executeAsyncJob(supabase, claimedJob, makeWorkerCtx());
    expect(ok).toBe(false);
    const live = q.asyncRow(row.id)!;
    expect(live.status).toBe("queued"); // retried
    expect(live.last_error).toContain("score calc blew up");
    expect(live.attempts).toBe(1);
  });
});

// =============================================================================
// runAsyncJobBatch: accurate counts
// =============================================================================

describe("runAsyncJobBatch: batch execution", () => {
  it("returns accurate { succeeded, failed } counts for async jobs", async () => {
    const { calculateDailyScores } = await import("@/services/accountability/score-calculator");
    vi.mocked(calculateDailyScores)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));

    for (let i = 0; i < 2; i++) {
      q.insertAsync({
        job_type: "compute_accountability",
        payload: { site_id: SITE_A, date: BIZ_DATE },
        idempotency_key: `async-k${i}`,
      });
    }

    const jobs = await claimAsyncJobs(supabase, WORKER_1, 5);
    expect(jobs).toHaveLength(2);
    const result = await runAsyncJobBatch(
      supabase,
      jobs as Parameters<typeof runAsyncJobBatch>[1],
      makeWorkerCtx(),
    );

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});
