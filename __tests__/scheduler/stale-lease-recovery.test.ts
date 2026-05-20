/**
 * __tests__/scheduler/stale-lease-recovery.test.ts
 *
 * Category 4: Stale lease recovery
 * Category 7: Worker crash simulation
 *
 * The 063 migration added a critical fix: stale lease recovery now covers
 * BOTH 'leased' AND 'running' states. Previously only 'leased' was released.
 * A worker that crashed mid-execution (status='running') would be stuck forever.
 *
 * This test file is adversarial about the 'running' case specifically —
 * it is the exact production bug that migration 063 fixed.
 *
 * Tests also verify:
 *   - lease_owner and leased_until are cleared after recovery
 *   - started_at is PRESERVED (execution history is not erased)
 *   - attempts are NOT incremented (the crash was not a failure event)
 *   - recovered job is claimable by a new worker
 *   - a stale ack from the crashed worker is harmlessly rejected
 *   - max_attempts guard: exhausted jobs are NOT released (they go dead_letter instead)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockQueue, createMockSupabase } from "./helpers/MockQueue";
import {
  claimSyncJobs,
  claimAsyncJobs,
  markSyncJobRunning,
  markSyncJobSuccess,
  markSyncJobFailed,
  markAsyncJobRunning,
  markAsyncJobSuccess,
  markAsyncJobFailed,
  releaseStaleLeases,
} from "../../lib/scheduler/claim";
import { WORKER_1, WORKER_2, queuedJob, queuedAsyncJob } from "./helpers/factory";

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
});

// ── Helper: set up a job that is in a given status with an expired lease ──────

function insertExpiredSync(
  status: "leased" | "running",
  overrides: Parameters<MockQueue["insertSync"]>[0] = { site_id: "00000000-0000-0000-0000-000000000a01", loc_ref: "LOC001", sync_type: "daily_sales" },
) {
  const leasedUntil = new Date(q.now().getTime() - 1); // already expired
  const row = q.insertSync({
    ...overrides,
    status,
    lease_owner: WORKER_1,
    leased_until: leasedUntil,
    started_at: status === "running" ? new Date(q.now().getTime() - 60_000) : null,
  });
  return row;
}

function insertExpiredAsync(
  status: "leased" | "running",
) {
  const leasedUntil = new Date(q.now().getTime() - 1);
  return q.insertAsync({
    job_type: "compute_accountability",
    status,
    lease_owner: WORKER_1,
    leased_until: leasedUntil,
    started_at: status === "running" ? new Date(q.now().getTime() - 60_000) : null,
  });
}

// =============================================================================
// Stale LEASED recovery (basic — existed in 062)
// =============================================================================

describe("stale leased recovery", () => {
  it("leased job with expired lease is released to queued", async () => {
    const row = insertExpiredSync("leased");
    q.advanceSecs(1);

    const released = await releaseStaleLeases(supabase);
    expect(released).toBe(1);
    expect(q.syncRow(row.id)!.status).toBe("queued");
  });

  it("release clears lease_owner and leased_until", async () => {
    const row = insertExpiredSync("leased");
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);

    const live = q.syncRow(row.id)!;
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
  });

  it("stale leased release does NOT increment attempts", async () => {
    const row = insertExpiredSync("leased");
    const attemptsBefore = q.syncRow(row.id)!.attempts;
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);
    expect(q.syncRow(row.id)!.attempts).toBe(attemptsBefore);
  });

  it("released leased job is immediately claimable by a new worker", async () => {
    const row = insertExpiredSync("leased");
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);

    const jobs = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(row.id);
    expect(q.syncRow(row.id)!.lease_owner).toBe(WORKER_2);
  });
});

// =============================================================================
// Stale RUNNING recovery (the key 063 fix — was broken in 062)
// =============================================================================

describe("stale running recovery [THE 063 FIX]", () => {
  it("running job with expired lease is released to queued", async () => {
    const row = insertExpiredSync("running");
    q.advanceSecs(1);

    const released = await releaseStaleLeases(supabase);
    expect(released).toBe(1);
    expect(q.syncRow(row.id)!.status).toBe("queued");
  });

  it("release clears lease_owner and leased_until from running job", async () => {
    const row = insertExpiredSync("running");
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);

    const live = q.syncRow(row.id)!;
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
  });

  it("started_at is PRESERVED after running job is recovered (execution history kept)", async () => {
    const startedAt = new Date(q.now().getTime() - 90_000);
    const row = insertExpiredSync("running");
    q.syncRow(row.id)!.started_at = startedAt; // explicitly set
    q.advanceSecs(1);

    await releaseStaleLeases(supabase);

    // started_at must survive recovery — it records when execution began
    expect(q.syncRow(row.id)!.started_at?.getTime()).toBe(startedAt.getTime());
  });

  it("stale running release does NOT increment attempts", async () => {
    const row = insertExpiredSync("running");
    const attemptsBefore = q.syncRow(row.id)!.attempts;
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);
    expect(q.syncRow(row.id)!.attempts).toBe(attemptsBefore);
  });

  it("released running job is claimable by a new worker", async () => {
    const row = insertExpiredSync("running");
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);

    const jobs = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(row.id);
  });
});

// =============================================================================
// Async stale release (new in 063 — did not exist before)
// =============================================================================

describe("async stale release [NEW IN 063]", () => {
  it("async leased job with expired lease is released", async () => {
    const row = insertExpiredAsync("leased");
    q.advanceSecs(1);
    const released = await releaseStaleLeases(supabase);
    expect(released).toBeGreaterThanOrEqual(1);
    expect(q.asyncRow(row.id)!.status).toBe("queued");
  });

  it("async running job with expired lease is released [was permanently stuck pre-063]", async () => {
    const row = insertExpiredAsync("running");
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);
    expect(q.asyncRow(row.id)!.status).toBe("queued");
    expect(q.asyncRow(row.id)!.attempts).toBe(0);
  });

  it("async stale release does not increment attempts", async () => {
    const row = insertExpiredAsync("running");
    const attemptsBefore = q.asyncRow(row.id)!.attempts;
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);
    expect(q.asyncRow(row.id)!.attempts).toBe(attemptsBefore);
  });

  it("released async job is claimable", async () => {
    const row = insertExpiredAsync("running");
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);
    const jobs = await claimAsyncJobs(supabase, WORKER_2, 1);
    expect(jobs.map((j) => j.id)).toContain(row.id);
  });

  it("releaseStaleLeases counts both sync and async releases", async () => {
    insertExpiredSync("running");        // sync
    insertExpiredAsync("running");       // async
    q.advanceSecs(1);

    const total = await releaseStaleLeases(supabase);
    expect(total).toBe(2);
  });
});

// =============================================================================
// Worker crash simulation (Category 7)
// =============================================================================

describe("worker crash simulation", () => {
  it("crash scenario: worker A claims, crashes mid-execution → worker B eventually takes over", async () => {
    const row = q.insertSync(queuedJob());

    // ── Phase 1: Worker A claims the job ─────────────────────────────────
    const workerAJobs = await claimSyncJobs(supabase, WORKER_1, 1);
    expect(workerAJobs).toHaveLength(1);
    expect(q.syncRow(row.id)!.lease_owner).toBe(WORKER_1);

    // ── Phase 2: Worker A marks running, then crashes ─────────────────────
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.status).toBe("running");

    // Worker A is gone. The lease will expire.
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() - 1);
    q.advanceSecs(1);

    // ── Phase 3: Next tick releases stale leases ──────────────────────────
    const released = await releaseStaleLeases(supabase);
    expect(released).toBeGreaterThanOrEqual(1);

    const afterRelease = q.syncRow(row.id)!;
    expect(afterRelease.status).toBe("queued");
    expect(afterRelease.lease_owner).toBeNull();
    expect(afterRelease.attempts).toBe(0); // crash did NOT burn a retry

    // ── Phase 4: Worker B claims and completes the job ─────────────────────
    const workerBJobs = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(workerBJobs).toHaveLength(1);
    expect(workerBJobs[0].id).toBe(row.id);

    await markSyncJobRunning(supabase, row.id, WORKER_2);
    await markSyncJobSuccess(supabase, row.id, WORKER_2);

    expect(q.syncRow(row.id)!.status).toBe("succeeded");
    expect(q.syncRow(row.id)!.lease_owner).toBeNull();
    expect(q.syncRow(row.id)!.attempts).toBe(0); // completed on first real attempt
  });

  it("stale ack from worker A after recovery is harmlessly rejected [Bug 1 fix]", async () => {
    const row = q.insertSync(queuedJob());

    // Worker A claims and starts running
    await claimSyncJobs(supabase, WORKER_1, 1);
    await markSyncJobRunning(supabase, row.id, WORKER_1);

    // Lease expires, stale-release recovers the job
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() - 1);
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);
    expect(q.syncRow(row.id)!.status).toBe("queued");

    // Worker B claims the recovered job and moves it to running
    const workerBJobs = await claimSyncJobs(supabase, WORKER_2, 1);
    await markSyncJobRunning(supabase, workerBJobs[0].id, WORKER_2);
    expect(q.syncRow(row.id)!.lease_owner).toBe(WORKER_2);

    // Worker A wakes from crash and sends a stale mark_sync_job_failed ack.
    // With the Bug 1 fix, the RPC now checks lease_owner = p_worker_id.
    // Worker A (WORKER_1) is no longer the owner, so the ack is a no-op.
    await markSyncJobFailed(supabase, row.id, "stale ack from Worker A", 60, WORKER_1);

    // Job is still running, still owned by Worker B — Worker A's ack was rejected.
    expect(q.syncRow(row.id)!.status).toBe("running");
    expect(q.syncRow(row.id)!.lease_owner).toBe(WORKER_2);
    expect(q.syncRow(row.id)!.attempts).toBe(0); // not incremented by the stale ack

    // Worker B can still complete the job normally
    await markSyncJobSuccess(supabase, row.id, WORKER_2);
    expect(q.syncRow(row.id)!.status).toBe("succeeded");
  });

  it("lease ownership check: mark_running from non-owner on leased job succeeds (by design)", async () => {
    // Document the explicit contract: the DB RPCs do NOT enforce lease owner identity.
    // The atomicity guarantee comes from SKIP LOCKED at claim time.
    // Once leased, any caller knowing the job_id can mark it running.
    // This is documented here as an explicit design choice, not a bug.
    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    // Worker 2 (not owner) calls mark_running
    await markSyncJobRunning(supabase, row.id, WORKER_2);

    // The guard is only status='leased', not lease_owner=caller
    // So this succeeds
    expect(q.syncRow(row.id)!.status).toBe("running");
  });

  it("async worker crash: running async job recovered, claimed by new worker", async () => {
    const row = insertExpiredAsync("running");
    q.advanceSecs(1);

    await releaseStaleLeases(supabase);
    expect(q.asyncRow(row.id)!.status).toBe("queued");

    const jobs = await claimAsyncJobs(supabase, WORKER_2, 1);
    expect(jobs.map((j) => j.id)).toContain(row.id);
    await markAsyncJobRunning(supabase, row.id, WORKER_2);
    await markAsyncJobSuccess(supabase, row.id, WORKER_2);

    expect(q.asyncRow(row.id)!.status).toBe("succeeded");
  });
});

// =============================================================================
// max_attempts guard: exhausted jobs are NOT released by stale recovery
// =============================================================================

describe("max_attempts guard in stale release", () => {
  it("zombie job (attempts >= max_attempts, crashed on last attempt) is driven to dead_letter [Bug 2 fix]", async () => {
    // A job that crashes on its LAST attempt before calling mark_sync_job_failed
    // previously got permanently stuck: release skipped it (attempts >= max guard)
    // and nothing else could un-stick it without manual DB intervention.
    // The Bug 2 fix adds a zombie dead-letter path in release_stale_*_leases.
    const row = q.insertSync({
      site_id: "00000000-0000-0000-0000-000000000a01",
      loc_ref: "LOC001",
      sync_type: "daily_sales",
      status: "running",
      lease_owner: WORKER_1,
      leased_until: new Date(q.now().getTime() - 1),
      attempts: 5,
      max_attempts: 5,
    });

    q.advanceSecs(1);
    const released = await releaseStaleLeases(supabase);
    expect(released).toBeGreaterThanOrEqual(1); // zombie IS counted
    expect(q.syncRow(row.id)!.status).toBe("dead_letter"); // no longer stuck
    expect(q.syncRow(row.id)!.lease_owner).toBeNull();
    expect(q.syncRow(row.id)!.leased_until).toBeNull();
    expect(q.syncRow(row.id)!.last_error).toBe("zombie: stale lease on exhausted job");
  });

  it("job with attempts < max_attempts IS released by stale recovery", async () => {
    const row = q.insertSync({
      site_id: "00000000-0000-0000-0000-000000000a01",
      loc_ref: "LOC001",
      sync_type: "daily_sales",
      status: "running",
      lease_owner: WORKER_1,
      leased_until: new Date(q.now().getTime() - 1),
      attempts: 4,
      max_attempts: 5,
    });

    q.advanceSecs(1);
    const released = await releaseStaleLeases(supabase);
    expect(released).toBe(1);
    expect(q.syncRow(row.id)!.status).toBe("queued");
  });
});

// =============================================================================
// Non-expired leases are NOT released
// =============================================================================

describe("non-expired leases are untouched by release", () => {
  it("leased job with future leased_until is not released", async () => {
    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000); // 2 min future

    const released = await releaseStaleLeases(supabase);
    expect(released).toBe(0);
    expect(q.syncRow(row.id)!.status).toBe("leased");
  });

  it("running job with future leased_until is not released", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const released = await releaseStaleLeases(supabase);
    expect(released).toBe(0);
    expect(q.syncRow(row.id)!.status).toBe("running");
  });

  it("mix of expired and non-expired: only expired are released", async () => {
    // Expired ones
    const expiredRows = [
      insertExpiredSync("leased"),
      insertExpiredSync("running"),
    ];
    // Non-expired
    const activeRow = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(activeRow.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    q.advanceSecs(1);
    const released = await releaseStaleLeases(supabase);
    expect(released).toBe(2); // only the expired ones

    expect(q.syncRow(expiredRows[0].id)!.status).toBe("queued");
    expect(q.syncRow(expiredRows[1].id)!.status).toBe("queued");
    expect(q.syncRow(activeRow.id)!.status).toBe("leased"); // untouched
  });
});
