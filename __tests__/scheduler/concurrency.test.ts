/**
 * __tests__/scheduler/concurrency.test.ts
 *
 * Category 5: Concurrency correctness
 *
 * This is the most important category in the suite.
 *
 * The DB-backed scheduler uses PostgreSQL FOR UPDATE SKIP LOCKED to prevent
 * duplicate claims across concurrent workers. In this in-memory test harness,
 * atomicity is guaranteed by JavaScript's single-threaded event loop:
 * each `rpc()` call mutates the Map synchronously before yielding, so
 * concurrent Promise.all() invocations serialize correctly.
 *
 * Tests in this file verify:
 *   - Two workers claiming from the same pool never get overlapping job sets.
 *   - Total claimed across all workers never exceeds total available.
 *   - Workers at/above their limit never over-claim.
 *   - A job claimed by Worker A cannot be re-claimed by Worker B until the
 *     lease expires or the job is completed/failed.
 *   - Concurrent claim + release rounds preserve the invariant.
 *   - Large fan-out: 100 jobs × 5 workers = correct partition with no duplicates.
 *
 * Note on JavaScript concurrency model:
 *   In production, concurrent workers run in separate Node.js processes (Vercel
 *   functions). The DB guarantee (SKIP LOCKED) ensures no duplicates there.
 *   In this harness, Promise.all() serializes the synchronous claim mutation —
 *   the first promise to reach the RPC mutates first. This correctly simulates
 *   what SKIP LOCKED achieves: the "loser" sees the already-updated state.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockQueue, createMockSupabase } from "./helpers/MockQueue";
import {
  claimSyncJobs,
  claimAsyncJobs,
  markSyncJobSuccess,
  markSyncJobFailed,
  markAsyncJobSuccess,
  releaseStaleLeases,
} from "../../lib/scheduler/claim";
import { SITE_A, WORKER_1, WORKER_2, WORKER_3, BIZ_DATE, queuedJob, queuedAsyncJob } from "./helpers/factory";

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seed N distinct queued sync jobs and return their IDs. */
function seedSyncJobs(n: number, priority = 100): string[] {
  return Array.from({ length: n }, (_, i) =>
    q.insertSync({
      site_id: SITE_A,
      loc_ref: `LOC${String(i).padStart(3, "0")}`,
      sync_type: "daily_sales",
      business_date: BIZ_DATE,
      priority,
    }).id,
  );
}

function seedAsyncJobs(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    q.insertAsync({
      job_type: "compute_accountability",
      payload: { index: i },
    }).id,
  );
}

/** Run concurrent claim calls and return the combined list of claimed job IDs. */
async function claimConcurrently(
  workerIds: string[],
  limit: number,
): Promise<{ workerId: string; jobId: string }[]> {
  const allResults = await Promise.all(
    workerIds.map((wid) => claimSyncJobs(supabase, wid, limit)),
  );
  return allResults.flatMap((jobs, wi) =>
    jobs.map((j) => ({ workerId: workerIds[wi], jobId: j.id })),
  );
}

// =============================================================================
// Two workers — no duplicate claims
// =============================================================================

describe("two workers claiming concurrently — no duplicates", () => {
  it("2 workers × 5 limit on 10 jobs → exactly 10 unique claims", async () => {
    const ids = seedSyncJobs(10);
    const claims = await claimConcurrently([WORKER_1, WORKER_2], 5);

    expect(claims).toHaveLength(10);
    const claimedIds = claims.map((c) => c.jobId);
    const uniqueIds = new Set(claimedIds);
    expect(uniqueIds.size).toBe(10); // no duplicates
    expect(Array.from(uniqueIds).sort()).toEqual(ids.sort());
  });

  it("2 workers × 10 limit on 8 jobs → 8 claims total (no over-claim)", async () => {
    seedSyncJobs(8);
    const claims = await claimConcurrently([WORKER_1, WORKER_2], 10);

    expect(claims).toHaveLength(8);
    const unique = new Set(claims.map((c) => c.jobId));
    expect(unique.size).toBe(8);
  });

  it("jobs are partitioned between workers (no job appears in both sets)", async () => {
    seedSyncJobs(10);
    const [w1Jobs, w2Jobs] = await Promise.all([
      claimSyncJobs(supabase, WORKER_1, 5),
      claimSyncJobs(supabase, WORKER_2, 5),
    ]);

    const w1Ids = new Set(w1Jobs.map((j) => j.id));
    const w2Ids = new Set(w2Jobs.map((j) => j.id));

    // Intersection must be empty
    for (const id of Array.from(w1Ids)) {
      expect(w2Ids.has(id)).toBe(false);
    }
  });

  it("a job claimed by Worker 1 has lease_owner = WORKER_1, not WORKER_2", async () => {
    seedSyncJobs(6);
    const [w1Jobs, w2Jobs] = await Promise.all([
      claimSyncJobs(supabase, WORKER_1, 3),
      claimSyncJobs(supabase, WORKER_2, 3),
    ]);

    for (const job of w1Jobs) {
      expect(q.syncRow(job.id)!.lease_owner).toBe(WORKER_1);
    }
    for (const job of w2Jobs) {
      expect(q.syncRow(job.id)!.lease_owner).toBe(WORKER_2);
    }
  });
});

