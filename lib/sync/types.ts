/**
 * lib/sync/types.ts
 *
 * Core type definitions for the Sync Engine V2.
 * All sync runs, adapters, and orchestration use these types.
 */

// ── Sync Types ──────────────────────────────────────────────────────────

export type SyncType = "sales" | "labour" | "inventory";
export type SyncSource = "micros";
export type SyncTrigger = "manual" | "cron" | "retry" | "webhook";
export type SyncCursorType = "date" | "timestamp" | "offset" | "token";

export type SyncStatus =
  | "pending"
  | "running"
  | "success"
  | "partial"
  | "error"
  | "cancelled";

export type SyncPhase =
  | "validate"
  | "lock"
  | "create_run"
  | "checkpoint"
  | "fetch"
  | "normalize"
  | "dedup"
  | "write"
  | "update_checkpoint"
  | "complete"
  | "release_lock";

// ── Config ──────────────────────────────────────────────────────────────

export interface SyncConfig {
  siteId: string;
  syncType: SyncType;
  source: SyncSource;
  trigger: SyncTrigger;
  /** Override business date (default: today) */
  businessDate?: string;
  /** Idempotency key to prevent duplicate runs */
  idempotencyKey?: string;
  /** Lock TTL in seconds (default: 300 = 5 min) */
  lockTtlSeconds?: number;
  /** Max retry attempts for transient failures */
  maxRetries?: number;
  /** Extra metadata attached to the sync run */
  metadata?: Record<string, unknown>;
}

// ── Result ──────────────────────────────────────────────────────────────

export interface SyncRunResult {
  runId: string;
  siteId: string;
  syncType: SyncType;
  source: SyncSource;
  status: SyncStatus;
  trigger: SyncTrigger;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  recordsFetched: number;
  recordsWritten: number;
  recordsSkipped: number;
  recordsErrored: number;
  errors: SyncError[];
  checkpointValue?: string;
  metadata?: Record<string, unknown>;
}

export interface SyncError {
  phase: SyncPhase;
  errorCode?: string;
  message: string;
  recordKey?: string;
  context?: Record<string, unknown>;
  retryable: boolean;
}

// ── Checkpoint ──────────────────────────────────────────────────────────

export interface SyncCheckpoint {
  id: string;
  siteId: string;
  syncType: SyncType;
  source: SyncSource;
  cursorValue: string;
  cursorType: SyncCursorType;
  runId?: string;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

// ── Lock ────────────────────────────────────────────────────────────────

export interface SyncLock {
  id: string;
  lockKey: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

// ── Source Adapter Contract ──────────────────────────────────────────────

/** Raw record from the source system before normalization */
export interface RawRecord {
  key: string;                   // unique ID within the source (e.g. check ID, date)
  data: Record<string, unknown>; // raw payload
}

/** Normalized record ready for writing */
export interface NormalizedRecord {
  key: string;
  contentHash: string;
  data: Record<string, unknown>;
}

/** Write result for a single record */
export interface WriteResult {
  key: string;
  written: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Source adapter interface — every data source implements this.
 * The orchestrator calls these methods in sequence.
 */
export interface SourceAdapter<TRaw extends RawRecord = RawRecord> {
  /** Validate that the source is reachable and configured */
  validate(config: SyncConfig): Promise<void>;

  /** Fetch raw records from the source */
  fetch(config: SyncConfig, checkpoint?: SyncCheckpoint): Promise<TRaw[]>;

  /** Normalize raw records into writable form */
  normalize(raw: TRaw[]): NormalizedRecord[];

  /** Write normalized records to the database (with dedup) */
  write(
    records: NormalizedRecord[],
    config: SyncConfig,
    runId: string,
  ): Promise<WriteResult[]>;

  /** Return the new checkpoint cursor value after a successful sync */
  getCheckpointValue(config: SyncConfig, records: NormalizedRecord[]): string;
}

// ── DB row shapes (for Supabase queries) ────────────────────────────────

export interface SyncRunRow {
  id: string;
  site_id: string;
  sync_type: string;
  source: string;
  status: string;
  trigger: string;
  idempotency_key: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  records_fetched: number;
  records_written: number;
  records_skipped: number;
  records_errored: number;
  error_message: string | null;
  error_code: string | null;
  checkpoint_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SyncCheckpointRow {
  id: string;
  site_id: string;
  sync_type: string;
  source: string;
  cursor_value: string;
  cursor_type: string;
  run_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
