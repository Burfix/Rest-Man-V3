/**
 * lib/system-health/micros-sync-log.ts
 *
 * Thin write-side helper that inserts a row into micros_sync_logs after
 * every sync attempt. Called by runLocationSync() — must never throw.
 */

import { createServerClient } from "@/lib/supabase/server";

export interface SyncLogEntry {
  siteId?:       string;
  connectionId?: string;
  locationKey?:  string;
  locationRef?:  string;
  syncType?:     "full" | "sales_only" | "labour_only" | "backfill";
  businessDate?: string;
  status:        "success" | "partial" | "error";
  durationMs?:   number;
  salesRecords?: number;
  labourRecords?: number;
  errorMessage?: string;
}

export async function writeSyncLog(entry: SyncLogEntry): Promise<void> {
  const supabase = createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("micros_sync_logs").insert({
    site_id:        entry.siteId        ?? null,
    connection_id:  entry.connectionId  ?? null,
    location_key:   entry.locationKey   ?? null,
    location_ref:   entry.locationRef   ?? null,
    sync_type:      entry.syncType      ?? "full",
    business_date:  entry.businessDate  ?? null,
    status:         entry.status,
    duration_ms:    entry.durationMs    ?? null,
    sales_records:  entry.salesRecords  ?? 0,
    labour_records: entry.labourRecords ?? 0,
    error_message:  entry.errorMessage  ?? null,
  });
}
