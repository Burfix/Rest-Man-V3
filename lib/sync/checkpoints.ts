/**
 * lib/sync/checkpoints.ts
 *
 * Checkpoint manager — cursor-based sync resume.
 * Stores/loads the last successfully synced position so delta syncs
 * can resume from where they left off.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { SyncCheckpoint, SyncCursorType, SyncCheckpointRow } from "./types";

/**
 * Load the latest checkpoint for a sync type + site.
 * Returns null if no checkpoint exists (first sync).
 */
export async function loadCheckpoint(
  siteId: string,
  syncType: string,
  source = "micros",
): Promise<SyncCheckpoint | null> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("sync_checkpoints") as any)
    .select("*")
    .eq("site_id", siteId)
    .eq("sync_type", syncType)
    .eq("source", source)
    .maybeSingle() as { data: SyncCheckpointRow | null; error: { message: string } | null };

  if (error) {
    logger.error("Failed to load checkpoint", { siteId, syncType, source, err: error.message });
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    siteId: data.site_id,
    syncType: data.sync_type as SyncCheckpoint["syncType"],
    source: data.source as SyncCheckpoint["source"],
    cursorValue: data.cursor_value,
    cursorType: data.cursor_type as SyncCursorType,
    runId: data.run_id ?? undefined,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    updatedAt: data.updated_at,
  };
}

/**
 * Save or update a checkpoint after a successful sync.
 * Uses UPSERT on (site_id, sync_type, source) unique constraint.
 */
export async function saveCheckpoint(
  siteId: string,
  syncType: string,
  cursorValue: string,
  runId: string,
  cursorType: SyncCursorType = "date",
  source = "micros",
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  const supabase = createServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("sync_checkpoints") as any)
    .upsert(
      {
        site_id: siteId,
        sync_type: syncType,
        source,
        cursor_value: cursorValue,
        cursor_type: cursorType,
        run_id: runId,
        metadata: metadata ?? {},
      },
      { onConflict: "site_id,sync_type,source" },
    )
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string } | null };

  if (error) {
    logger.error("Failed to save checkpoint", {
      siteId,
      syncType,
      cursorValue,
      err: error.message,
    });
    return null;
  }

  logger.info("Checkpoint saved", { siteId, syncType, cursorValue, runId });
  return data?.id ?? null;
}

/**
 * Clear a checkpoint (force full re-sync on next run).
 */
export async function clearCheckpoint(
  siteId: string,
  syncType: string,
  source = "micros",
): Promise<boolean> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from("sync_checkpoints")
    .delete()
    .eq("site_id", siteId)
    .eq("sync_type", syncType)
    .eq("source", source);

  if (error) {
    logger.error("Failed to clear checkpoint", { siteId, syncType, err: error.message });
    return false;
  }

  logger.info("Checkpoint cleared", { siteId, syncType, source });
  return true;
}
