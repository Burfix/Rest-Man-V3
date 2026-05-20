/**
 * lib/sync/observability.ts
 *
 * Structured logging for sync operations.
 * Wraps the project's pino-based logger with a fixed schema so every
 * sync call emits consistent, searchable log lines.
 *
 * Every line includes: trace_id, connection_id, sync_type, business_date,
 * outcome, duration_ms — the five fields an SRE needs at 2am.
 */

import { logger } from "@/lib/logger";
import type { SyncOutcome, SyncType, SyncMode } from "./contract";

export interface SyncLogLine {
  trace_id: string;
  connection_id: string;
  sync_type: SyncType;
  mode: SyncMode;
  business_date: string;
  outcome?: SyncOutcome;
  duration_ms?: number;
  records_fetched?: number;
  records_written?: number;
  records_skipped?: number;
  error_code?: string;
  error_message?: string;
}

/** Emitted when a sync is dispatched to a handler */
export function logSyncStart(line: Omit<SyncLogLine, "outcome" | "duration_ms">): void {
  logger.info("sync.start", { ...line });
}

/** Emitted when a sync completes (success, empty, partial, or failed) */
export function logSyncComplete(line: SyncLogLine & Required<Pick<SyncLogLine, "outcome" | "duration_ms">>): void {
  const level =
    line.outcome === "failed"
      ? "error"
      : line.outcome === "empty" || line.outcome === "partial"
        ? "warn"
        : "info";

  logger[level]("sync.complete", { ...line });
}

/** Emitted on an unexpected/fatal error before a SyncResult can be formed */
export function logSyncFatal(
  trace_id: string,
  connection_id: string,
  sync_type: string,
  business_date: string,
  err: unknown,
): void {
  logger.error("sync.fatal", {
    trace_id,
    connection_id,
    sync_type,
    business_date,
    error: err instanceof Error ? err.message : String(err),
  });
}

/** Emitted by the scheduler on each tick */
export function logSchedulerTick(fields: {
  tick_id: string;
  trace_id: string;
  invocation_source: string;
  intraday_count: number;
  backfill_count: number;
  duration_ms: number;
  dry_run: boolean;
}): void {
  logger.info("scheduler.tick", { ...fields });
}

/** Emitted when a suspicious empty run is detected */
export function logSuspiciousEmpty(fields: {
  trace_id: string;
  connection_id: string;
  sync_type: SyncType;
  business_date: string;
  note: string;
}): void {
  logger.warn("sync.suspicious_empty", { ...fields });
}

/**
 * Scrub Oracle tokens from any log payload.
 * Call before passing external API responses to logger.
 */
export function scrubTokens(obj: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (
      key.includes("token") ||
      key.includes("password") ||
      key.includes("secret") ||
      key.includes("access_token") ||
      key.includes("refresh_token") ||
      key.includes("id_token") ||
      key.includes("authorization")
    ) {
      scrubbed[k] = "[REDACTED]";
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      scrubbed[k] = scrubTokens(v as Record<string, unknown>);
    } else {
      scrubbed[k] = v;
    }
  }
  return scrubbed;
}
