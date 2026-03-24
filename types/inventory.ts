/**
 * Inventory & Food Cost types
 */

// ── DB rows ─────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id:                string;
  store_id:          string;
  name:              string;
  category:          string;
  unit:              string;
  current_stock:     number;
  minimum_threshold: number;
  par_level:         number;
  avg_daily_usage:   number;
  supplier_name:     string | null;
  typical_order_qty: number | null;
  last_order_date:   string | null;
  lead_time_days:    number;
  target_days_cover: number;
  unit_cost:         number | null;
  created_at:        string;
  updated_at:        string;
}

export type StockMovementType = "usage" | "order" | "delivery" | "adjustment" | "waste";

export interface StockMovement {
  id:                string;
  inventory_item_id: string;
  store_id:          string;
  type:              StockMovementType;
  quantity:          number;
  note:              string | null;
  created_by:        string | null;
  created_at:        string;
}

export type PurchaseOrderStatus = "draft" | "ordered" | "received" | "cancelled";

export interface PurchaseOrder {
  id:                   string;
  store_id:             string;
  supplier_name:        string;
  status:               PurchaseOrderStatus;
  ordered_at:           string | null;
  expected_delivery_at: string | null;
  received_at:          string | null;
  created_by:           string | null;
  notes:                string | null;
  created_at:           string;
  items?:               PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id:                string;
  purchase_order_id: string;
  inventory_item_id: string;
  quantity:          number;
  unit_cost:         number | null;
  total_cost:        number | null;
}

export interface FoodCostSnapshot {
  id:                      string;
  store_id:                string;
  date:                    string;
  sales_total:             number | null;
  purchases_total:         number | null;
  estimated_food_cost_pct: number | null;
  target_food_cost_pct:    number;
  variance_pct:            number | null;
  created_at:              string;
}

// ── Derived / computed types ────────────────────────────────────────────────

export type StockRiskLevel = "healthy" | "warning" | "critical";

export interface InventoryItemWithRisk extends InventoryItem {
  days_remaining:    number | null;
  risk_level:        StockRiskLevel;
  suggested_order:   number | null;
  needs_order_today: boolean;
}

export interface StockRiskSummary {
  total_items:     number;
  healthy:         number;
  warning:         number;
  critical:        number;
  top_risks:       InventoryItemWithRisk[];
  needs_order:     InventoryItemWithRisk[];
}

export interface FoodCostSummary {
  current_pct:    number | null;
  target_pct:     number | null;
  variance_pct:   number | null;
  status:         "on_target" | "above_target" | "high" | "no_data";
  trend_7d:       { date: string; pct: number }[];
  stock_risk:     StockRiskSummary;
}

// ── Stock-on-Hand status (GM dashboard view) ────────────────────────────────

export type StockOnHandStatus = "critical" | "running_low" | "healthy";

export interface StockOnHandItem {
  id:            string;
  item_name:     string;
  stock_on_hand: number;
  unit:          string;
  min_level:     number;
  par_level:     number;
  status:        StockOnHandStatus;
  last_updated:  string;
  category:      string;
}
