/**
 * __tests__/scheduler/attempts-accounting.test.ts
 *
 * Category 2: Attempts accounting correctness
 *
 * This is the most business-critical invariant in the scheduler:
 *
 *   "A claimed-but-never-run job must not consume a retry."
 *   "Only an execution that actually attempts the work and fails
 *    should count as an attempt."
 *
 * The 063 migration redesign moved `attempts++` from claim_* to mark_*_failed.
 * Every test here guards that design decision under adversarial conditions.
 *
 * Guarantees under test:
 *   G1: claimSyncJobs / claimAsyncJobs NEVER increments attempts.
 *   G2: markSyncJobRunning / markAsyncJobRunning NEVER increments attempts.
 *   G3: releaseStaleLeases (both queues) NEVER increments attempts.
 *   G4: markSyncJobSuccess / markAsyncJobSuccess NEVER increments attempts.
 *   G5: markSyncJobFailed / markAsyncJobFailed increments attempts by EXACTLY 1.
 *   G6: Multiple reclaim cycles WITHOUT failure do not accumulate attempts.
 *   G7: Attempts tracks the number of distinct failure events precisely.
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
import { SITE_A, WORKER_1, WORKER_2, BIZ_DATE, queuedJob, queuedAsyncJob } from "./helpers/factory";

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
});

// =============================================================================
// G1: Claim does NOT increment attempts
// =============================================================================

describe("G1: claim does not increment attempts", () => {
  it("sync claim: attempts stays 0 after claim", async () => {
    const row = q.insertSync(queuedJob({ attempts: 0 }));
    await claimSyncJobs(supabase, WORKER_1, 1);
    expect(q.syncRow(row.id)!.attempts).toBe(0);
  });

  it("async claim: attempts stays 0 after claim", async () => {
    const row = q.insertAsync(queuedAsyncJob({ attempts: 0 }));
    await claimAsyncJobs(supabase, WORKER_1, 1);
    expect(q.asyncRow(row.id)!.attempts).toBe(0);
  });

  it("attempts stays 0 across 5 consecutive claim-and-abandon cycles", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 10 }));

    for (let i = 0; i < 5; i++) {
      // Claim the job
      const jobs = await claimSyncJobs(supabase, WORKER_1, 1);
      expect(jobs).toHaveLength(1);
      // Simulate worker crash: expire the lease
      q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() - 1);
      q.advanceSecs(1);
      // Release stale lease
      await releaseStaleLeases(supabase);
      // Must be back to queued
      expect(q.syncRow(row.id)!.status).toBe("queued");
    }

    // After 5 claim+abandon cycles, attempts still 0
    expect(q.syncRow(row.id)!.attempts).toBe(0);
  });

  it("stale running recovery also does not increment attempts", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));
    // Claim it
    await claimSyncJobs(supabase, WORKER_1, 1);
    // Mark running
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.status).toBe("running");
    expect(q.syncRow(row.id)!.attempts).toBe(0);

    // Worker dies mid-execution → expire lease
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() - 1);
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);

    expect(q.syncRow(row.id)!.status).toBe("queued");
    expect(q.syncRow(row.id)!.attempts).toBe(0); // key invariant
  });
});

// =============================================================================
// G2: mark_running does NOT increment attempts
// =============================================================================

describe("G2: mark_running does not increment attempts", () => {
  it("sync mark_running: attempts unchanged", async () => {
    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, attempts: 2 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);
    await markSyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.syncRow(row.id)!.attempts).toBe(2);
  });

  it("async mark_running: attempts unchanged", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "leased", lease_owner: WORKER_1, attempts: 1 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);
    await markAsyncJobRunning(supabase, row.id, WORKER_1);
    expect(q.asyncRow(row.id)!.attempts).toBe(1);
  });
});

// =============================================================================
// G3: Stale lease release does NOT increment attempts
// =============================================================================

describe("G3: stale lease release does not increment attempts", () => {
  it("sync stale leased recovery: attempts unchanged", async () => {
    const before = q.now();
    const row = q.insertSync(queuedJob({
      status: "leased",
      lease_owner: WORKER_1,
      attempts: 0,
      leased_until: new Date(before.getTime() + 1), // expires almost immediately
    }));

    q.advanceSecs(2);
    await releaseStaleLeases(supabase);

    expect(q.syncRow(row.id)!.status).toBe("queued");
    expect(q.syncRow(row.id)!.attempts).toBe(0);
  });

  it("sync stale running recovery: attempts unchanged", async () => {
    const before = q.now();
    const row = q.insertSync(queuedJob({
      status: "running",
      lease_owner: WORKER_1,
      attempts: 0,
      leased_until: new Date(before.getTime() + 1),
    }));

    q.advanceSecs(2);
    await releaseStaleLeases(supabase);

    expect(q.syncRow(row.id)!.status).toBe("queued");
    expect(q.syncRow(row.id)!.attempts).toBe(0);
  });

  it("async stale leased recovery: attempts unchanged", async () => {
    const before = q.now();
    const row = q.insertAsync(queuedAsyncJob({
      status: "leased",
      lease_owner: WORKER_1,
      attempts: 1,
      leased_until: new Date(before.getTime() + 1),
    }));

    q.advanceSecs(2);
    await releaseStaleLeases(supabase);

    expect(q.asyncRow(row.id)!.status).toBe("queued");
    expect(q.asyncRow(row.id)!.attempts).toBe(1); // unchanged
  });

  it("async stale running recovery: attempts unchanged", async () => {
    const before = q.now();
    const row = q.insertAsync(queuedAsyncJob({
      status: "running",
      lease_owner: WORKER_1,
      attempts: 2,
      leased_until: new Date(before.getTime() + 1),
    }));

    q.advanceSecs(2);
    await releaseStaleLeases(supabase);

    expect(q.asyncRow(row.id)!.status).toBe("queued");
    expect(q.asyncRow(row.id)!.attempts).toBe(2);
  });
});

// =============================================================================
// G4: Mark success does NOT increment attempts
// =============================================================================

describe("G4: mark_success does not increment attempts", () => {
  it("sync mark_success: attempts unchanged", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1, attempts: 3 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);
    await markSyncJobSuccess(supabase, row.id);
    expect(q.syncRow(row.id)!.attempts).toBe(3);
  });

  it("async mark_success: attempts unchanged", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "running", lease_owner: WORKER_1, attempts: 2 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);
    await markAsyncJobSuccess(supabase, row.id);
    expect(q.asyncRow(row.id)!.attempts).toBe(2);
  });
});

// =============================================================================
// G5: mark_failed increments attempts by EXACTLY 1
// =============================================================================

describe("G5: mark_failed increments attempts by exactly 1 per failure event", () => {
  it("sync: attempts 0 → 1 on first failure", async () => {
    const row = q.insertSync(queuedJob({ status: "running", lease_owner: WORKER_1, attempts: 0, max_attempts: 5 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);
    await markSyncJobFailed(supabase, row.id, "err", 60);
    expect(q.syncRow(row.id)!.attempts).toBe(1);
  });

  it("sync: attempts 2 → 3 on third failure", async () => {
    const row = q.insertSync(queuedJob({ status: "leased", lease_owner: WORKER_1, attempts: 2, max_attempts: 5 }));
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() + 120_000);
    await markSyncJobFailed(supabase, row.id, "err", 60);
    expect(q.syncRow(row.id)!.attempts).toBe(3);
  });

  it("async: attempts 0 → 1 on first failure", async () => {
    const row = q.insertAsync(queuedAsyncJob({ status: "running", lease_owner: WORKER_1, attempts: 0, max_attempts: 3 }));
    q.asyncRow(row.id)!.leased_until = new Date(q.now().getTime() + 300_000);
    await markAsyncJobFailed(supabase, row.id, "err", 120);
    expect(q.asyncRow(row.id)!.attempts).toBe(1);
  });
});

// =============================================================================
// G6: Multiple claim-abandon cycles accumulate 0 attempts
// =============================================================================

describe("G6: claim + crash cycles do not burn retries", () => {
  it("10 crash cycles → attempts still 0, job still claimable", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));

    for (let cycle = 0; cycle < 10; cycle++) {
      const jobs = await claimSyncJobs(supabase, WORKER_1, 1);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toBe(0);
      // Crash: expire lease
      q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() - 1);
      q.advanceSecs(1);
      await releaseStaleLeases(supabase);
    }

    expect(q.syncRow(row.id)!.attempts).toBe(0);
    expect(q.syncRow(row.id)!.status).toBe("queued");
  });
});

// =============================================================================
// G7: Attempts tracks the exact number of failure events
// =============================================================================

describe("G7: attempts tracks distinct failure events precisely", () => {
  it("sync: claim → run → fail → requeue → claim → run → fail: attempts = 2", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));

    for (let failureNum = 1; failureNum <= 2; failureNum++) {
      const jobs = await claimSyncJobs(supabase, WORKER_1, 1);
      expect(jobs[0].attempts).toBe(failureNum - 1);
      await markSyncJobRunning(supabase, jobs[0].id, WORKER_1);
      // advance time past retry backoff to reclaim
      q.advanceMins(30);
      await markSyncJobFailed(supabase, jobs[0].id, "transient error", 60);
      expect(q.syncRow(row.id)!.attempts).toBe(failureNum);
      // Move past backoff for next iteration
      q.advanceMins(30);
    }

    expect(q.syncRow(row.id)!.attempts).toBe(2);
    expect(q.syncRow(row.id)!.status).toBe("queued");
  });

  it("async: 3 failures exhausts max_attempts and reaches dead_letter", async () => {
    const row = q.insertAsync(queuedAsyncJob({ max_attempts: 3 }));

    for (let i = 0; i < 3; i++) {
      const jobs = await claimAsyncJobs(supabase, WORKER_1, 1);
      expect(jobs[0].attempts).toBe(i);
      await markAsyncJobRunning(supabase, jobs[0].id, WORKER_1);
      q.advanceMins(30);
      await markAsyncJobFailed(supabase, jobs[0].id, "boom", 60);
      // Move past backoff for next iteration (except last)
      if (i < 2) q.advanceMins(30);
    }

    const final = q.asyncRow(row.id)!;
    expect(final.attempts).toBe(3);
    expect(final.status).toBe("dead_letter");
  });

  it("sync: successful execution after 2 failures keeps attempts=2 (no reset)", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));

    // Two failures
    for (let i = 0; i < 2; i++) {
      const jobs = await claimSyncJobs(supabase, WORKER_1, 1);
      await markSyncJobRunning(supabase, jobs[0].id, WORKER_1);
      q.advanceMins(30);
      await markSyncJobFailed(supabase, jobs[0].id, "transient", 60);
      q.advanceMins(30);
    }

    // Successful third attempt
    const jobs = await claimSyncJobs(supabase, WORKER_1, 1);
    await markSyncJobRunning(supabase, jobs[0].id, WORKER_1);
    await markSyncJobSuccess(supabase, jobs[0].id);

    const final = q.syncRow(row.id)!;
    expect(final.status).toBe("succeeded");
    expect(final.attempts).toBe(2); // reflects history of failures, not current run
  });
});
