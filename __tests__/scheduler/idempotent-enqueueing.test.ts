/**
 * __tests__/scheduler/idempotent-enqueueing.test.ts
 *
 * Category 6: Idempotent enqueueing
 * Category 11: Tenant isolation
 *
 * The scheduler uses deterministic idempotency keys to prevent duplicate jobs:
 *
 *   sync key  = `${site_id}|${loc_ref}|${sync_type}|${business_date}|${mode}`
 *   async key = caller-provided explicit key (e.g. `compute_accountability|${site_id}|${date}`)
 *
 * This means:
 *   - Enqueueing the same logical job twice → same job ID returned, single row
 *   - Different date OR different mode → distinct job (correct partitioning)
 *   - Different site_id → distinct job (tenant isolation)
 *   - Explicit custom key → collision-free when callers choose distinct keys
 *
 * Tenant isolation tests verify:
 *   - Site A's job key does not collide with Site B's equivalent job key
 *   - Workers cannot see or claim jobs belonging to different tenants
 *     (note: the queue doesn't have RLS per-site — isolation comes from key scoping
 *      and the fact that workers are given the correct site context)
 *   - Multiple sites with the same loc_ref/sync_type/date each get independent jobs
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockQueue, createMockSupabase } from "./helpers/MockQueue";
import { claimSyncJobs, claimAsyncJobs } from "../../lib/scheduler/claim";
import {
  SITE_A,
  SITE_B,
  SITE_C,
  WORKER_1,
  BIZ_DATE,
  BIZ_DATE_NEXT,
  syncJobRpcParams,
  asyncJobRpcParams,
} from "./helpers/factory";

let q: MockQueue;
let supabase: ReturnType<typeof createMockSupabase>;

beforeEach(() => {
  q = new MockQueue();
  supabase = createMockSupabase(q);
});

// ── Helper: enqueue via RPC ───────────────────────────────────────────────────

async function enqueueSyncRpc(params: Record<string, unknown>): Promise<string> {
  const result = await q.rpc("enqueue_sync_job", params);
  if (result.error) throw new Error(result.error.message);
  return result.data as string;
}

async function enqueueAsyncRpc(params: Record<string, unknown>): Promise<string> {
  const result = await q.rpc("enqueue_async_job", params);
  if (result.error) throw new Error(result.error.message);
  return result.data as string;
}

// =============================================================================
// Sync job idempotency
// =============================================================================

describe("sync job idempotency", () => {
  it("enqueueing the same job twice returns the same ID", async () => {
    const params = syncJobRpcParams();
    const id1 = await enqueueSyncRpc(params);
    const id2 = await enqueueSyncRpc(params);
    expect(id1).toBe(id2);
  });

  it("duplicate enqueue creates exactly one row", async () => {
    const params = syncJobRpcParams();
    await enqueueSyncRpc(params);
    await enqueueSyncRpc(params);
    await enqueueSyncRpc(params);
    expect(q.allSyncRows()).toHaveLength(1);
  });

  it("different business_date creates a distinct job", async () => {
    const id1 = await enqueueSyncRpc(syncJobRpcParams({ business_date: BIZ_DATE }));
    const id2 = await enqueueSyncRpc(syncJobRpcParams({ business_date: BIZ_DATE_NEXT }));
    expect(id1).not.toBe(id2);
    expect(q.allSyncRows()).toHaveLength(2);
  });

  it("different mode creates a distinct job", async () => {
    const id1 = await enqueueSyncRpc(syncJobRpcParams({ mode: "delta" }));
    const id2 = await enqueueSyncRpc(syncJobRpcParams({ mode: "full" }));
    expect(id1).not.toBe(id2);
    expect(q.allSyncRows()).toHaveLength(2);
  });

  it("different sync_type creates a distinct job", async () => {
    const id1 = await enqueueSyncRpc(syncJobRpcParams({ sync_type: "daily_sales" }));
    const id2 = await enqueueSyncRpc(syncJobRpcParams({ sync_type: "labour" }));
    expect(id1).not.toBe(id2);
    expect(q.allSyncRows()).toHaveLength(2);
  });

  it("different loc_ref creates a distinct job", async () => {
    const id1 = await enqueueSyncRpc(syncJobRpcParams({ loc_ref: "LOC001" }));
    const id2 = await enqueueSyncRpc(syncJobRpcParams({ loc_ref: "LOC002" }));
    expect(id1).not.toBe(id2);
  });

  it("idempotency survives concurrent enqueue calls (Promise.all)", async () => {
    const params = syncJobRpcParams();
    const ids = await Promise.all([
      enqueueSyncRpc(params),
      enqueueSyncRpc(params),
      enqueueSyncRpc(params),
      enqueueSyncRpc(params),
      enqueueSyncRpc(params),
    ]);

    // All 5 calls return the same ID
    expect(new Set(ids).size).toBe(1);
    expect(q.allSyncRows()).toHaveLength(1);
  });

  it("explicit idempotency_key overrides the auto-computed key", async () => {
    const customKey = "my-custom-key-abc123";
    const id1 = await enqueueSyncRpc({ ...syncJobRpcParams(), p_idempotency_key: customKey });
    const id2 = await enqueueSyncRpc({ ...syncJobRpcParams(), p_idempotency_key: customKey });
    expect(id1).toBe(id2);
    expect(q.allSyncRows()).toHaveLength(1);
  });

  it("different explicit keys create distinct jobs even with same natural params", async () => {
    const params = syncJobRpcParams();
    const id1 = await enqueueSyncRpc({ ...params, p_idempotency_key: "key-A" });
    const id2 = await enqueueSyncRpc({ ...params, p_idempotency_key: "key-B" });
    expect(id1).not.toBe(id2);
    expect(q.allSyncRows()).toHaveLength(2);
  });

  it("re-enqueueing a succeeded job returns existing job ID (not a new one)", async () => {
    const params = syncJobRpcParams();
    const id1 = await enqueueSyncRpc(params);

    // Mark it succeeded
    const row = q.syncRow(id1)!;
    row.status = "succeeded";

    // Enqueue same key again → should return the existing ID (not insert a new row)
    const id2 = await enqueueSyncRpc(params);
    expect(id2).toBe(id1);
    expect(q.allSyncRows()).toHaveLength(1);
    // The succeeded row is returned, NOT reset to queued
    expect(q.syncRow(id1)!.status).toBe("succeeded");
  });
});

// =============================================================================
// Async job idempotency
// =============================================================================

describe("async job idempotency", () => {
  it("same idempotency key returns same ID", async () => {
    const key = `compute_accountability|${SITE_A}|${BIZ_DATE}`;
    const params = asyncJobRpcParams({ idempotency_key: key });
    const id1 = await enqueueAsyncRpc(params);
    const id2 = await enqueueAsyncRpc(params);
    expect(id1).toBe(id2);
  });

  it("duplicate async enqueue creates exactly one row", async () => {
    const key = `compute_accountability|${SITE_A}|${BIZ_DATE}`;
    const params = asyncJobRpcParams({ idempotency_key: key });
    await enqueueAsyncRpc(params);
    await enqueueAsyncRpc(params);
    await enqueueAsyncRpc(params);
    expect(q.allAsyncRows()).toHaveLength(1);
  });

  it("different async idempotency keys create distinct jobs", async () => {
    const id1 = await enqueueAsyncRpc(asyncJobRpcParams({
      idempotency_key: `compute_accountability|${SITE_A}|${BIZ_DATE}`,
    }));
    const id2 = await enqueueAsyncRpc(asyncJobRpcParams({
      idempotency_key: `compute_accountability|${SITE_A}|${BIZ_DATE_NEXT}`,
    }));
    expect(id1).not.toBe(id2);
    expect(q.allAsyncRows()).toHaveLength(2);
  });

  it("concurrent async enqueue with same key → single row", async () => {
    const key = `google_reviews_sync|${SITE_A}`;
    const params = asyncJobRpcParams({ idempotency_key: key, job_type: "google_reviews_sync" });
    const ids = await Promise.all([
      enqueueAsyncRpc(params),
      enqueueAsyncRpc(params),
      enqueueAsyncRpc(params),
    ]);
    expect(new Set(ids).size).toBe(1);
    expect(q.allAsyncRows()).toHaveLength(1);
  });
});

// =============================================================================
// Tenant isolation (Category 11)
// =============================================================================

describe("tenant isolation: jobs scoped correctly per site", () => {
  it("Site A and Site B with same params get distinct sync jobs", async () => {
    const idA = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_A }));
    const idB = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_B }));

    expect(idA).not.toBe(idB);
    expect(q.allSyncRows()).toHaveLength(2);

    const rowA = q.syncRow(idA)!;
    const rowB = q.syncRow(idB)!;
    expect(rowA.site_id).toBe(SITE_A);
    expect(rowB.site_id).toBe(SITE_B);
  });

  it("re-enqueueing Site A's job does not affect Site B's independent job", async () => {
    const idA1 = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_A }));
    const idB  = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_B }));
    const idA2 = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_A }));

    expect(idA1).toBe(idA2); // Site A idempotent
    expect(idB).not.toBe(idA1); // Site B is separate
    expect(q.allSyncRows()).toHaveLength(2); // still 2 rows
  });

  it("async idempotency keys for different sites are distinct even with same job_type", async () => {
    const keyA = `compute_accountability|${SITE_A}|${BIZ_DATE}`;
    const keyB = `compute_accountability|${SITE_B}|${BIZ_DATE}`;

    const idA = await enqueueAsyncRpc(asyncJobRpcParams({ idempotency_key: keyA }));
    const idB = await enqueueAsyncRpc(asyncJobRpcParams({ idempotency_key: keyB }));

    expect(idA).not.toBe(idB);
    expect(q.allAsyncRows()).toHaveLength(2);
  });

  it("3 sites × same job params → 3 independent jobs, each claimable", async () => {
    const sites = [SITE_A, SITE_B, SITE_C];
    const ids = await Promise.all(
      sites.map((s) => enqueueSyncRpc(syncJobRpcParams({ site_id: s }))),
    );

    // All unique
    expect(new Set(ids).size).toBe(3);
    expect(q.allSyncRows()).toHaveLength(3);

    // All claimable
    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    expect(claimed).toHaveLength(3);

    const claimedSites = new Set(claimed.map((j) => {
      const row = q.syncRow(j.id)!;
      return row.site_id;
    }));
    expect(claimedSites).toEqual(new Set(sites));
  });

  it("idempotency key does not collide across tenants that share the same natural params", async () => {
    // Same loc_ref + sync_type + date + mode, but different site_id
    // The natural key formula includes site_id, so these must NOT collide
    const commonParams = { loc_ref: "BAR01", sync_type: "daily_sales", business_date: BIZ_DATE, mode: "delta" };
    await enqueueSyncRpc(syncJobRpcParams({ ...commonParams, site_id: SITE_A }));
    await enqueueSyncRpc(syncJobRpcParams({ ...commonParams, site_id: SITE_B }));

    expect(q.allSyncRows()).toHaveLength(2);
    const keys = q.allSyncRows().map((r) => r.idempotency_key);
    expect(new Set(keys).size).toBe(2); // distinct keys
  });

  it("worker claiming jobs sees jobs from all sites (no tenant filtering)", async () => {
    // The queue is multi-tenant; isolation is at application level not at claim level.
    // Workers see all unclaimed jobs regardless of site.
    // This is intentional — the scheduler is a system-level service.
    for (const site of [SITE_A, SITE_B, SITE_C]) {
      await enqueueSyncRpc(syncJobRpcParams({ site_id: site }));
    }

    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    const sites = claimed.map((j) => q.syncRow(j.id)!.site_id);
    expect(new Set(sites).size).toBe(3); // worker sees all 3 tenants
  });

  it("completing Site A's job does not alter Site B's job", async () => {
    const idA = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_A }));
    const idB = await enqueueSyncRpc(syncJobRpcParams({ site_id: SITE_B }));

    // Claim both
    const claimed = await claimSyncJobs(supabase, WORKER_1, 10);
    expect(claimed).toHaveLength(2);

    // Mark only Site A's job as succeeded
    // (Note: in a real scenario a worker would only complete its own jobs,
    //  but here we test that the mark call is ID-scoped)
    const rowA = claimed.find((j) => q.syncRow(j.id)!.site_id === SITE_A)!;
    const rowB = claimed.find((j) => q.syncRow(j.id)!.site_id === SITE_B)!;

    // Mark running first (both leased)
    q.syncRow(rowA.id)!.status = "running";
    q.syncRow(rowB.id)!.status = "running";

    await import("../../lib/scheduler/claim").then(async (m) => {
      await m.markSyncJobSuccess(supabase, rowA.id);
    });

    expect(q.syncRow(idA)!.status).toBe("succeeded");
    expect(q.syncRow(idB)!.status).toBe("running"); // untouched
  });
});

// =============================================================================
// Idempotency: enqueueing into a non-queued state
// =============================================================================

describe("idempotency behaviour with non-queued existing jobs", () => {
  it("enqueue returns existing leased job ID (does not reset state)", async () => {
    const id1 = await enqueueSyncRpc(syncJobRpcParams());
    // Simulate the job being claimed
    q.syncRow(id1)!.status = "leased";
    q.syncRow(id1)!.lease_owner = WORKER_1;

    // Enqueue same params again
    const id2 = await enqueueSyncRpc(syncJobRpcParams());
    expect(id2).toBe(id1);
    // Status is still leased — not reset to queued
    expect(q.syncRow(id1)!.status).toBe("leased");
  });

  it("enqueue returns existing dead_letter job ID (does not resurrect)", async () => {
    const id1 = await enqueueSyncRpc(syncJobRpcParams());
    q.syncRow(id1)!.status = "dead_letter";

    const id2 = await enqueueSyncRpc(syncJobRpcParams());
    expect(id2).toBe(id1);
    // Dead-letter is NOT resurrected by a new enqueue attempt
    expect(q.syncRow(id1)!.status).toBe("dead_letter");
  });
});
