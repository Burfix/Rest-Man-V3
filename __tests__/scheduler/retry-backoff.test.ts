/**
 * __tests__/scheduler/retry-backoff.test.ts
 *
 * Category 3: Retry and backoff correctness
 *
 * Validates the exponential backoff formula from migration 063:
 *
 *   sync  backoff = LEAST(delay * 2^v_attempts, 14400)
 *   async backoff = LEAST(delay * 2^v_attempts,  7200)
 *
 * where v_attempts is the pre-increment value (attempts in DB before the failure call).
 *
 * With default delay=60 (sync):
 *   Failure 1 (attempts=0): 60 * 2^0 = 60 s
 *   Failure 2 (attempts=1): 60 * 2^1 = 120 s
 *   Failure 3 (attempts=2): 60 * 2^2 = 240 s
 *   Failure 4 (attempts=3): 60 * 2^3 = 480 s
 *   Failure 5 (attempts=4): 60 * 2^4 = 960 s
 *
 * Capping:
 *   A very large delay (99999, non-retryable) × high exponent still caps at 14400.
 *
 * Dead-letter:
 *   When v_new_attempts >= max_attempts, status becomes dead_letter.
 *   Dead-letter jobs CANNOT be claimed by normal claim functions.
 *   Dead-letter available_at is NOT advanced (row stays at original available_at).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockQueue, createMockSupabase } from "./helpers/MockQueue";
import {
  claimSyncJobs,
  claimAsyncJobs,
  markSyncJobFailed,
  markAsyncJobFailed,
} from "../../lib/scheduler/claim";
import { SITE_A, WORKER_1, BIZ_DATE, queuedJob, queuedAsyncJob } from "./helpers/factory";

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Set a row to leased/running so it can be failed, then call mark_failed.
 * Returns the backoff duration in seconds (available_at - now_before_fail).
 */
async function failSync(
  jobId: string,
  attempts: number,
  max_attempts: number,
  delay: number,
): Promise<{ backoffMs: number; status: string }> {
  const row = q.syncRow(jobId)!;
  row.status = "leased";
  row.attempts = attempts;
  row.max_attempts = max_attempts;
  row.lease_owner = WORKER_1;
  row.leased_until = new Date(q.now().getTime() + 120_000);

  const nowMs = q.now().getTime();
  await markSyncJobFailed(supabase, jobId, "test failure", delay);
  const live = q.syncRow(jobId)!;
  return {
    backoffMs: live.available_at.getTime() - nowMs,
    status: live.status,
  };
}

async function failAsync(
  jobId: string,
  attempts: number,
  max_attempts: number,
  delay: number,
): Promise<{ backoffMs: number; status: string }> {
  const row = q.asyncRow(jobId)!;
  row.status = "leased";
  row.attempts = attempts;
  row.max_attempts = max_attempts;
  row.lease_owner = WORKER_1;
  row.leased_until = new Date(q.now().getTime() + 300_000);

  const nowMs = q.now().getTime();
  await markAsyncJobFailed(supabase, jobId, "test failure", delay);
  const live = q.asyncRow(jobId)!;
  return {
    backoffMs: live.available_at.getTime() - nowMs,
    status: live.status,
  };
}

// =============================================================================
// Sync backoff formula verification
// =============================================================================

