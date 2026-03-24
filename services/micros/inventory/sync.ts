/**
 * services/micros/inventory/sync.ts
 *
 * Orchestrates inventory sync from Oracle MICROS → Supabase inventory_items.
 *
 * Flow:
 *  1. Call getMenuItemInventoryCount from the BIAPI
 *  2. Normalize Oracle items to our InventoryItem schema
 *  3. Upsert into inventory_items (match on micros_item_id + store_id)
 *  4. Log sync run in micros_sync_runs
 *
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 */

import { createServerClient } from "@/lib/supabase/server";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getMicrosConnection } from "@/services/micros/status";
import { getMenuItemInventoryCount } from "./client";
import { todayISO } from "@/lib/utils";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import type {
  OracleMenuItemInventoryCount,
  InventorySyncResult,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Normalise Oracle item → Supabase row ────────────────────────────────────

/**
 * Maps an Oracle menu item inventory count to our inventory_items schema.
 * Uses miNum as the stable Oracle identifier for upsert matching.
 */
function normalizeInventoryItem(
  oracleItem: OracleMenuItemInventoryCount,
  storeId: string,
) {
  const currentStock = oracleItem.currentCount ?? 0;
  const minThreshold = oracleItem.minimumCount ?? 0;
  const parLevel     = oracleItem.parCount ?? minThreshold * 2;

  return {
    store_id:            storeId,
    micros_item_id:      String(oracleItem.miNum),
    name:                oracleItem.miName,
    category:            oracleItem.menuItemClassName ?? oracleItem.majorGroupName ?? "Uncategorised",
    unit:                oracleItem.unitOfMeasure ?? "ea",
    current_stock:       currentStock,
    minimum_threshold:   minThreshold,
    par_level:           parLevel,
    updated_at:          oracleItem.lastCountDtUTC ?? new Date().toISOString(),
  };
}

// ── Public sync function ────────────────────────────────────────────────────

export async function syncInventoryFromMicros(
  date?: string,
): Promise<InventorySyncResult> {
  const businessDate = date ?? todayISO();
  const cfg = getMicrosEnvConfig();
  const connection = await getMicrosConnection();

  if (!connection) {
    return { success: false, message: "No MICROS connection configured." };
  }

  const supabase = createServerClient();
  const syncRunId = crypto.randomUUID();

  // Log sync start
  await supabase.from("micros_sync_runs").insert({
    id: syncRunId,
    connection_id: connection.id,
    sync_type: "inventory",
    started_at: new Date().toISOString(),
    status: "running",
    records_fetched: 0,
    records_inserted: 0,
  });

  try {
    // Fetch inventory counts from Oracle MICROS
    const raw = await getMenuItemInventoryCount({
      busDt: businessDate,
      locRef: cfg.locRef,
    });

    const oracleItems = raw.menuItemInventoryCounts ?? [];
    const itemCount = oracleItems.length;

    if (itemCount === 0) {
      await supabase
        .from("micros_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "success",
          records_fetched: 0,
          records_inserted: 0,
        })
        .eq("id", syncRunId);

      return {
        success: true,
        message: "No inventory items returned from MICROS.",
        businessDate,
        itemsSynced: 0,
      };
    }

    // Normalise all items
    const storeId = DEFAULT_ORG_ID;
    const rows = oracleItems.map((oi) => normalizeInventoryItem(oi, storeId));

    // Upsert in batches of 100
    let created = 0;
    let updated = 0;
    const batchSize = 100;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      // Check which items already exist (match on micros_item_id + store_id)
      const microsIds = batch.map((r) => r.micros_item_id);
      const { data: existing } = await supabase
        .from("inventory_items" as any)
        .select("id, micros_item_id")
        .eq("store_id", storeId)
        .in("micros_item_id", microsIds);

      const existingMap = new Map(
        ((existing ?? []) as any[]).map((e: any) => [e.micros_item_id, e.id]),
      );

      // Separate into inserts (new items) and updates (existing items)
      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const row of batch) {
        const existingId = existingMap.get(row.micros_item_id);
        if (existingId) {
          // Update only stock-related fields — preserve local overrides
          toUpdate.push({
            id: existingId,
            current_stock: row.current_stock,
            minimum_threshold: row.minimum_threshold,
            par_level: row.par_level,
            updated_at: row.updated_at,
          });
        } else {
          // New item from MICROS — insert with defaults
          toInsert.push({
            ...row,
            avg_daily_usage: 0,
            lead_time_days: 1,
            target_days_cover: 3,
          });
        }
      }

      if (toInsert.length > 0) {
        const { error } = await supabase
          .from("inventory_items" as any)
          .insert(toInsert);
        if (error) {
          console.error("[inventory-sync] Insert error:", error.message);
        } else {
          created += toInsert.length;
        }
      }

      // Update existing items one-by-one (Supabase doesn't support bulk update)
      for (const upd of toUpdate) {
        const { id, ...fields } = upd;
        const { error } = await supabase
          .from("inventory_items" as any)
          .update(fields)
          .eq("id", id);
        if (error) {
          console.error(`[inventory-sync] Update error for ${id}:`, error.message);
        } else {
          updated++;
        }
      }
    }

    // Mark sync run as success
    await supabase
      .from("micros_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "success",
        records_fetched: itemCount,
        records_inserted: created + updated,
      })
      .eq("id", syncRunId);

    // Update connection last_sync_at
    const now = new Date().toISOString();
    await supabase
      .from("micros_connections")
      .update({
        last_sync_at: now,
        last_successful_sync_at: now,
      })
      .eq("id", connection.id);

    return {
      success: true,
      message: `Synced ${itemCount} inventory items from MICROS (${created} new, ${updated} updated)`,
      businessDate,
      itemsSynced: itemCount,
      itemsCreated: created,
      itemsUpdated: updated,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("micros_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "error",
        error_message: errMsg.slice(0, 500),
      })
      .eq("id", syncRunId);

    return {
      success: false,
      message: errMsg,
      businessDate,
      errors: [errMsg],
    };
  }
}
