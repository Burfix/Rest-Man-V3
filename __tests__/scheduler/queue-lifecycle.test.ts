/**
 * __tests__/scheduler/queue-lifecycle.test.ts
 *
 * Category 1: Job lifecycle correctness
 * Category 12: Cancellation behaviour
 *
 * Proves that:
 *   - Every legal status transition is reachable and produces the correct row state.
 *   - Every illegal transition is silently rejected (status guard = safe stale acks).
 *   - Cancelled jobs cannot be reclaimed by claim functions.
 *
 * The 063 scheduler contract (see migration header comments) defines these legal paths:
 *
 *   queued → leased            (claim)
 *   leased → running           (mark_running)
 *   leased → succeeded         (mark_success — skip-running path)
 *   running → succeeded        (mark_success — normal path)
 *   running → failed → queued  (mark_failed + retry)
 *   failed → dead_letter        (attempts exhausted)
 *   queued → cancelled         (manual)
 *   leased → cancelled         (manual)
 *
 * And these must be no-ops:
 *   queued → succeeded   (can't succeed without a lease)
 *   queued → running     (can't run without being leased first)
 *   succeeded → queued   (terminal — no resurrection)
 *   dead_letter → running (terminal)
 *   cancelled → leased   (terminal — must not be reclaimed)
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
} from "../../lib/scheduler/claim";
import { SITE_A, WORKER_1, WORKER_2, BIZ_DATE, queuedJob, queuedAsyncJob } from "./helpers/factory";

// ── Shared setup ──────────────────────────────────────────────────────────────

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
});

// =============================================================================
// SYNC JOB LIFECYCLE
// =============================================================================

describe("sync job lifecycle", () => {
  // ── queued → leased ─────────────────────────────────────────────────────

  it("claim transitions queued job to leased", async () => {
    const row = q.insertSync(queuedJob());
    const [claimed] = await claimSyncJobs(supabase, WORKER_1, 1);

    expect(claimed).toBeDefined();
    expect(claimed.id).toBe(row.id);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("leased");
    expect(live.lease_owner).toBe(WORKER_1);
    expect(live.leased_until).toBeInstanceOf(Date);
    expect(live.leased_until!.getTime()).toBeGreaterThan(q.now().getTime());
    // No attempt increment at claim (DD1)
    expect(live.attempts).toBe(0);
    // started_at not yet set
    expect(live.started_at).toBeNull();
  });

  // ── leased → running ────────────────────────────────────────────────────

  it("mark_running transitions leased to running and stamps started_at", async () => {
    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    // Assign a leased_until so this is a valid lease
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobRunning(supabase, row.id, WORKER_1);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("running");
    expect(live.started_at).toBeInstanceOf(Date);
    expect(live.lease_owner).toBe(WORKER_1);
    // attempts: still 0
    expect(live.attempts).toBe(0);
  });

  // ── leased → succeeded (skip-running path) ────────────────────────────

  it("mark_success accepts leased state (skip-running path)", async () => {
    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobSuccess(supabase, row.id);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("succeeded");
    expect(live.completed_at).toBeInstanceOf(Date);
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
  });

  // ── running → succeeded ──────────────────────────────────────────────

  it("mark_success transitions running to succeeded", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobSuccess(supabase, row.id);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("succeeded");
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
    expect(live.completed_at).toBeInstanceOf(Date);
  });

  // ── running → failed → queued ────────────────────────────────────────

  it("mark_failed from running requeues the job with backoff", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1, max_attempts: 3 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    const before = q.now().getTime();
    await markSyncJobFailed(supabase, row.id, "disk full", 60);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("queued");
    expect(live.attempts).toBe(1);
    expect(live.last_error).toBe("disk full");
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
    // available_at must be in the future (backoff was applied)
    expect(live.available_at.getTime()).toBeGreaterThan(before);
  });

  // ── attempts exhausted → dead_letter ────────────────────────────────

  it("mark_failed pushes to dead_letter when max_attempts reached", async () => {
    const row = q.insertSync(queuedJob({
      status: "running",
      lease_owner: WORKER_1,
      attempts: 4,  // next failure will be #5
      max_attempts: 5,
    }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobFailed(supabase, row.id, "timeout", 60);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("dead_letter");
    expect(live.attempts).toBe(5);
    expect(live.completed_at).toBeInstanceOf(Date);
    expect(live.lease_owner).toBeNull();
  });

  // ── queued → cancelled ───────────────────────────────────────────────

  it("manually setting cancelled blocks future claims", async () => {
    const row = q.insertSync(queuedJob());
    // Simulate a manual cancel (no RPC — direct DB UPDATE in prod)
    q.syncRow(row.id)!.status = "cancelled";

    const claimed = await claimSyncJobs(supabase, WORKER_1, 1);
    expect(claimed).toHaveLength(0);
  });

  // ── leased → cancelled ───────────────────────────────────────────────

  it("claim cannot pick up a job that was cancelled while leased", async () => {
    const row = q.insertSync(queuedJob());
    // Claim first
    await claimSyncJobs(supabase, WORKER_1, 1);
    expect(q.syncRow(row.id)!.status).toBe("leased");

    // Manually cancel (prod: admin sets status = 'cancelled')
    q.syncRow(row.id)!.status = "cancelled";

    // New worker tries to claim — should get nothing
    const secondClaim = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(secondClaim).toHaveLength(0);
  });
});

// =============================================================================
// ILLEGAL TRANSITIONS — must be silently rejected (status guard)
// =============================================================================

describe("illegal sync transitions are rejected (status guards)", () => {
  it("mark_running on a queued job is a no-op", async () => {
    const row = q.insertSync(queuedJob());
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.status).toBe("queued"); // unchanged
  });

  it("mark_success on a queued job is a no-op", async () => {
    const row = q.insertSync(queuedJob());
    await markSyncJobSuccess(supabase, row.id);
    expect(q.syncRow(row.id)!.status).toBe("queued");
  });

  it("mark_failed on a queued job is a no-op (no attempt burn)", async () => {
    const row = q.insertSync(queuedJob({ attempts: 0 }));
    await markSyncJobFailed(supabase, row.id, "ghost ack", 60);
    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("queued");
    expect(live.attempts).toBe(0); // no attempt burned
  });

  it("mark_success on a succeeded job is a no-op (no double-close)", async () => {
    const row = q.insertSync(queuedJob({ status: "succeeded" }));
    await markSyncJobSuccess(supabase, row.id);
    expect(q.syncRow(row.id)!.status).toBe("succeeded");
  });

  it("mark_running on a succeeded job is a no-op", async () => {
    const row = q.insertSync(queuedJob({ status: "succeeded" }));
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.status).toBe("succeeded");
  });

  it("mark_running on a dead_letter job is a no-op", async () => {
    const row = q.insertSync(queuedJob({ status: "dead_letter" }));
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.status).toBe("dead_letter");
  });

  it("mark_failed on a dead_letter job is a no-op (no extra attempt)", async () => {
    const row = q.insertSync(queuedJob({ status: "dead_letter", attempts: 5 }));
    await markSyncJobFailed(supabase, row.id, "ghost ack", 60);
    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("dead_letter");
    expect(live.attempts).toBe(5); // unchanged
  });

  it("mark_running on a cancelled job is a no-op", async () => {
    const row = q.insertSync(queuedJob({ status: "cancelled" }));
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.status).toBe("cancelled");
  });

  it("cancelled job is not reclaimed even after lease expiry simulation", async () => {
    const expiredLease = new Date(q.now().getTime() - 1_000);
    const row = q.insertSync(queuedJob({
      status: "cancelled",
      leased_until: expiredLease,
      lease_owner: WORKER_1,
    }));
    q.advanceSecs(200);
    const claimed = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(claimed).toHaveLength(0);
    expect(q.syncRow(row.id)!.status).toBe("cancelled");
  });
});

// =============================================================================
// ASYNC JOB LIFECYCLE (equivalent coverage for async_job_queue)
// =============================================================================

describe("async job lifecycle", () => {
  it("claim transitions async queued → leased", async () => {
    const row = q.insertAsync(queuedAsyncJob());
    const [claimed] = await claimAsyncJobs(supabase, WORKER_1, 1);

    expect(claimed.id).toBe(row.id);
    const live = q.asyncRow(row.id)!;
    expect(live.status).toBe("leased");
    expect(live.lease_owner).toBe(WORKER_1);
    expect(live.attempts).toBe(0); // DD1: no increment at claim
  });

  it("mark_async_running transitions leased → running", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "leased", lease_owner: WORKER_1 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);

    await markAsyncJobRunning(supabase, row.id, WORKER_1);

    const live = q.asyncRow(row.id)!;
    expect(live.status).toBe("running");
    expect(live.started_at).toBeInstanceOf(Date);
    expect(live.attempts).toBe(0);
  });

  it("mark_async_success from running → succeeded", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "running", lease_owner: WORKER_1 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);

    await markAsyncJobSuccess(supabase, row.id);

    const live = q.asyncRow(row.id)!;
    expect(live.status).toBe("succeeded");
    expect(live.completed_at).toBeInstanceOf(Date);
    expect(live.lease_owner).toBeNull();
  });

  it("mark_async_failed requeues with backoff (async cap is 7200)", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "running", lease_owner: WORKER_1, max_attempts: 3 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);

    await markAsyncJobFailed(supabase, row.id, "timeout", 120);

    const live = q.asyncRow(row.id)!;
    expect(live.status).toBe("queued");
    expect(live.attempts).toBe(1);
    expect(live.available_at.getTime()).toBeGreaterThan(q.now().getTime());
  });

  it("async mark_failed on a succeeded job is a no-op", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "succeeded" }));
    await markAsyncJobFailed(supabase, row.id, "stale ack", 120);
    expect(q.asyncRow(row.id)!.status).toBe("succeeded");
    expect(q.asyncRow(row.id)!.attempts).toBe(0);
  });

  it("cancelled async job is not claimed", async () => {
    const row = q.insertAsync(queuedAsyncJob());
    q.asyncRow(row.id)!.status = "cancelled";

    const claimed = await claimAsyncJobs(supabase, WORKER_1, 1);
    expect(claimed).toHaveLength(0);
  });
});

// =============================================================================
// LEASE FIELD HYGIENE
// =============================================================================

describe("lease field hygiene", () => {
  it("succeeded job has null lease_owner and leased_until", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobSuccess(supabase, row.id);

    const live = q.syncRow(row.id)!;
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
  });

  it("failed job (requeued) has null lease fields", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1, max_attempts: 3 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobFailed(supabase, row.id, "err", 60);

    const live = q.syncRow(row.id)!;
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
  });

  it("dead_letter job has null lease fields and populated completed_at", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1, attempts: 4, max_attempts: 5 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobFailed(supabase, row.id, "final err", 60);

    const live = q.syncRow(row.id)!;
    expect(live.status).toBe("dead_letter");
    expect(live.lease_owner).toBeNull();
    expect(live.leased_until).toBeNull();
    expect(live.completed_at).toBeInstanceOf(Date);
  });

  it("claimed job has a future leased_until", async () => {
    q.insertSync(queuedJob());
    const [job] = await claimSyncJobs(supabase, WORKER_1, 1);
    const live = q.syncRow(job.id)!;
    expect(live.leased_until!.getTime()).toBeGreaterThan(q.now().getTime());
  });
});
