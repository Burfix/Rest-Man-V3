/**
 * lib/sync/errors.ts
 *
 * Structured error recording for sync runs.
 * Persists detailed error context to sync_errors table for observability.
 */

import { createServerClient } from "@/lib/supabase/server";
import type { SyncError, SyncPhase } from "./types";

/**
 * Record one or more sync errors to the database.
 */
export async function recordSyncErrors(
  runId: string,
  siteId: string,
  syncType: string,
  errors: SyncError[],
): Promise<void> {
  if (errors.length === 0) return;

  const supabase = createServerClient();

  const rows = errors.map((e) => ({
    run_id: runId,
    site_id: siteId,
    sync_type: syncType,
    phase: e.phase,
    error_code: e.errorCode ?? null,
    message: e.message.slice(0, 2000),
    record_key: e.recordKey ?? null,
    context: e.context ?? {},
    retryable: e.retryable,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("sync_errors") as any).insert(rows);

  if (error) {
    console.warn("[sync:errors] Failed to persist sync errors:", error.message);
  }
}

/**
 * Create a SyncError object for use in the result pipeline.
 */
export function makeSyncError(
  phase: SyncPhase,
  message: string,
  opts?: {
    errorCode?: string;
    recordKey?: string;
    context?: Record<string, unknown>;
    retryable?: boolean;
  },
): SyncError {
  return {
    phase,
    message,
    errorCode: opts?.errorCode,
    recordKey: opts?.recordKey,
    context: opts?.context,
    retryable: opts?.retryable ?? true,
  };
}
