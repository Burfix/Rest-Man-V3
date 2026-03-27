/**
 * lib/sync/index.ts
 *
 * Public API for the Sync Engine V2.
 */

export { runSync } from "./engine";
export { microsSalesAdapter } from "./adapters/micros-sales.adapter";
export { acquireLock, releaseLock, isLocked, cleanupExpiredLocks, buildLockKey } from "./locks";
export { loadCheckpoint, saveCheckpoint, clearCheckpoint } from "./checkpoints";
export { filterChanged, updateFingerprints, computeHash } from "./hash";
export { recordSyncErrors, makeSyncError } from "./errors";
export type {
  SyncConfig,
  SyncRunResult,
  SyncError,
  SyncType,
  SyncSource,
  SyncTrigger,
  SyncStatus,
  SyncPhase,
  SyncCheckpoint,
  SyncLock,
  SourceAdapter,
  RawRecord,
  NormalizedRecord,
  WriteResult,
} from "./types";
