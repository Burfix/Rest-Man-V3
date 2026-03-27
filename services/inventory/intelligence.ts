/**
 * Inventory Intelligence Service
 *
 * Real-time operational intelligence from stock data.
 * Powers the command center's inventory risk scoring,
 * priority actions, service disruption alerts, and the
 * inventory status widget.
 *
 * All functions fail gracefully — returns safe defaults
 * so the dashboard never breaks if inventory data is unavailable.
 */

import { createServerClient } from "@/lib/supabase/server";
import type {
  InventoryItem,
  InventoryItemWithRisk,
  StockRiskLevel,
  PurchaseOrder,
} from "@/types/inventory";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InventoryIntelligence {
  criticalItems:    InventoryItemWithRisk[];
  lowItems:         InventoryItemWithRisk[];
  healthyCount:     number;
  noPOItems:        InventoryItemWithRisk[];
  menuImpact:       MenuImpactItem[];
  riskScore:        number; // 0–10
  lastSynced:       string | null;
  totalItems:       number;
  estimatedLostRevenue: number;
}

export interface MenuImpactItem {
  ingredientName:  string;
  ingredientId:    string;
  riskLevel:       StockRiskLevel;
  daysRemaining:   number | null;
  stockOnHand:     number;
  unit:            string;
  affectedDishes:  string[];
  estimatedRevenueLoss: number;
}

// ── Stock risk computation (shared with service.ts) ─────────────────────────

function computeStockRisk(item: InventoryItem): InventoryItemWithRisk {
  const daysRemaining = item.avg_daily_usage > 0
    ? item.current_stock / item.avg_daily_usage
    : null;

  let risk_level: StockRiskLevel = "healthy";
  if (daysRemaining !== null && daysRemaining <= 1) risk_level = "critical";
  else if (daysRemaining !== null && daysRemaining <= 3) risk_level = "warning";
  else if (item.current_stock <= item.minimum_threshold) risk_level = "warning";
  if (item.current_stock <= 0) risk_level = "critical";

  const targetStock = item.avg_daily_usage * item.target_days_cover;
  const deficit = targetStock - item.current_stock;
  const suggested_order = deficit > 0
    ? Math.max(deficit, item.typical_order_qty ?? deficit)
    : null;

  const needs_order_today = risk_level !== "healthy"
    || (daysRemaining !== null && daysRemaining <= item.lead_time_days + 1);

  return {
    ...item,
    days_remaining: daysRemaining !== null ? Math.round(daysRemaining * 10) / 10 : null,
    risk_level,
    suggested_order: suggested_order !== null ? Math.round(suggested_order * 10) / 10 : null,
    needs_order_today,
  };
}

// ── Menu impact mapping ─────────────────────────────────────────────────────
// Maps ingredient categories to commonly affected dishes.
// In a full system this would query a recipes table; here we use
// category-based heuristics from the seed data.

const CATEGORY_MENU_MAP: Record<string, string[]> = {
  "Proteins":    ["Grilled Chicken", "Beef Burger", "Steak", "Fish & Chips"],
  "Dairy":       ["Caesar Salad", "Pasta Carbonara", "Pizza Margherita", "Tiramisu"],
  "Produce":     ["Garden Salad", "Bruschetta", "Grilled Vegetables", "Fresh Juice"],
  "Dry Goods":   ["Pasta Bolognese", "Risotto", "Bread Basket", "Pizza Base"],
  "Beverages":   ["Cocktails", "Fresh Juice", "Coffee", "Milkshake"],
  "Oils & Sauces": ["Grilled Dishes", "Pasta Sauces", "Salad Dressings", "Marinades"],
  "Frozen":      ["Ice Cream Dessert", "Frozen Cocktails", "Sorbet"],
};

// Average revenue per dish — used for impact estimation
const AVG_DISH_REVENUE = 185; // ZAR per affected dish order

// ── Core functions ──────────────────────────────────────────────────────────

export async function getCriticalStockouts(storeId: string): Promise<InventoryItemWithRisk[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("inventory_items" as any)
    .select("*")
    .eq("store_id", storeId)
    .order("current_stock", { ascending: true });

  if (error) {
    console.error("[inventory-intel] getCriticalStockouts error:", error.message);
    return [];
  }

  return (data as unknown as InventoryItem[])
    .map(computeStockRisk)
    .filter((i) => i.risk_level === "critical");
}

export async function getLowStockItems(storeId: string): Promise<InventoryItemWithRisk[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("inventory_items" as any)
    .select("*")
    .eq("store_id", storeId)
    .order("current_stock", { ascending: true });

  if (error) {
    console.error("[inventory-intel] getLowStockItems error:", error.message);
    return [];
  }

  return (data as unknown as InventoryItem[])
    .map(computeStockRisk)
    .filter((i) => i.risk_level === "warning");
}

