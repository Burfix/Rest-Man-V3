/**
 * lib/sync/engine.ts
 *
 * Sync Engine V2 — 11-phase orchestrator.
 *
 * Pipeline:
 *   1. validate    → adapter.validate()
 *   2. lock        → acquire distributed lock
 *   3. create_run  → insert sync_runs row
 *   4. checkpoint  → load last checkpoint
 *   5. fetch       → adapter.fetch()
 *   6. normalize   → adapter.normalize()
 *   7. dedup       → filter unchanged records via content hash
 *   8. write       → adapter.write() with batch upserts
 *   9. update_checkpoint → save new cursor position
 *  10. complete    → mark run success/partial, record metrics
 *  11. release_lock → always runs (even on error)
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { todayISO } from "@/lib/utils";
import { acquireLock, releaseLock, buildLockKey } from "./locks";
import { loadCheckpoint, saveCheckpoint } from "./checkpoints";
import { filterChanged, updateFingerprints } from "./hash";
import { recordSyncErrors, makeSyncError } from "./errors";
import type {
  SyncConfig,
  SyncRunResult,
  SyncError,
  SourceAdapter,
  RawRecord,
  NormalizedRecord,
  WriteResult,
} from "./types";

const DEFAULT_LOCK_TTL = 300; // 5 min

/**
 * Execute a full sync pipeline for the given adapter + config.
 * This is the single entry point that orchestrates all 11 phases.
 */
