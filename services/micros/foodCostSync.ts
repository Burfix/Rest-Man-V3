/**
 * services/micros/foodCostSync.ts
 *
 * Syncs menu item catalog and daily food cost data from Oracle MICROS BI API
 * into local tables: menu_item_dimensions, menu_item_food_costs, food_cost_snapshots.
 *
 * Data sources (BI API — already authenticated via MicrosApiClient):
 *   - getMenuItemDimensions → menu catalog (name, group, prices)
 *   - getMenuItemDailyTotals → per-item sales + prepCost per business date
 *
 * This replaces the IM SOAP GetStockOnHandList approach (IM module not provisioned).
 */

import { createServerClient } from "@/lib/supabase/server";
import { MicrosApiClient } from "@/lib/micros/client";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";
import { todayISO } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── BI API response types ──────────────────────────────────────────────────

interface BiMenuItemDimension {
  miNum: number;
  name: string;
  name2?: string;
  majorGroupNum?: number;
  majorGroupName?: string;
  familyGroupNum?: number;
  familyGroupName?: string;
  price1?: number;
  price2?: number;
}

interface BiMenuItemDimensionsResponse {
  locRef: string;
  menuItems: BiMenuItemDimension[];
}

interface BiMenuItemDailyTotal {
  miNum: number;
  slsTtl: number;
  slsCnt: number;
  prepCost?: number;
  /** Other fields we don't use */
  [key: string]: unknown;
}

interface BiRevenueCenter {
  num: number;
  name: string;
  menuItems: BiMenuItemDailyTotal[];
}

interface BiMenuItemDailyTotalsResponse {
  locRef: string;
  busDt: string;
  curUTC: string;
  revenueCenters: BiRevenueCenter[];
}

// ── Sync parameters and result ─────────────────────────────────────────────

export interface FoodCostSyncParams {
  siteId: string;
  locRef: string;
  businessDate?: string;
  syncDimensions?: boolean; // default true
  actorUserId?: string;
}

export interface FoodCostSyncResult {
  ok: boolean;
  siteId: string;
  businessDate: string;
  dimensionsSynced: number;
  itemCostsSynced: number;
  totalSales: number;
  totalPrepCost: number;
  foodCostPct: number | null;
  error?: string;
  durationMs: number;
}

// ── Main sync function ─────────────────────────────────────────────────────

export async function syncFoodCostFromBI(
  params: FoodCostSyncParams,
): Promise<FoodCostSyncResult> {
  const { siteId, locRef } = params;
  const businessDate = params.businessDate ?? todayISO();
  const syncDimensions = params.syncDimensions !== false;
  const startMs = Date.now();
  const supabase = createServerClient();

  const logMeta = { siteId, locRef, businessDate, route: "food-cost-sync" };
  logger.info("Food cost sync starting", logMeta);

  try {
    // ── 1. Sync menu item dimensions (catalog) ─────────────────────────
    let dimensionsSynced = 0;

    if (syncDimensions) {
      try {
        const dimResponse = await MicrosApiClient.post<BiMenuItemDimensionsResponse>(
          "getMenuItemDimensions",
          { locRef },
        );

        const menuItems = dimResponse?.menuItems ?? [];
        if (menuItems.length > 0) {
          dimensionsSynced = await upsertMenuDimensions(supabase, siteId, menuItems);
          logger.info("Menu dimensions synced", { ...logMeta, count: dimensionsSynced });
        }
      } catch (dimErr) {
        // Non-fatal — continue with daily totals
        logger.warn("Menu dimensions sync failed (non-fatal)", {
          ...logMeta,
          err: dimErr instanceof Error ? dimErr.message : String(dimErr),
        });
      }
    }

    // ── 2. Fetch daily totals with prepCost ────────────────────────────
    const dailyResponse = await MicrosApiClient.post<BiMenuItemDailyTotalsResponse>(
      "getMenuItemDailyTotals",
      { locRef, busDt: businessDate },
    );

    const revenueCenters = dailyResponse?.revenueCenters ?? [];
    let totalSales = 0;
    let totalPrepCost = 0;
    let itemCostsSynced = 0;

    // ── 3. Flatten all revenue center items and upsert ─────────────────
    const rows: any[] = [];

    for (const rc of revenueCenters) {
      for (const mi of rc.menuItems ?? []) {
        const sales = mi.slsTtl ?? 0;
        const prepCost = mi.prepCost ?? 0;
        const count = mi.slsCnt ?? 0;
        const costPct = sales > 0 ? (prepCost / sales) * 100 : null;

        totalSales += sales;
        totalPrepCost += prepCost;

        rows.push({
          store_id: siteId,
          business_date: businessDate,
          micros_mi_num: mi.miNum,
          revenue_center: rc.num,
          sales_total: sales,
          sales_count: count,
          prep_cost: prepCost,
          food_cost_pct: costPct !== null ? Math.round(costPct * 100) / 100 : null,
          synced_at: new Date().toISOString(),
        });
      }
    }

    // Batch upsert menu_item_food_costs
    if (rows.length > 0) {
      itemCostsSynced = await upsertMenuItemCosts(supabase, rows);
      logger.info("Menu item costs synced", { ...logMeta, count: itemCostsSynced });
    }

    // ── 4. Write daily food_cost_snapshots aggregate ───────────────────
    const overallPct = totalSales > 0
      ? Math.round((totalPrepCost / totalSales) * 10000) / 100
      : null;

    const TARGET_FOOD_COST_PCT = 30.0; // industry standard default

    await (supabase as any)
      .from("food_cost_snapshots")
      .upsert(
        {
          store_id: siteId,
          date: businessDate,
          sales_total: Math.round(totalSales * 100) / 100,
          purchases_total: null, // not available from BI API
          prep_cost_total: Math.round(totalPrepCost * 100) / 100,
          estimated_food_cost_pct: overallPct,
          target_food_cost_pct: TARGET_FOOD_COST_PCT,
          variance_pct: overallPct !== null ? Math.round((overallPct - TARGET_FOOD_COST_PCT) * 100) / 100 : null,
          item_count: rows.length,
          source: "micros-bi",
        },
        { onConflict: "store_id,date" },
      );

    // ── 5. Enrich inventory_items with prepCost from dimension data ────
    await enrichInventoryItemsFromDimensions(supabase, siteId, businessDate);

    const durationMs = Date.now() - startMs;
    logger.info("Food cost sync completed", {
      ...logMeta,
      dimensionsSynced,
      itemCostsSynced,
      totalSales: Math.round(totalSales),
      totalPrepCost: Math.round(totalPrepCost),
      foodCostPct: overallPct,
      durationMs,
    });

    return {
      ok: true,
      siteId,
      businessDate,
      dimensionsSynced,
      itemCostsSynced,
      totalSales: Math.round(totalSales * 100) / 100,
      totalPrepCost: Math.round(totalPrepCost * 100) / 100,
      foodCostPct: overallPct,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = err instanceof Error ? err.message : String(err);

    logger.error("Food cost sync failed", { ...logMeta, err, durationMs });
    Sentry.captureException(err);

    return {
      ok: false,
      siteId,
      businessDate,
      dimensionsSynced: 0,
      itemCostsSynced: 0,
      totalSales: 0,
      totalPrepCost: 0,
      foodCostPct: null,
      error: errMsg,
      durationMs,
    };
  }
}

// ── DB helpers ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 200;

async function upsertMenuDimensions(
  supabase: ReturnType<typeof createServerClient>,
  siteId: string,
  items: BiMenuItemDimension[],
): Promise<number> {
  let synced = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE).map((mi) => ({
      store_id: siteId,
      micros_mi_num: mi.miNum,
      item_name: mi.name ?? `MI#${mi.miNum}`,
      major_group_num: mi.majorGroupNum ?? null,
      major_group_name: mi.majorGroupName ?? null,
      family_group_num: mi.familyGroupNum ?? null,
      family_group_name: mi.familyGroupName ?? null,
      price_1: mi.price1 ?? null,
      price_2: mi.price2 ?? null,
      synced_at: now,
    }));

    const { error } = await (supabase as any)
      .from("menu_item_dimensions")
      .upsert(batch, { onConflict: "store_id,micros_mi_num" });

    if (error) {
      logger.error("Menu dimensions upsert error", { error: error.message, batch: i });
    } else {
      synced += batch.length;
    }
  }

  return synced;
}