describe("sync backoff formula: LEAST(delay * 2^attempts, 14400)", () => {
  it("failure 1 (attempts=0): backoff = delay * 1 = 60 s", async () => {
    const row = q.insertSync(queuedJob());
    const { backoffMs, status } = await failSync(row.id, 0, 5, 60);
    expect(status).toBe("queued");
    expect(backoffMs).toBe(60 * 1_000);
  });

  it("failure 2 (attempts=1): backoff = delay * 2 = 120 s", async () => {
    const row = q.insertSync(queuedJob());
    const { backoffMs, status } = await failSync(row.id, 1, 5, 60);
    expect(status).toBe("queued");
    expect(backoffMs).toBe(120 * 1_000);
  });

  it("failure 3 (attempts=2): backoff = delay * 4 = 240 s", async () => {
    const row = q.insertSync(queuedJob());
    const { backoffMs } = await failSync(row.id, 2, 5, 60);
    expect(backoffMs).toBe(240 * 1_000);
  });

  it("failure 4 (attempts=3): backoff = delay * 8 = 480 s", async () => {
    const row = q.insertSync(queuedJob());
    const { backoffMs } = await failSync(row.id, 3, 5, 60);
    expect(backoffMs).toBe(480 * 1_000);
  });

  it("failure 5 (attempts=4): backoff = delay * 16 = 960 s", async () => {
    const row = q.insertSync(queuedJob());
    const { backoffMs } = await failSync(row.id, 4, 10, 60);
    expect(backoffMs).toBe(960 * 1_000);
  });

  it("sync backoff is capped at 14400 s (4 hours)", async () => {
    const row = q.insertSync(queuedJob());
    // attempts=20: 60 * 2^20 = 62,914,560 → capped at 14400
    const { backoffMs } = await failSync(row.id, 20, 30, 60);
    expect(backoffMs).toBe(14400 * 1_000);
  });

  it("non-retryable delay (99999) still caps at 14400 s", async () => {
    const row = q.insertSync(queuedJob());
    const { backoffMs, status } = await failSync(row.id, 0, 5, 99999);
    expect(status).toBe("queued");
    expect(backoffMs).toBe(14400 * 1_000); // capped
  });

  it("available_at is strictly greater than now when requeued", async () => {
    const row = q.insertSync(queuedJob());
    const row2 = q.syncRow(row.id)!;
    row2.status = "running";
    row2.lease_owner = WORKER_1;
    row2.leased_until = new Date(q.now().getTime() + 120_000);

    await markSyncJobFailed(supabase, row.id, "err", 60);
    expect(q.syncRow(row.id)!.available_at.getTime()).toBeGreaterThan(q.now().getTime());
  });
});

// =============================================================================
// Async backoff formula verification (cap is 7200, not 14400)
// =============================================================================

describe("async backoff formula: LEAST(delay * 2^attempts, 7200)", () => {
  it("failure 1 (attempts=0): backoff = 120 * 1 = 120 s", async () => {
    const row = q.insertAsync(queuedAsyncJob());
    const { backoffMs, status } = await failAsync(row.id, 0, 3, 120);
    expect(status).toBe("queued");
    expect(backoffMs).toBe(120 * 1_000);
  });

  it("failure 2 (attempts=1): backoff = 120 * 2 = 240 s", async () => {
    const row = q.insertAsync(queuedAsyncJob());
    const { backoffMs } = await failAsync(row.id, 1, 5, 120);
    expect(backoffMs).toBe(240 * 1_000);
  });

  it("async backoff is capped at 7200 s (2 hours)", async () => {
    const row = q.insertAsync(queuedAsyncJob());
    const { backoffMs } = await failAsync(row.id, 20, 30, 120);
    expect(backoffMs).toBe(7200 * 1_000);
  });

  it("async cap is 7200, not 14400 (stricter than sync)", async () => {
    const syncRow = q.insertSync(queuedJob());
    const asyncRow = q.insertAsync(queuedAsyncJob());

    const { backoffMs: syncBackoff } = await failSync(syncRow.id, 20, 30, 120);
    const { backoffMs: asyncBackoff } = await failAsync(asyncRow.id, 20, 30, 120);

    expect(syncBackoff).toBe(14400 * 1_000);
    expect(asyncBackoff).toBe(7200 * 1_000);
    expect(asyncBackoff).toBeLessThan(syncBackoff);
  });
});

// =============================================================================
// Dead-letter transitions
// =============================================================================

