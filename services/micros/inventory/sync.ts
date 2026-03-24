/**
 * services/micros/inventory/sync.ts
 *
 * Orchestrates inventory sync from Oracle MICROS → Supabase inventory_items.
 *
 * Uses the Inventory Management POS Web Services API endpoint:
 *   GetStockOnHandList → Returns StockOnHand[] with ItemNumber, Item, Qty, CostCenter
 *
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 */

import { createServerClient } from "@/lib/supabase/server";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getMicrosConnection } from "@/services/micros/status";
import { getStockOnHandList } from "./client";
import { todayISO } from "@/lib/utils";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import type { OracleStockOnHand, InventorySyncResult } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Normalise Oracle StockOnHand → Supabase row ─────────────────────────────

/**
 * Maps an Oracle StockOnHand record to our inventory_items schema.
 * Uses ItemNumber as the stable Oracle identifier for upsert matching.
 * Handles both PascalCase and camelCase field names from Oracle.
 */
function normalizeStockOnHand(soh: OracleStockOnHand, storeId: string) {
  const itemNumber = soh.ItemNumber ?? soh.itemNumber ?? 0;
  const itemName = soh.Item ?? soh.item ?? `Item ${itemNumber}`;
  const qty = soh.Qty ?? soh.qty;
  const costCenter = soh.CostCenter ?? soh.costCenter;

  const currentStock = qty?.Value ?? qty?.value ?? 0;
  const unit = qty?.Unit ?? qty?.unit ?? "ea";
  const category = costCenter?.Name ?? costCenter?.name ?? "Uncategorised";

  return {
    store_id: storeId,
    micros_item_id: String(itemNumber),
    name: itemName,
    category,
    unit,
    current_stock: currentStock,
    updated_at: new Date().toISOString(),
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
    // Fetch stock-on-hand from Oracle MICROS Inventory Management API
    const result = await getStockOnHandList();

    // Handle Oracle Result<StockOnHand[]> wrapper
    const success = result.Success ?? result.success;
    if (success === false) {
      const msg = result.Message ?? result.message ?? "GetStockOnHandList returned an error";
      await supabase
        .from("micros_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error_message: msg.slice(0, 500),
        })
        .eq("id", syncRunId);

      return { success: false, message: msg, businessDate, errors: [msg] };
    }

    const oracleItems = result.Data ?? result.data ?? [];
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
        message: "No stock-on-hand items returned from MICROS.",
        businessDate,
        itemsSynced: 0,
      };
    }

    // Normalise all items
    const storeId = DEFAULT_ORG_ID;
    const rows = oracleItems.map((soh) => normalizeStockOnHand(soh, storeId));

    // Upsert in batches of 100
    let created = 0;
    let updated = 0;
    const batchSize = 100;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      const microsIds = batch.map((r) => r.micros_item_id);
      const names = batch.map((r) => r.name);

      let existingMap = new Map<string, string>();

      // Try micros_item_id lookup
      const { data: byMicrosId, error: microsIdErr } = await supabase
        .from("inventory_items" as any)
        .select("id, micros_item_id, name")
        .eq("store_id", storeId)
        .in("micros_item_id", microsIds);

      if (!microsIdErr && byMicrosId) {
        existingMap = new Map(
          (byMicrosId as any[]).map((e: any) => [e.micros_item_id, e.id]),
        );
      } else {
        // Fallback: match by name (micros_item_id column may not exist)
        const { data: byName } = await supabase
          .from("inventory_items" as any)
          .select("id, name")
          .eq("store_id", storeId)
          .in("name", names);

        if (byName) {
          existingMap = new Map(
            (byName as any[]).map((e: any) => [e.name, e.id]),
          );
        }
      }

      const hasMicrosCol = !microsIdErr;
      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const row of batch) {
        const matchKey = hasMicrosCol ? row.micros_item_id : row.name;
        const existingId = existingMap.get(matchKey);
        if (existingId) {
          const updateFields: any = {
            id: existingId,
            current_stock: row.current_stock,
            updated_at: row.updated_at,
          };
          if (hasMicrosCol) updateFields.micros_item_id = row.micros_item_id;
          toUpdate.push(updateFields);
        } else {
          const insertRow: any = {
            ...row,
            minimum_threshold: 0,
            par_level: 0,
            avg_daily_usage: 0,
            lead_time_days: 1,
            target_days_cover: 3,
          };
          if (!hasMicrosCol) delete insertRow.micros_item_id;
          toInsert.push(insertRow);
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
      message: `Synced ${itemCount} stock-on-hand items from MICROS (${created} new, ${updated} updated)`,
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
