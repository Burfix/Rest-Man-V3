/**
 * lib/sync/hash.ts
 *
 * Content fingerprinting for deduplication.
 * Computes a stable SHA-256 hash of a normalized record payload
 * and checks against stored fingerprints to skip unchanged data.
 */

import { createServerClient } from "@/lib/supabase/server";
import type { NormalizedRecord } from "./types";

/**
 * Compute SHA-256 hash of a record's data payload.
 * Keys are sorted for deterministic output.
 */
export async function computeHash(data: Record<string, unknown>): Promise<string> {
  const sorted = JSON.stringify(data, Object.keys(data).sort());
  const buffer = new TextEncoder().encode(sorted);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check which records have changed since last sync (by content hash).
 * Returns only records whose hashes differ from stored fingerprints.
 */
export async function filterChanged(
  records: NormalizedRecord[],
  siteId: string,
  syncType: string,
): Promise<{ changed: NormalizedRecord[]; skipped: NormalizedRecord[] }> {
  if (records.length === 0) return { changed: [], skipped: [] };

  const supabase = createServerClient();
  const keys = records.map((r) => r.key);

  // Fetch existing fingerprints for these keys
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase
    .from("source_ingestion_fingerprints") as any)
    .select("record_key, content_hash")
    .eq("site_id", siteId)
    .eq("sync_type", syncType)
    .in("record_key", keys) as { data: Array<{ record_key: string; content_hash: string }> | null };

  const hashMap = new Map((existing ?? []).map((r) => [r.record_key, r.content_hash]));

  const changed: NormalizedRecord[] = [];
  const skipped: NormalizedRecord[] = [];

  for (const record of records) {
    const storedHash = hashMap.get(record.key);
    if (storedHash === record.contentHash) {
      skipped.push(record);
    } else {
      changed.push(record);
    }
  }

  return { changed, skipped };
}

/**
 * Update fingerprints after successful write.
 */
export async function updateFingerprints(
  records: NormalizedRecord[],
  siteId: string,
  syncType: string,
  runId: string,
): Promise<void> {
  if (records.length === 0) return;

  const supabase = createServerClient();
  const now = new Date().toISOString();

  // Batch upsert fingerprints
  const rows = records.map((r) => ({
    site_id: siteId,
    sync_type: syncType,
    record_key: r.key,
    content_hash: r.contentHash,
    run_id: runId,
    first_seen_at: now,
    last_seen_at: now,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase
    .from("source_ingestion_fingerprints") as any)
    .upsert(rows, { onConflict: "site_id,sync_type,record_key" });

  if (error) {
    // Non-fatal — data was already written, fingerprint is for optimization only
    console.warn("[sync:hash] Failed to update fingerprints:", error.message);
  }
}