describe("dead-letter: unreachable by claim after max_attempts exhausted", () => {
  it("sync max_attempts=1: first failure → dead_letter immediately", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 1 }));
    const { status } = await failSync(row.id, 0, 1, 60);
    expect(status).toBe("dead_letter");
    expect(q.syncRow(row.id)!.attempts).toBe(1);
  });

  it("async max_attempts=1: first failure → dead_letter immediately", async () => {
    const row = q.insertAsync(queuedAsyncJob({ max_attempts: 1 }));
    const { status } = await failAsync(row.id, 0, 1, 120);
    expect(status).toBe("dead_letter");
  });

  it("sync dead_letter job has completed_at stamped", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 1 }));
    await failSync(row.id, 0, 1, 60);
    expect(q.syncRow(row.id)!.completed_at).toBeInstanceOf(Date);
  });

  it("dead_letter job is not picked up by claimSyncJobs", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 1 }));
    await failSync(row.id, 0, 1, 60);
    expect(q.syncRow(row.id)!.status).toBe("dead_letter");

    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    expect(claimed.map((j) => j.id)).not.toContain(row.id);
  });

  it("dead_letter job is not picked up by claimAsyncJobs", async () => {
    const row = q.insertAsync(queuedAsyncJob({ max_attempts: 1 }));
    await failAsync(row.id, 0, 1, 120);
    expect(q.asyncRow(row.id)!.status).toBe("dead_letter");

    const claimed = await claimAsyncJobs(supabase, WORKER_1, 10);
    expect(claimed.map((j) => j.id)).not.toContain(row.id);
  });

  it("dead_letter available_at is NOT advanced beyond the original", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 1 }));
    const originalAvailableAt = q.syncRow(row.id)!.available_at.getTime();
    await failSync(row.id, 0, 1, 60);
    // dead_letter: available_at should equal the original (not pushed forward)
    expect(q.syncRow(row.id)!.available_at.getTime()).toBe(originalAvailableAt);
  });

  it("last_error is preserved on dead_letter", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 1 }));
    await failSync(row.id, 0, 1, 60);
    // The failSync helper uses "test failure" as the error message
    expect(q.syncRow(row.id)!.last_error).toBe("test failure");
  });
});

// =============================================================================
// Backoff means the job is NOT immediately reclaimable
// =============================================================================

describe("backoff delay prevents immediate reclaim", () => {
  it("sync requeued job is not immediately claimable (before backoff expires)", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));
    await failSync(row.id, 0, 5, 60); // backoff = 60 s
    expect(q.syncRow(row.id)!.status).toBe("queued");

    // Try to claim immediately — should not get the job (available_at is 60s away)
    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    expect(claimed.map((j) => j.id)).not.toContain(row.id);
  });

  it("sync requeued job IS claimable after backoff expires", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));
    await failSync(row.id, 0, 5, 60); // backoff = 60 s
    expect(q.syncRow(row.id)!.status).toBe("queued");

    // Advance past backoff
    q.advanceSecs(61);
    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    expect(claimed.map((j) => j.id)).toContain(row.id);
  });

  it("each successive failure doubles the wait before reclaim is possible", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 10 }));
    const delay = 60;
    let cumulativeAdvanced = 0;

    for (let expectedAttempts = 0; expectedAttempts < 4; expectedAttempts++) {
      const expectedBackoff = delay * Math.pow(2, expectedAttempts);

      // Fail the job
      await failSync(row.id, expectedAttempts, 10, delay);
      expect(q.syncRow(row.id)!.attempts).toBe(expectedAttempts + 1);

      // Confirm not immediately claimable
      const notYet = await claimSyncJobs(supabase, WORKER_1, 10);
      expect(notYet.map((j) => j.id)).not.toContain(row.id);

      // Advance past backoff
      q.advanceSecs(expectedBackoff + 1);
      cumulativeAdvanced += expectedBackoff + 1;
    }

    // Should be claimable now
    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    expect(claimed.map((j) => j.id)).toContain(row.id);
  });
});