export async function runSync<T extends RawRecord>(
  adapter: SourceAdapter<T>,
  config: SyncConfig,
): Promise<SyncRunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runId = crypto.randomUUID();
  const lockKey = buildLockKey(config.syncType, config.siteId, config.source);
  const lockTtl = config.lockTtlSeconds ?? DEFAULT_LOCK_TTL;
  const businessDate = config.businessDate ?? todayISO();

  const errors: SyncError[] = [];
  let recordsFetched = 0;
  let recordsWritten = 0;
  let recordsSkipped = 0;
  let recordsErrored = 0;
  let checkpointValue: string | undefined;
  let lockAcquired = false;

  const makeResult = (status: "success" | "partial" | "error" | "cancelled"): SyncRunResult => ({
    runId,
    siteId: config.siteId,
    syncType: config.syncType,
    source: config.source,
    status,
    trigger: config.trigger,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    recordsFetched,
    recordsWritten,
    recordsSkipped,
    recordsErrored,
    errors,
    checkpointValue,
    metadata: config.metadata,
  });

  try {
    // ── Phase 1: Validate ─────────────────────────────────────────────
    logger.info("[sync:engine] Phase 1: validate", {
      runId,
      syncType: config.syncType,
      siteId: config.siteId,
      businessDate,
    });

    try {
      await adapter.validate({ ...config, businessDate });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(makeSyncError("validate", msg, { retryable: false }));
      const result = makeResult("error");
      await persistRun(runId, config, result, errors);
      return result;
    }

    // ── Phase 2: Lock ─────────────────────────────────────────────────
    logger.info("[sync:engine] Phase 2: lock", { runId, lockKey });

    // Check idempotency key first
    if (config.idempotencyKey) {
      const existing = await checkIdempotency(config.idempotencyKey);
      if (existing) {
        logger.info("[sync:engine] Idempotency hit — returning cached result", {
          runId,
          existingRunId: existing,
        });
        const result = makeResult("cancelled");
        result.metadata = { ...result.metadata, duplicateOf: existing };
        return result;
      }
    }

    const lock = await acquireLock(lockKey, runId, lockTtl, {
      trigger: config.trigger,
      businessDate,
    });

    if (!lock) {
      errors.push(
        makeSyncError("lock", "Lock already held — concurrent sync in progress", {
          retryable: true,
        }),
      );
      const result = makeResult("cancelled");
      await persistRun(runId, config, result, errors);
      return result;
    }
    lockAcquired = true;

    // ── Phase 3: Create run ───────────────────────────────────────────
    logger.info("[sync:engine] Phase 3: create_run", { runId });
    await createRunRecord(runId, config, businessDate);

    // ── Phase 4: Load checkpoint ──────────────────────────────────────
    logger.info("[sync:engine] Phase 4: checkpoint", { runId });
    const checkpoint = await loadCheckpoint(config.siteId, config.syncType, config.source);

    if (checkpoint) {
      logger.info("[sync:engine] Resuming from checkpoint", {
        runId,
        cursor: checkpoint.cursorValue,
        cursorType: checkpoint.cursorType,
      });
    }

    // ── Phase 5: Fetch ────────────────────────────────────────────────
    logger.info("[sync:engine] Phase 5: fetch", { runId, businessDate });

    let rawRecords: T[];
    try {
      rawRecords = await adapter.fetch({ ...config, businessDate }, checkpoint ?? undefined);
      recordsFetched = rawRecords.length;
      logger.info("[sync:engine] Fetched records", { runId, count: recordsFetched });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(makeSyncError("fetch", msg, { retryable: true }));
      const result = makeResult("error");
      await finalizeRun(runId, result, errors, config);
      return result;
    }

    if (rawRecords.length === 0) {
      logger.info("[sync:engine] No records to sync", { runId, businessDate });
      const result = makeResult("success");
      await finalizeRun(runId, result, errors, config);
      return result;
    }

    // ── Phase 6: Normalize ────────────────────────────────────────────
    logger.info("[sync:engine] Phase 6: normalize", { runId, count: rawRecords.length });

    let normalized: NormalizedRecord[];
    try {
      normalized = adapter.normalize(rawRecords);
      logger.info("[sync:engine] Normalized records", { runId, count: normalized.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(makeSyncError("normalize", msg, { retryable: false }));
      const result = makeResult("error");
      await finalizeRun(runId, result, errors, config);
      return result;
    }

    // ── Phase 7: Dedup ────────────────────────────────────────────────
    logger.info("[sync:engine] Phase 7: dedup", { runId, count: normalized.length });

    const { changed, skipped } = await filterChanged(
      normalized,
      config.siteId,
      config.syncType,
    );
    recordsSkipped = skipped.length;

    logger.info("[sync:engine] Dedup result", {
      runId,
      changed: changed.length,
      skipped: skipped.length,
    });

    if (changed.length === 0) {
      logger.info("[sync:engine] All records unchanged — skip write", { runId });
      checkpointValue = adapter.getCheckpointValue({ ...config, businessDate }, normalized);
      if (checkpointValue) {
        await saveCheckpoint(config.siteId, config.syncType, checkpointValue, runId);
      }
      const result = makeResult("success");
      await finalizeRun(runId, result, errors, config);
      return result;
    }

    // ── Phase 8: Write ────────────────────────────────────────────────
    logger.info("[sync:engine] Phase 8: write", { runId, count: changed.length });

    let writeResults: WriteResult[];
    try {
      writeResults = await adapter.write(changed, { ...config, businessDate }, runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(makeSyncError("write", msg, { retryable: true }));
      const result = makeResult("error");
      await finalizeRun(runId, result, errors, config);
      return result;
    }

    // Tally write results
    for (const wr of writeResults) {
      if (wr.error) {
        recordsErrored++;
        errors.push(
          makeSyncError("write", wr.error, { recordKey: wr.key, retryable: true }),
        );
      } else if (wr.written) {
        recordsWritten++;
      } else if (wr.skipped) {
        recordsSkipped++;
      }
    }

    // Update fingerprints for successfully written records
    const writtenRecords = changed.filter((r) =>
      writeResults.some((wr) => wr.key === r.key && wr.written),
    );
    await updateFingerprints(writtenRecords, config.siteId, config.syncType, runId);

    // ── Phase 9: Update checkpoint ────────────────────────────────────
    logger.info("[sync:engine] Phase 9: update_checkpoint", { runId });

    checkpointValue = adapter.getCheckpointValue({ ...config, businessDate }, normalized);
    if (checkpointValue) {
      await saveCheckpoint(config.siteId, config.syncType, checkpointValue, runId);
    }

    // ── Phase 10: Complete ────────────────────────────────────────────
    const status = recordsErrored > 0 ? "partial" : "success";
    logger.info("[sync:engine] Phase 10: complete", {
      runId,
      status,
      fetched: recordsFetched,
      written: recordsWritten,
      skipped: recordsSkipped,
      errored: recordsErrored,
      durationMs: Date.now() - t0,
    });

    const result = makeResult(status);
    await finalizeRun(runId, result, errors, config);
    return result;
  } catch (err) {
    // Catch-all for unexpected errors
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[sync:engine] Unexpected pipeline error", {
      runId,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
    });
    errors.push(makeSyncError("validate", `Unexpected: ${msg}`, { retryable: true }));
    const result = makeResult("error");
    try {
      await finalizeRun(runId, result, errors, config);
    } catch {
      // Swallow — we're already in error path
    }
    return result;
  } finally {
    // ── Phase 11: Release lock (always) ─────────────────────────────
    if (lockAcquired) {
      logger.info("[sync:engine] Phase 11: release_lock", { runId, lockKey });
      await releaseLock(lockKey, runId).catch(() => {});
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function checkIdempotency(key: string): Promise<string | null> {
  const supabase = createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from("sync_runs") as any)
    .select("id")
    .eq("idempotency_key", key)
    .in("status", ["running", "success", "partial"])
    .maybeSingle() as { data: { id: string } | null };
  return data?.id ?? null;
}

async function createRunRecord(
  runId: string,
  config: SyncConfig,
  businessDate: string,
): Promise<void> {
  const supabase = createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("sync_runs") as any).insert({
    id: runId,
    site_id: config.siteId,
    sync_type: config.syncType,
    source: config.source,
    status: "running",
    trigger: config.trigger,
    idempotency_key: config.idempotencyKey ?? null,
    started_at: new Date().toISOString(),
    metadata: { businessDate, ...config.metadata },
  });
}

async function finalizeRun(
  runId: string,
  result: SyncRunResult,
  errors: SyncError[],
  config: SyncConfig,
): Promise<void> {
  const supabase = createServerClient();

  // Update sync_runs record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("sync_runs") as any)
    .update({
      status: result.status,
      completed_at: result.completedAt,
      duration_ms: result.durationMs,
      records_fetched: result.recordsFetched,
      records_written: result.recordsWritten,
      records_skipped: result.recordsSkipped,
      records_errored: result.recordsErrored,
      error_message: errors.length > 0 ? errors[0].message.slice(0, 500) : null,
      error_code: errors.length > 0 ? errors[0].errorCode ?? null : null,
    })
    .eq("id", runId);

  // Persist structured errors
  if (errors.length > 0) {
    await recordSyncErrors(runId, config.siteId, config.syncType, errors);
  }
}

async function persistRun(
  runId: string,
  config: SyncConfig,
  result: SyncRunResult,
  errors: SyncError[],
): Promise<void> {
  await createRunRecord(runId, config, config.businessDate ?? todayISO());
  await finalizeRun(runId, result, errors, config);
}
