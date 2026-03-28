/**
 * services/micros/inventory/sync.ts
 *
 * Orchestrates inventory sync from Oracle MICROS → Supabase inventory_items.
 *
 * Uses the Inventory Management POS Web Services API endpoint:
 *   GET GetStockOnHandList → Returns StockOnHand[] with ItemNumber, Item, Qty, CostCenter
 *
 * Auth: Standard RNA PKCE Bearer token (same as BI API — NO separate IM user).
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 */

import { createServerClient } from "@/lib/supabase/server";
import { getMicrosEnvConfig, isMicrosEnabled } from "@/lib/micros/config";
import { seedMicrosTokenCache, getCachedMicrosToken } from "@/lib/micros/auth";
import { getMicrosConnection } from "@/services/micros/status";
import { fetchAllStockOnHand } from "../imClient";
import { todayISO } from "@/lib/utils";
import type { OracleStockOnHand, InventorySyncResult } from "./types";
import { logger } from "@/lib/logger";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Normalise Oracle StockOnHand → Supabase row ─────────────────────────────

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
    cost_center_id: costCenter?.ID ?? costCenter?.id ?? null,
    cost_center_name: costCenter?.Name ?? costCenter?.name ?? null,
    updated_at: new Date().toISOString(),
  };
}

// ── Public sync function ────────────────────────────────────────────────────

export async function syncInventoryFromMicros(
  date?: string,
): Promise<InventorySyncResult> {
  const businessDate = date ?? todayISO();
  const connection = await getMicrosConnection();

  if (!connection) {
    return { success: false, message: "No MICROS connection configured." };
  }

  if (!isMicrosEnabled()) {
    return { success: false, message: "MICROS integration is disabled." };
  }

  if (process.env.MICROS_IM_ENABLED !== "true") {
    return { success: false, message: "MICROS IM module not enabled (set MICROS_IM_ENABLED=true when provisioned)." };
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
    // Seed PKCE token from DB (cold-start optimisation)
    // access_token / token_expires_at / refresh_token are on the DB row but not on the MicrosConnection type
    const connRow = connection as typeof connection & {
      access_token?: string;
      token_expires_at?: string;
      refresh_token?: string;
    };
    if (connRow.access_token && connRow.token_expires_at) {
      const expiresAt = new Date(connRow.token_expires_at).getTime();
      if (expiresAt > Date.now()) {
        seedMicrosTokenCache(connRow.access_token, expiresAt, connRow.refresh_token);
      }
    }

    // Call IM API with standard RNA PKCE auth
    const result = await fetchAllStockOnHand({
      requestId: syncRunId,
      siteId: connection.id,
    });

    // Persist refreshed token (token only — do NOT touch status/last_sync_at)
    const tokenInfo = getCachedMicrosToken();
    if (tokenInfo) {
      const tokenUpdate: Record<string, unknown> = {
        access_token: tokenInfo.idToken,
        token_expires_at: new Date(tokenInfo.expiresAt).toISOString(),
      };
      if (tokenInfo.refreshToken) tokenUpdate.refresh_token = tokenInfo.refreshToken;
      await supabase
        .from("micros_connections")
        .update(tokenUpdate)
        .eq("id", connection.id)
        .then(null, () => {}); // best-effort
    }

    if (!result.ok) {
      await supabase
        .from("micros_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error_message: (result.errorMessage ?? "IM API call failed").slice(0, 500),
        })
        .eq("id", syncRunId);

      return {
        success: false,
        message: result.errorMessage ?? "IM API call failed",
        businessDate,
        errors: [result.errorMessage ?? "unknown"],
      };
    }

    const oracleItems = result.items;
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

    // Get store_id from first inventory item or use a fallback
    const { data: siteRow } = await (supabase as any)
      .from("inventory_items")
      .select("store_id")
      .limit(1)
      .maybeSingle();
    const storeId = siteRow?.store_id ?? "00000000-0000-0000-0000-000000000001";

    // Normalise all items
    const rows = oracleItems.map((soh) => normalizeStockOnHand(soh, storeId));

    // Upsert in batches of 100
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const microsIds = batch.map((r) => r.micros_item_id);

      const { data: existing } = await (supabase as any)
        .from("inventory_items")
        .select("id, micros_item_id")
        .eq("store_id", storeId)
        .in("micros_item_id", microsIds);

      const existingMap = new Map<string, string>(
        (existing ?? []).map((e: any) => [e.micros_item_id, e.id]),
      );

      const toInsert: any[] = [];
      const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

      for (const row of batch) {
        const existingId = existingMap.get(row.micros_item_id);
        if (existingId) {
          toUpdate.push({
            id: existingId,
            fields: {
              current_stock: row.current_stock,
              unit: row.unit,
              category: row.category,
              updated_at: row.updated_at,
            },
          });
        } else {
          toInsert.push({
            store_id: row.store_id,
            micros_item_id: row.micros_item_id,
            name: row.name,
            category: row.category ?? "general",
            unit: row.unit ?? "ea",
            current_stock: row.current_stock,
            minimum_threshold: 0,
            par_level: 0,
            avg_daily_usage: 0,
            lead_time_days: 1,
            target_days_cover: 3,
          });
        }
      }

      if (toInsert.length > 0) {
        const { error } = await (supabase as any)
          .from("inventory_items")
          .insert(toInsert);
        if (error) {
          errors.push(`insert batch ${i}: ${error.message}`);
        } else {
          created += toInsert.length;
        }
      }

      for (const upd of toUpdate) {
        const { error } = await (supabase as any)
          .from("inventory_items")
          .update(upd.fields)
          .eq("id", upd.id);
        if (error) {
          errors.push(`update ${upd.id}: ${error.message}`);
        } else {
          updated++;
        }
      }
    }

    // Update sync run
    await supabase
      .from("micros_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: errors.length > 0 ? "partial_success" : "success",
        records_fetched: itemCount,
        records_inserted: created,
        error_message: errors.length > 0 ? errors.slice(0, 5).join("; ").slice(0, 500) : null,
      })
      .eq("id", syncRunId);

    // Update connection last_sync_at
    await supabase
      .from("micros_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_successful_sync_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    logger.info("Inventory sync completed", {
      businessDate,
      fetched: itemCount,
      created,
      updated,
      errors: errors.length,
    });

    return {
      success: true,
      message: `Synced ${itemCount} items: ${created} created, ${updated} updated`,
      businessDate,
      itemsSynced: created + updated,
      itemsCreated: created,
      itemsUpdated: updated,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("Inventory sync crashed", { err, syncRunId });

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
