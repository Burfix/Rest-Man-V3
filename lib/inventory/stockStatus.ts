/**
 * Stock-on-hand status utility.
 *
 * Computes status from current stock vs minimum threshold.
 * Structured for future upgrade to predictive inventory
 * (forecasted runout, supplier ordering, recipe-based depletion).
 */

import type { StockOnHandStatus, StockOnHandItem, InventoryItem } from "@/types/inventory";

export function computeStockStatus(
  stockOnHand: number,
  minLevel: number,
): StockOnHandStatus {
  if (stockOnHand <= 0) return "critical";
  if (stockOnHand <= minLevel) return "running_low";
  return "healthy";
}

/** Sort priority: critical=0, running_low=1, healthy=2 */
const STATUS_ORDER: Record<StockOnHandStatus, number> = {
  critical: 0,
  running_low: 1,
  healthy: 2,
};

export function sortByUrgency(items: StockOnHandItem[]): StockOnHandItem[] {
  return [...items].sort((a, b) => {
    const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (d !== 0) return d;
    // Within same status, lower stock ratio first
    const ratioA = a.min_level > 0 ? a.stock_on_hand / a.min_level : Infinity;
    const ratioB = b.min_level > 0 ? b.stock_on_hand / b.min_level : Infinity;
    return ratioA - ratioB;
  });
}

export function toStockOnHandItem(item: InventoryItem): StockOnHandItem {
  return {
    id: item.id,
    item_name: item.name,
    stock_on_hand: item.current_stock,
    unit: item.unit,
    min_level: item.minimum_threshold,
    par_level: item.par_level ?? item.minimum_threshold * 2,
    status: computeStockStatus(item.current_stock, item.minimum_threshold),
    last_updated: item.updated_at,
    category: item.category,
  };
}
