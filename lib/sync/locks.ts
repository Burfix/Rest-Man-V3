/**
 * lib/sync/locks.ts
 *
 * Distributed lock manager using Supabase (sync_locks table).
 * Prevents concurrent syncs of the same type/site.
 *
 * Locks auto-expire via expires_at for zombie protection.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { SyncLock } from "./types";

const DEFAULT_LOCK_TTL_SECONDS = 300; // 5 minutes

interface SyncLockRow {
  id: string;
  lock_key: string;
  owner_id: string;
  acquired_at: string;
  expires_at: string;
  metadata: Record<string, unknown>;
}

/** Build the lock key for a sync type + site */
export function buildLockKey(syncType: string, siteId: string, source = "micros"): string {
  return `sync:${source}:${syncType}:${siteId}`;
}

/**
 * Attempt to acquire a distributed lock.
 * Returns the lock on success, null if already held by another run.
 */
export async function acquireLock(
  lockKey: string,
  ownerId: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS,
  metadata?: Record<string, unknown>,
): Promise<SyncLock | null> {
  const supabase = createServerClient();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // First, clean up any expired locks for this key
  await supabase
    .from("sync_locks")
    .delete()
    .eq("lock_key", lockKey)
    .lt("expires_at", now.toISOString());

  // Try to insert — unique constraint on lock_key prevents duplicates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("sync_locks") as any)
    .insert({
      lock_key: lockKey,
      owner_id: ownerId,
      acquired_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      metadata: metadata ?? {},
    })
    .select()
    .single() as { data: SyncLockRow | null; error: { code?: string; message: string } | null };

  if (error) {
    // 23505 = unique violation → lock already held
    if (error.code === "23505") {
      logger.warn("Lock already held", { lockKey, ownerId });
      return null;
    }
    logger.error("Failed to acquire lock", { lockKey, ownerId, err: error.message });
    return null;
  }

  if (!data) return null;

  logger.info("Lock acquired", { lockKey, ownerId, expiresAt: expiresAt.toISOString() });

  return {
    id: data.id,
    lockKey: data.lock_key,
    ownerId: data.owner_id,
    acquiredAt: data.acquired_at,
    expiresAt: data.expires_at,
    metadata: data.metadata,
  };
}

/**
 * Release a lock. Only the owner (by ownerId) can release it.
 */
export async function releaseLock(lockKey: string, ownerId: string): Promise<boolean> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("sync_locks")
    .delete()
    .eq("lock_key", lockKey)
    .eq("owner_id", ownerId);

  if (error) {
    logger.error("Failed to release lock", { lockKey, ownerId, err: error.message });
    return false;
  }

  logger.info("Lock released", { lockKey, ownerId });
  return true;
}

/**
 * Check if a lock is currently held (non-expired).
 */
export async function isLocked(lockKey: string): Promise<boolean> {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("sync_locks")
    .select("id")
    .eq("lock_key", lockKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  return !!data;
}

/**
 * Clean up all expired locks. Called at start of each sync cycle.
 */
export async function cleanupExpiredLocks(): Promise<number> {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("sync_locks")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  const cleaned = (data as unknown[] | null)?.length ?? 0;
  if (cleaned > 0) {
    logger.info("Cleaned expired locks", { count: cleaned });
  }
  return cleaned;
}
