/**
 * services/micros/inventorySync.ts
 *
 * Orchestrates inventory sync from Oracle MICROS IM → local inventory tables.
 *
 * Responsibilities:
 *   1. Load site-specific MICROS config
 *   2. Call the IM GetStockOnHandList endpoint
 *   3. Normalize Oracle response into NormalizedStockItem[]
 *   4. Upsert into inventory_items (matched by store_id + micros_item_id)
 *   5. Write inventory_sync_batches audit record
 *   6. Structured logging + Sentry capture on failure
 *
 * IMPORTANT: No DEFAULT_SITE_ID — siteId is always required explicitly.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";
import {
  fetchAllStockOnHand,
} from "./imClient";
import type { OracleStockOnHand } from "./inventory/types";
import { isMicrosEnabled } from "@/lib/micros/config";
import { seedMicrosTokenCache, getCachedMicrosToken } from "@/lib/micros/auth";
import { todayISO } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ───────────────────────────────────────────────────────────────────

export interface NormalizedStockItem {
  siteId: string;
  itemCode: string;
  itemName: string;
  stockOnHand: number;
  unit?: string;
  category?: string;
  locationCode?: string;
  businessDate?: string;
  source: "micros-im";
}

export interface InventorySyncParams {
  siteId: string;
  businessDate?: string;
  locationCode?: string;
  forceFullSync?: boolean;
  actorUserId: string;
  requestId?: string;
}

export interface InventorySyncResult {
  ok: boolean;
  source: "micros-im";
  siteId: string;
  fetched: number;
  inserted: number;
  updated: number;
  failed: number;
  syncedAt: string;
  error?: string;
  details?: string;
}

// ── Normalization ───────────────────────────────────────────────────────────

function normalizeStockOnHand(
  soh: OracleStockOnHand,
  siteId: string,
  businessDate?: string,
): NormalizedStockItem {
  const itemNumber = soh.ItemNumber ?? soh.itemNumber ?? 0;
  const itemName = soh.Item ?? soh.item ?? `Item ${itemNumber}`;
  const qty = soh.Qty ?? soh.qty;
  const costCenter = soh.CostCenter ?? soh.costCenter;

  return {
    siteId,
    itemCode: String(itemNumber),
    itemName,
    stockOnHand: qty?.Value ?? qty?.value ?? 0,
    unit: qty?.Unit ?? qty?.unit ?? "ea",
    category: costCenter?.Name ?? costCenter?.name ?? "Uncategorised",
    businessDate,
    source: "micros-im",
  };
}

// ── DB helpers ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;

async function upsertInventoryItems(
  supabase: ReturnType<typeof createServerClient>,
  items: NormalizedStockItem[],
  siteId: string,
): Promise<{ inserted: number; updated: number; failed: number }> {
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const microsIds = batch.map((r) => r.itemCode);

    // Look up existing items by (store_id, micros_item_id)
    const { data: existing } = await (supabase as any)
      .from("inventory_items")
      .select("id, micros_item_id")
      .eq("store_id", siteId)
      .in("micros_item_id", microsIds);

    const existingMap = new Map<string, string>(
      (existing ?? []).map((e: any) => [e.micros_item_id, e.id]),
    );

    const toInsert: any[] = [];
    const toUpdate: { id: string; fields: Record<string, unknown> }[] = [];

    for (const item of batch) {
      const existingId = existingMap.get(item.itemCode);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          fields: {
            current_stock: item.stockOnHand,
            unit: item.unit,
            category: item.category,
            updated_at: new Date().toISOString(),
          },
        });
      } else {
        toInsert.push({
          store_id: siteId,
          micros_item_id: item.itemCode,
          name: item.itemName,
          category: item.category ?? "general",
          unit: item.unit ?? "ea",
          current_stock: item.stockOnHand,
          minimum_threshold: 0,
          par_level: 0,
          avg_daily_usage: 0,
          lead_time_days: 1,
          target_days_cover: 3,
        });
      }
    }

    // Batch insert
    if (toInsert.length > 0) {
      const { error } = await (supabase as any)
        .from("inventory_items")
        .insert(toInsert);
      if (error) {
        logger.error("Inventory sync insert error", { err: error, count: toInsert.length, siteId });
        failed += toInsert.length;
      } else {
        inserted += toInsert.length;
      }
    }

    // Individual updates (Supabase doesn't support bulk update with different values)
    for (const upd of toUpdate) {
      const { error } = await (supabase as any)
        .from("inventory_items")
        .update(upd.fields)
        .eq("id", upd.id)
        .eq("store_id", siteId);
      if (error) {
        logger.error("Inventory sync update error", { err: error, itemId: upd.id, siteId });
        failed++;
      } else {
        updated++;
      }
    }
  }

  return { inserted, updated, failed };
}

// ── Main sync function ──────────────────────────────────────────────────────

export async function syncMicrosInventory(
  params: InventorySyncParams,
): Promise<InventorySyncResult> {
  const { siteId, actorUserId, requestId } = params;
  const businessDate = params.businessDate ?? todayISO();
  const syncedAt = new Date().toISOString();
  const supabase = createServerClient();
  const batchId = crypto.randomUUID();

  const logMeta = { requestId, siteId, actorUserId, batchId, route: "inventory-sync" };

  logger.info("Inventory sync starting", logMeta);
  const startMs = Date.now();

  // 1. Write sync batch record (non-fatal if table doesn't exist yet)
  const { error: batchErr } = await (supabase as any).from("inventory_sync_batches").insert({
    id: batchId,
    site_id: siteId,
    started_at: syncedAt,
    status: "running",
    source: "micros-im",
    request_id: requestId ?? null,
    actor_user_id: actorUserId,
    fetched_count: 0,
    inserted_count: 0,
    updated_count: 0,
    failed_count: 0,
  });
  const hasBatchTable = !batchErr;

  try {
    // 2. Validate MICROS is enabled + IM module is provisioned
    if (!isMicrosEnabled()) {
      const msg = "MICROS integration is disabled (MICROS_ENABLED != true)";
      logger.warn("Inventory sync skipped: MICROS disabled", logMeta);
      await finalizeBatch(supabase, batchId, "skipped", 0, 0, 0, 0, msg);
      return { ok: false, source: "micros-im", siteId, fetched: 0, inserted: 0, updated: 0, failed: 0, syncedAt, error: msg };
    }

    if (process.env.MICROS_IM_ENABLED !== "true") {
      const msg = "MICROS IM module not enabled (set MICROS_IM_ENABLED=true when provisioned)";
      logger.info("Inventory sync skipped: IM not enabled", logMeta);
      await finalizeBatch(supabase, batchId, "skipped", 0, 0, 0, 0, msg);
      return { ok: false, source: "micros-im", siteId, fetched: 0, inserted: 0, updated: 0, failed: 0, syncedAt, error: msg };
    }

    // 3. Seed PKCE token cache from DB (cold-start optimisation)
    const { data: connection } = await (supabase as any)
      .from("micros_connections")
      .select("id, loc_ref, access_token, token_expires_at, refresh_token")
      .limit(1)
      .maybeSingle();

    if (connection?.access_token && connection?.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at).getTime();
      if (expiresAt > Date.now()) {
        seedMicrosTokenCache(connection.access_token, expiresAt, connection.refresh_token);
      }
    }

    logger.info("MICROS IM config resolved, using PKCE Bearer auth", logMeta);

    // 4. Call Oracle IM API (uses standard RNA PKCE credentials)
    const imResult = await fetchAllStockOnHand({ requestId, siteId });

    // Persist refreshed token back to DB (token only — do NOT touch status/last_sync_at)
    const tokenInfo = getCachedMicrosToken();
    if (tokenInfo && connection?.id) {
      const tokenUpdate: Record<string, unknown> = {
        access_token: tokenInfo.idToken,
        token_expires_at: new Date(tokenInfo.expiresAt).toISOString(),
      };
      if (tokenInfo.refreshToken) tokenUpdate.refresh_token = tokenInfo.refreshToken;
      await (supabase as any)
        .from("micros_connections")
        .update(tokenUpdate)
        .eq("id", connection.id)
        .then(null, () => {}); // best-effort
    }

    if (!imResult.ok) {
      logger.error("MICROS IM API failed", { ...logMeta, error: imResult.errorMessage, durationMs: imResult.durationMs });
      Sentry.captureMessage("MICROS IM sync failed: " + imResult.errorMessage, "error");
      await finalizeBatch(supabase, batchId, "error", 0, 0, 0, 0, imResult.errorMessage);
      return {
        ok: false,
        source: "micros-im",
        siteId,
        fetched: 0,
        inserted: 0,
        updated: 0,
        failed: 0,
        syncedAt,
        error: "Inventory sync failed",
        details: imResult.errorMessage,
      };
    }

    const fetched = imResult.items.length;
    logger.info("MICROS IM items fetched", { ...logMeta, fetched, durationMs: imResult.durationMs });

    if (fetched === 0) {
      await finalizeBatch(supabase, batchId, "success", 0, 0, 0, 0);
      return { ok: true, source: "micros-im", siteId, fetched: 0, inserted: 0, updated: 0, failed: 0, syncedAt };
    }

    // 4. Normalize
    const normalized = imResult.items.map((soh) =>
      normalizeStockOnHand(soh, siteId, businessDate),
    );

    // 5. Upsert into inventory_items
    const { inserted, updated, failed } = await upsertInventoryItems(supabase, normalized, siteId);

    const status = failed > 0 ? "partial" : "success";
    await finalizeBatch(supabase, batchId, status, fetched, inserted, updated, failed);

    // 6. Inventory sync does NOT update micros_connections last_sync_at
    // Those timestamps belong to sales/labour syncs only

    const totalMs = Date.now() - startMs;
    logger.info("Inventory sync completed", {
      ...logMeta,
      fetched,
      inserted,
      updated,
      failed,
      durationMs: totalMs,
    });

    return { ok: true, source: "micros-im", siteId, fetched, inserted, updated, failed, syncedAt };
  } catch (err) {
    const totalMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);

    logger.error("Inventory sync crashed", { ...logMeta, err, durationMs: totalMs });
    Sentry.captureException(err);

    await finalizeBatch(supabase, batchId, "error", 0, 0, 0, 0, errMsg.slice(0, 500));

    return {
      ok: false,
      source: "micros-im",
      siteId,
      fetched: 0,
      inserted: 0,
      updated: 0,
      failed: 0,
      syncedAt,
      error: "Inventory sync failed",
      details: "An internal error occurred during sync",
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function finalizeBatch(
  supabase: ReturnType<typeof createServerClient>,
  batchId: string,
  status: string,
  fetched: number,
  inserted: number,
  updated: number,
  failed: number,
  errorMessage?: string,
): Promise<void> {
  await (supabase as any)
    .from("inventory_sync_batches")
    .update({
      completed_at: new Date().toISOString(),
      status,
      fetched_count: fetched,
      inserted_count: inserted,
      updated_count: updated,
      failed_count: failed,
      error_message: errorMessage?.slice(0, 500) ?? null,
    })
    .eq("id", batchId);
}
