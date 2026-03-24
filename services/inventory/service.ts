/**
 * Inventory & Food Cost Service
 *
 * Central service for stock management, food cost tracking,
 * and risk assessment. All data flows through this service.
 */

import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import type {
  InventoryItem,
  InventoryItemWithRisk,
  StockRiskLevel,
  StockRiskSummary,
  FoodCostSummary,
  FoodCostSnapshot,
  PurchaseOrder,
  StockMovement,
  StockMovementType,
} from "@/types/inventory";

// ── Stock risk computation ──────────────────────────────────────────────────

function computeStockRisk(item: InventoryItem): InventoryItemWithRisk {
  const daysRemaining = item.avg_daily_usage > 0
    ? item.current_stock / item.avg_daily_usage
    : null;

  let risk_level: StockRiskLevel = "healthy";
  if (daysRemaining !== null && daysRemaining <= 1) risk_level = "critical";
  else if (daysRemaining !== null && daysRemaining <= 3) risk_level = "warning";
  else if (item.current_stock <= item.minimum_threshold) risk_level = "warning";
  if (item.current_stock <= 0) risk_level = "critical";

  // Suggested order: enough to bring back to target_days_cover
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

// ── Public API ──────────────────────────────────────────────────────────────

export async function getInventoryItems(storeId = DEFAULT_ORG_ID): Promise<InventoryItemWithRisk[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("store_id", storeId)
    .order("name");

  if (error) {
    console.error("[inventory] Failed to fetch items:", error.message);
    return [];
  }
  return (data as InventoryItem[]).map(computeStockRisk);
}

export async function getStockRiskSummary(storeId = DEFAULT_ORG_ID): Promise<StockRiskSummary> {
  const items = await getInventoryItems(storeId);
  const critical = items.filter((i) => i.risk_level === "critical");
  const warning  = items.filter((i) => i.risk_level === "warning");
  const healthy  = items.filter((i) => i.risk_level === "healthy");

  return {
    total_items: items.length,
    healthy:     healthy.length,
    warning:     warning.length,
    critical:    critical.length,
    top_risks:   [...critical, ...warning].slice(0, 5),
    needs_order: items.filter((i) => i.needs_order_today),
  };
}

export async function getFoodCostSummary(storeId = DEFAULT_ORG_ID): Promise<FoodCostSummary> {
  const supabase = createServerClient();

  const [snapshotResult, trendResult, stockRisk] = await Promise.all([
    supabase
      .from("food_cost_snapshots")
      .select("*")
      .eq("store_id", storeId)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("food_cost_snapshots")
      .select("date, estimated_food_cost_pct")
      .eq("store_id", storeId)
      .order("date", { ascending: false })
      .limit(7),
    getStockRiskSummary(storeId),
  ]);

  const latest = snapshotResult.data as FoodCostSnapshot | null;
  const trend = ((trendResult.data ?? []) as Pick<FoodCostSnapshot, "date" | "estimated_food_cost_pct">[])
    .filter((r) => r.estimated_food_cost_pct !== null)
    .map((r) => ({ date: r.date, pct: r.estimated_food_cost_pct! }))
    .reverse();

  const currentPct  = latest?.estimated_food_cost_pct ?? null;
  const targetPct   = latest?.target_food_cost_pct ?? null;
  const variancePct = latest?.variance_pct ?? null;

  let status: FoodCostSummary["status"] = "no_data";
  if (currentPct !== null && targetPct !== null) {
    const diff = currentPct - targetPct;
    if (diff <= 0)  status = "on_target";
    else if (diff <= 3) status = "above_target";
    else             status = "high";
  }

  return {
    current_pct:  currentPct,
    target_pct:   targetPct,
    variance_pct: variancePct,
    status,
    trend_7d:     trend,
    stock_risk:   stockRisk,
  };
}

// ── CRUD operations ─────────────────────────────────────────────────────────

export async function createStockMovement(
  itemId: string,
  type: StockMovementType,
  quantity: number,
  note?: string,
  createdBy?: string,
): Promise<StockMovement | null> {
  const supabase = createServerClient();

  // Insert movement
  const { data, error } = await supabase
    .from("stock_movements")
    .insert({
      inventory_item_id: itemId,
      type,
      quantity,
      note: note ?? null,
      created_by: createdBy ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[inventory] createStockMovement error:", error.message);
    return null;
  }

  // Update current_stock on inventory_items
  const delta = type === "delivery" || type === "adjustment" ? quantity : -Math.abs(quantity);
  await supabase.rpc("increment_stock", { item_id: itemId, delta }).catch(() => {
    // Fallback: manual update if RPC doesn't exist
    supabase
      .from("inventory_items")
      .select("current_stock")
      .eq("id", itemId)
      .single()
      .then(({ data: item }) => {
        if (item) {
          const newStock = Math.max(0, (item as { current_stock: number }).current_stock + delta);
          supabase.from("inventory_items").update({ current_stock: newStock, updated_at: new Date().toISOString() }).eq("id", itemId).then(() => {});
        }
      });
  });

  return data as StockMovement;
}

export async function getPurchaseOrders(storeId = DEFAULT_ORG_ID): Promise<PurchaseOrder[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*, purchase_order_items(*)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[inventory] getPurchaseOrders error:", error.message);
    return [];
  }
  return (data ?? []) as PurchaseOrder[];
}

export async function createPurchaseOrder(
  supplierName: string,
  items: { inventory_item_id: string; quantity: number; unit_cost?: number }[],
  storeId = DEFAULT_ORG_ID,
): Promise<PurchaseOrder | null> {
  const supabase = createServerClient();

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({ store_id: storeId, supplier_name: supplierName, status: "draft" })
    .select()
    .single();

  if (error || !po) {
    console.error("[inventory] createPurchaseOrder error:", error?.message);
    return null;
  }

  const poItems = items.map((i) => ({
    purchase_order_id: (po as PurchaseOrder).id,
    inventory_item_id: i.inventory_item_id,
    quantity: i.quantity,
    unit_cost: i.unit_cost ?? null,
    total_cost: i.unit_cost ? i.unit_cost * i.quantity : null,
  }));

  await supabase.from("purchase_order_items").insert(poItems);

  return po as PurchaseOrder;
}

export async function updatePurchaseOrderStatus(
  poId: string,
  status: "ordered" | "received" | "cancelled",
): Promise<boolean> {
  const supabase = createServerClient();
  const updates: Record<string, unknown> = { status };
  if (status === "ordered") updates.ordered_at = new Date().toISOString();
  if (status === "received") updates.received_at = new Date().toISOString();

  const { error } = await supabase
    .from("purchase_orders")
    .update(updates)
    .eq("id", poId);

  if (error) {
    console.error("[inventory] updatePurchaseOrderStatus error:", error.message);
    return false;
  }

  // If received, update stock levels for all items
  if (status === "received") {
    const { data: poItems } = await supabase
      .from("purchase_order_items")
      .select("inventory_item_id, quantity")
      .eq("purchase_order_id", poId);

    if (poItems) {
      for (const item of poItems as { inventory_item_id: string; quantity: number }[]) {
        await createStockMovement(item.inventory_item_id, "delivery", item.quantity, `PO ${poId} received`);
      }
    }
  }

  return true;
}