// =============================================================================
// Large fan-out: 100 jobs × 5 workers
// =============================================================================

describe("large fan-out: 100 jobs × 5 workers", () => {
  it("5 workers × 20 limit on 100 jobs → exactly 100 unique claims", async () => {
    const ids = seedSyncJobs(100);
    const workers = [WORKER_1, WORKER_2, WORKER_3, "worker-4", "worker-5"];

    const allClaims = await Promise.all(
      workers.map((wid) => claimSyncJobs(supabase, wid, 20)),
    );

    const allIds = allClaims.flatMap((jobs) => jobs.map((j) => j.id));
    expect(allIds).toHaveLength(100);
    expect(new Set(allIds).size).toBe(100);
    expect(new Set(allIds)).toEqual(new Set(ids));
  });

  it("5 workers × 10 limit on 100 jobs → 50 claims (limit enforced per worker)", async () => {
    seedSyncJobs(100);
    const workers = [WORKER_1, WORKER_2, WORKER_3, "worker-4", "worker-5"];

    const allClaims = await Promise.all(
      workers.map((wid) => claimSyncJobs(supabase, wid, 10)),
    );

    // Each worker should get exactly 10 (or fewer if pool dries up)
    for (const workerClaims of allClaims) {
      expect(workerClaims.length).toBeLessThanOrEqual(10);
    }

    const allIds = allClaims.flatMap((jobs) => jobs.map((j) => j.id));
    expect(new Set(allIds).size).toBe(allIds.length); // no duplicates
    expect(allIds).toHaveLength(50); // 5 workers × 10 each
  });

  it("20 jobs, 3 workers with limit 5 → 15 total, 5 jobs unclaimed", async () => {
    const allIds = seedSyncJobs(20);
    const workers = [WORKER_1, WORKER_2, WORKER_3];

    const allClaims = await Promise.all(
      workers.map((wid) => claimSyncJobs(supabase, wid, 5)),
    );
    const claimed = allClaims.flatMap((jobs) => jobs.map((j) => j.id));
    expect(claimed).toHaveLength(15);
    expect(new Set(claimed).size).toBe(15);

    // 5 jobs remain queued
    const stillQueued = q.syncByStatus("queued");
    expect(stillQueued).toHaveLength(5);
    // Queued ones were NOT in the claimed set
    for (const row of stillQueued) {
      expect(claimed).not.toContain(row.id);
    }
  });
});

// =============================================================================
// Currently leased jobs cannot be re-claimed before lease expiry
// =============================================================================

describe("active leases block duplicate claims", () => {
  it("job leased by Worker 1 cannot be claimed by Worker 2 before expiry", async () => {
    const row = q.insertSync(queuedJob());

    const [clip] = await claimSyncJobs(supabase, WORKER_1, 1);
    expect(clip.id).toBe(row.id);
    expect(q.syncRow(row.id)!.status).toBe("leased");

    // Worker 2 tries immediately (lease still valid)
    const w2 = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(w2).toHaveLength(0); // nothing available
  });

  it("job leased by Worker 1 CAN be claimed by Worker 2 after lease expiry + release", async () => {
    const row = q.insertSync(queuedJob());

    await claimSyncJobs(supabase, WORKER_1, 1);
    // Expire the lease
    q.syncRow(row.id)!.leased_until = new Date(q.now().getTime() - 1);
    q.advanceSecs(1);
    await releaseStaleLeases(supabase);

    const w2 = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(w2).toHaveLength(1);
    expect(w2[0].id).toBe(row.id);
  });

  it("succeeded job is not re-claimable", async () => {
    const row = q.insertSync(queuedJob());
    const [job] = await claimSyncJobs(supabase, WORKER_1, 1);
    await markSyncJobSuccess(supabase, job.id);

    const w2 = await claimSyncJobs(supabase, WORKER_2, 1);
    expect(w2.map((j) => j.id)).not.toContain(row.id);
  });
});

// =============================================================================
// Priority ordering under concurrency
// =============================================================================

describe("priority ordering is respected under concurrent claim", () => {
  it("higher-priority jobs (lower priority number) are claimed first", async () => {
    // Insert 5 low-priority then 5 high-priority
    const lowPriIds = Array.from({ length: 5 }, () =>
      q.insertSync(queuedJob({ priority: 200 })).id,
    );
    const highPriIds = Array.from({ length: 5 }, () =>
      q.insertSync(queuedJob({ priority: 50 })).id,
    );

    const claimed = await claimSyncJobs(supabase, WORKER_1, 5);
    const claimedIdSet = new Set(claimed.map((j) => j.id));

    // All 5 claimed should be the high-priority ones
    for (const id of highPriIds) {
      expect(claimedIdSet.has(id)).toBe(true);
    }
    for (const id of lowPriIds) {
      expect(claimedIdSet.has(id)).toBe(false);
    }
  });
});

// =============================================================================
// Async concurrency
// =============================================================================