async function upsertMenuItemCosts(
  supabase: ReturnType<typeof createServerClient>,
  rows: any[],
): Promise<number> {
  let synced = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { error } = await (supabase as any)
      .from("menu_item_food_costs")
      .upsert(batch, { onConflict: "store_id,business_date,micros_mi_num,revenue_center" });

    if (error) {
      logger.error("Menu item costs upsert error", { error: error.message, batch: i });
    } else {
      synced += batch.length;
    }
  }

  return synced;
}

/**
 * Enrich inventory_items that have micros_item_id with prep cost data.
 * Maps micros_mi_num → micros_item_id to bridge BI daily totals → inventory items.
 */
async function enrichInventoryItemsFromDimensions(
  supabase: ReturnType<typeof createServerClient>,
  siteId: string,
  businessDate: string,
): Promise<void> {
  try {
    // Get all menu item costs for the date (aggregated across revenue centers)
    const { data: costs } = await (supabase as any)
      .from("menu_item_food_costs")
      .select("micros_mi_num, sales_total, sales_count, prep_cost")
      .eq("store_id", siteId)
      .eq("business_date", businessDate);

    if (!costs || costs.length === 0) return;

    // Aggregate by miNum (may have multiple revenue centers)
    const costByMiNum = new Map<number, { sales: number; prepCost: number; count: number }>();
    for (const c of costs as any[]) {
      const existing = costByMiNum.get(c.micros_mi_num) ?? { sales: 0, prepCost: 0, count: 0 };
      existing.sales += Number(c.sales_total) || 0;
      existing.prepCost += Number(c.prep_cost) || 0;
      existing.count += Number(c.sales_count) || 0;
      costByMiNum.set(c.micros_mi_num, existing);
    }

    // Get inventory items that have micros_item_id
    const { data: invItems } = await (supabase as any)
      .from("inventory_items")
      .select("id, micros_item_id, name")
      .eq("store_id", siteId)
      .not("micros_item_id", "is", null);

    if (!invItems || invItems.length === 0) return;

    // Update inventory items with unit_cost from prepCost data
    for (const item of invItems as any[]) {
      const miNum = parseInt(item.micros_item_id, 10);
      if (isNaN(miNum)) continue;

      const costData = costByMiNum.get(miNum);
      if (!costData || costData.count === 0) continue;

      // Unit cost = prepCost per unit sold
      const unitCost = costData.prepCost / costData.count;

      await (supabase as any)
        .from("inventory_items")
        .update({
          unit_cost: Math.round(unitCost * 100) / 100,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }
  } catch (err) {
    // Non-fatal
    logger.warn("enrichInventoryItemsFromDimensions failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
