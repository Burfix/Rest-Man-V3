/**
 * lib/types/sync-event.ts — Operational sync telemetry contract
 *
 * Every integration sync (MICROS, manual upload, scheduled job) emits a
 * SyncEvent. These events form the operational history layer that powers:
 *   - Debugging and support tooling
 *   - SLA reporting and freshness dashboards
 *   - Anomaly detection (repeated failures, drift)
 *   - AI ops recommendations (brain context)
 *
 * Storage: sync_events table (migration 089).
 * logSyncEvent() fails gracefully — telemetry must never block the operational path.
 */

import { createServerClient } from "@/lib/supabase/server";

// ── Core event type ─────────────────────────────────────────────────────────

export type SyncIntegration = "micros" | "manual" | "forecast";

export type SyncJobType =
  | "sales"
  | "labour"
  | "inventory"
  | "compliance"
  | "maintenance";

export type SyncStatus = "success" | "failed" | "stale";

export interface SyncEvent {
  /** Which integration produced this event */
  integration: SyncIntegration;
  /** Site this event belongs to — required for tenant isolation */
  siteId: string;
  /** What kind of data was being synced */
  jobType: SyncJobType;
  /** Outcome of the sync attempt */
  status: SyncStatus;
  /** ISO-8601 timestamp when the sync job started */
  startedAt: string;
  /** ISO-8601 timestamp when the sync job finished (omit if still running) */
  completedAt?: string;
  /** Wall-clock duration in milliseconds */
  durationMs?: number;
  /** Machine-readable error code for alerting rules, e.g. "AUTH_FAILED", "TIMEOUT" */
  errorCode?: string;
  /** Human-readable detail for support tooling */
  message?: string;
}

// ── Logger ──────────────────────────────────────────────────────────────────

/**
 * Persist a sync event to the sync_events table.
 *
 * Fails silently — calling code must never await this on the critical path.
 * Pattern: `logSyncEvent(event).catch(() => {})` or fire-and-forget.
 */
export async function logSyncEvent(event: SyncEvent): Promise<void> {
  try {
    const supabase = createServerClient();
    await (supabase as any).from("sync_events").insert({
      site_id:      event.siteId,
      integration:  event.integration,
      job_type:     event.jobType,
      status:       event.status,
      started_at:   event.startedAt,
      completed_at: event.completedAt ?? null,
      duration_ms:  event.durationMs  ?? null,
      error_code:   event.errorCode   ?? null,
      message:      event.message     ?? null,
    });
  } catch {
    // Non-fatal — telemetry must never block the operational path.
  }
}

// ── Helper — build a completed event from a start timestamp ─────────────────

/**
 * Call at the start of a sync job, get a "finish" callback.
 *
 * Usage:
 *   const finish = startSyncEvent({ integration: "micros", siteId, jobType: "sales" });
 *   try { ...sync logic...; finish("success"); }
 *   catch (err) { finish("failed", { errorCode: "TIMEOUT", message: err.message }); }
 */
export function startSyncEvent(base: Omit<SyncEvent, "startedAt" | "status" | "completedAt" | "durationMs">): (
  status: SyncStatus,
  extra?: Pick<SyncEvent, "errorCode" | "message">,
) => void {
  const startedAt = new Date().toISOString();
  const startMs   = Date.now();

  return (status, extra) => {
    const completedAt = new Date().toISOString();
    logSyncEvent({
      ...base,
      startedAt,
      completedAt,
      durationMs: Date.now() - startMs,
      status,
      ...extra,
    }).catch(() => {});
  };
}