describe("async queue concurrent claims", () => {
  it("2 workers × 5 limit on 10 async jobs → 10 unique claims", async () => {
    seedAsyncJobs(10);

    const [w1, w2] = await Promise.all([
      claimAsyncJobs(supabase, WORKER_1, 5),
      claimAsyncJobs(supabase, WORKER_2, 5),
    ]);

    const allIds = [...w1, ...w2].map((j) => j.id);
    expect(allIds).toHaveLength(10);
    expect(new Set(allIds).size).toBe(10);
  });

  it("async jobs owned by different workers don't interfere", async () => {
    seedAsyncJobs(6);
    const [w1, w2] = await Promise.all([
      claimAsyncJobs(supabase, WORKER_1, 3),
      claimAsyncJobs(supabase, WORKER_2, 3),
    ]);

    for (const job of w1) {
      expect(q.asyncRow(job.id)!.lease_owner).toBe(WORKER_1);
    }
    for (const job of w2) {
      expect(q.asyncRow(job.id)!.lease_owner).toBe(WORKER_2);
    }
  });
});

// =============================================================================
// Claim → complete → claim cycle under concurrency
// =============================================================================

describe("claim/complete/claim cycle with multiple workers", () => {
  it("after Worker 1 completes its jobs, Worker 2 sees no new jobs (pool empty)", async () => {
    seedSyncJobs(5);

    // Worker 1 claims and completes all
    const w1Jobs = await claimSyncJobs(supabase, WORKER_1, 10);
    for (const job of w1Jobs) {
      await markSyncJobSuccess(supabase, job.id);
    }

    // Worker 2 claims — pool is empty
    const w2Jobs = await claimSyncJobs(supabase, WORKER_2, 10);
    expect(w2Jobs).toHaveLength(0);
  });

  it("Worker 1 completes half, Worker 2 claims remaining half", async () => {
    seedSyncJobs(10);

    const w1Jobs = await claimSyncJobs(supabase, WORKER_1, 5);
    expect(w1Jobs).toHaveLength(5);

    for (const job of w1Jobs) {
      await markSyncJobSuccess(supabase, job.id);
    }

    // New jobs don't appear from nowhere
    const w2Jobs = await claimSyncJobs(supabase, WORKER_2, 10);
    expect(w2Jobs).toHaveLength(5); // only the remaining 5

    const w2Ids = new Set(w2Jobs.map((j) => j.id));
    const w1Ids = new Set(w1Jobs.map((j) => j.id));
    for (const id of Array.from(w2Ids)) {
      expect(w1Ids.has(id)).toBe(false); // no overlap
    }
  });

  it("failed jobs re-enter the pool after backoff, claimable by next worker", async () => {
    const row = q.insertSync(queuedJob({ max_attempts: 5 }));

    const [job] = await claimSyncJobs(supabase, WORKER_1, 1);
    await markSyncJobFailed(supabase, job.id, "transient", 60);

    // Before backoff expires — no one can claim it
    const w2BeforeBackoff = await claimSyncJobs(supabase, WORKER_2, 10);
    expect(w2BeforeBackoff.map((j) => j.id)).not.toContain(row.id);

    // After backoff
    q.advanceSecs(61);
    const w2AfterBackoff = await claimSyncJobs(supabase, WORKER_2, 10);
    expect(w2AfterBackoff.map((j) => j.id)).toContain(row.id);
  });
});

// =============================================================================
// Invariant: total claimed never exceeds total available
// =============================================================================

describe("total claimed never exceeds total available", () => {
  it("no over-claim across 10 workers racing for 5 jobs", async () => {
    seedSyncJobs(5);
    const workers = Array.from({ length: 10 }, (_, i) => `worker-race-${i}`);

    const allClaims = await Promise.all(
      workers.map((wid) => claimSyncJobs(supabase, wid, 2)),
    );

    const allIds = allClaims.flatMap((jobs) => jobs.map((j) => j.id));
    // Total must not exceed 5
    expect(allIds.length).toBeLessThanOrEqual(5);
    // No duplicates
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("total claimed across N rounds never exceeds N × capacity", async () => {
    seedSyncJobs(20);
    const workers = [WORKER_1, WORKER_2, WORKER_3];

    // Round 1
    const round1 = await Promise.all(workers.map((w) => claimSyncJobs(supabase, w, 3)));
    const round1Ids = round1.flatMap((j) => j.map((x) => x.id));
    expect(round1Ids.length).toBeLessThanOrEqual(9);
    expect(new Set(round1Ids).size).toBe(round1Ids.length);

    // Complete round 1 jobs
    for (const id of round1Ids) {
      await markSyncJobSuccess(supabase, id);
    }

    // Round 2: remaining jobs
    const round2 = await Promise.all(workers.map((w) => claimSyncJobs(supabase, w, 3)));
    const round2Ids = round2.flatMap((j) => j.map((x) => x.id));
    expect(round2Ids.length).toBeLessThanOrEqual(9);

    // No overlap between rounds
    const round1Set = new Set(round1Ids);
    for (const id of round2Ids) {
      expect(round1Set.has(id)).toBe(false);
    }
  });
});