export async function getItemsWithoutOpenPO(storeId: string): Promise<InventoryItemWithRisk[]> {
  const supabase = createServerClient();

  // Fetch at-risk items and active POs in parallel
  const [itemsResult, posResult] = await Promise.all([
    supabase
      .from("inventory_items" as any)
      .select("*")
      .eq("store_id", storeId),
    supabase
      .from("purchase_orders" as any)
      .select("id, status, purchase_order_items(inventory_item_id)")
      .eq("store_id", storeId)
      .in("status", ["draft", "ordered"]),
  ]);

  if (itemsResult.error) {
    console.error("[inventory-intel] getItemsWithoutOpenPO items error:", itemsResult.error.message);
    return [];
  }

  const items = (itemsResult.data as unknown as InventoryItem[]).map(computeStockRisk);
  const atRisk = items.filter((i) => i.risk_level !== "healthy");

  // Build set of item IDs with active POs
  const coveredIds = new Set<string>();
  if (!posResult.error && posResult.data) {
    for (const po of posResult.data as unknown as PurchaseOrder[]) {
      if (po.items) {
        for (const item of po.items) {
          coveredIds.add(item.inventory_item_id);
        }
      }
    }
  }

  return atRisk.filter((i) => !coveredIds.has(i.id));
}

export function getMenuImpactFromStock(atRiskItems: InventoryItemWithRisk[]): MenuImpactItem[] {
  return atRiskItems
    .filter((item) => item.risk_level !== "healthy")
    .map((item) => {
      const dishes = CATEGORY_MENU_MAP[item.category] ?? [];
      const estimatedRevenueLoss = item.risk_level === "critical"
        ? dishes.length * AVG_DISH_REVENUE * 8  // ~8 potential orders lost per dish
        : dishes.length * AVG_DISH_REVENUE * 3; // warning = fewer expected losses

      return {
        ingredientName:       item.name,
        ingredientId:         item.id,
        riskLevel:            item.risk_level,
        daysRemaining:        item.days_remaining,
        stockOnHand:          item.current_stock,
        unit:                 item.unit,
        affectedDishes:       dishes,
        estimatedRevenueLoss: Math.round(estimatedRevenueLoss),
      };
    })
    .filter((m) => m.affectedDishes.length > 0)
    .sort((a, b) => b.estimatedRevenueLoss - a.estimatedRevenueLoss);
}

// ── Score computation (0–10) ────────────────────────────────────────────────

function computeInventoryRiskScore(
  criticalCount: number,
  lowCount:      number,
  totalItems:    number,
): number {
  if (totalItems === 0) return 7; // neutral — no inventory configured
  if (criticalCount > 0) {
    // 0–2 range: more criticals = lower score
    return Math.max(0, 2 - criticalCount);
  }
  if (lowCount > 0) {
    // 3–6 range: more lows = lower score within warning band
    const ratio = lowCount / totalItems;
    if (ratio > 0.5) return 3;
    if (ratio > 0.3) return 4;
    if (ratio > 0.1) return 5;
    return 6;
  }
  // All healthy
  if (totalItems >= 5) return 10;
  return 8; // few items tracked — healthy but limited data
}

// ── Main aggregator ─────────────────────────────────────────────────────────

export async function getInventoryIntelligence(
  storeId: string,
): Promise<InventoryIntelligence> {
  try {
    const supabase = createServerClient();

    // Fetch all items + active POs in parallel
    const [itemsResult, posResult] = await Promise.all([
      supabase
        .from("inventory_items" as any)
        .select("*")
        .eq("store_id", storeId)
        .order("current_stock", { ascending: true }),
      supabase
        .from("purchase_orders" as any)
        .select("id, status, purchase_order_items(inventory_item_id)")
        .eq("store_id", storeId)
        .in("status", ["draft", "ordered"]),
    ]);

    if (itemsResult.error) {
      console.error("[inventory-intel] getInventoryIntelligence error:", itemsResult.error.message);
      return emptyIntelligence();
    }

    const allItems = (itemsResult.data as unknown as InventoryItem[]).map(computeStockRisk);
    const criticalItems = allItems.filter((i) => i.risk_level === "critical");
    const lowItems = allItems.filter((i) => i.risk_level === "warning");
    const healthyCount = allItems.filter((i) => i.risk_level === "healthy").length;

    // Items without PO coverage
    const coveredIds = new Set<string>();
    if (!posResult.error && posResult.data) {
      for (const po of posResult.data as unknown as PurchaseOrder[]) {
        if (po.items) {
          for (const item of po.items) {
            coveredIds.add(item.inventory_item_id);
          }
        }
      }
    }
    const noPOItems = [...criticalItems, ...lowItems].filter((i) => !coveredIds.has(i.id));

    // Menu impact
    const menuImpact = getMenuImpactFromStock([...criticalItems, ...lowItems]);
    const estimatedLostRevenue = menuImpact.reduce((sum, m) => sum + m.estimatedRevenueLoss, 0);

    // Last synced: latest updated_at across all items
    const lastSynced = allItems.length > 0
      ? allItems.reduce((latest, i) =>
          !latest || i.updated_at > latest ? i.updated_at : latest, "" as string)
      : null;

    return {
      criticalItems,
      lowItems,
      healthyCount,
      noPOItems,
      menuImpact,
      riskScore: computeInventoryRiskScore(criticalItems.length, lowItems.length, allItems.length),
      lastSynced,
      totalItems: allItems.length,
      estimatedLostRevenue,
    };
  } catch (err) {
    console.error("[inventory-intel] Unexpected error:", err);
    return emptyIntelligence();
  }
}

function emptyIntelligence(): InventoryIntelligence {
  return {
    criticalItems:    [],
    lowItems:         [],
    healthyCount:     0,
    noPOItems:        [],
    menuImpact:       [],
    riskScore:        7,
    lastSynced:       null,
    totalItems:       0,
    estimatedLostRevenue: 0,
  };
}
