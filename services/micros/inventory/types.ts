/**
 * services/micros/inventory/types.ts
 *
 * Oracle MICROS Inventory Management POS Web Services response types.
 *
 * Based on Oracle MICROS Inventory Management POS Web Services API Guide
 * (E91248_07, Back Office 20.1).
 *
 * The BI API endpoint `getMenuItemInventoryCount` returns current inventory
 * counts for menu items at a given location.
 */

// ── Oracle response shapes ──────────────────────────────────────────────────

/** Raw menu-item inventory count object from Oracle */
export interface OracleMenuItemInventoryCount {
  /** Oracle menu item number (unique within the location) */
  miNum: number;
  /** Menu item name as configured in Oracle */
  miName: string;
  /** Current stock/inventory count (can be fractional for weight-based items) */
  currentCount: number;
  /** Minimum count threshold (triggers low-stock warning in Oracle) */
  minimumCount?: number;
  /** Par level — target restock level */
  parCount?: number;
  /** Unit of measure (e.g. "kg", "ea", "ltr", "cs") */
  unitOfMeasure?: string;
  /** ISO UTC timestamp of the last physical count */
  lastCountDtUTC?: string;
  /** Menu item class/category name in Oracle */
  menuItemClassName?: string;
  /** Menu item major group number */
  majorGroupNum?: number;
  /** Menu item major group name */
  majorGroupName?: string;
  /** Oracle-assigned item definition number */
  miDefNum?: number;
}

/** Top-level response from POST getMenuItemInventoryCount */
export interface OracleInventoryCountResponse {
  /** Server timestamp (ISO UTC) */
  curUTC: string;
  /** Location reference echoed back */
  locRef: string;
  /** Array of inventory count records; null if location has no items */
  menuItemInventoryCounts: OracleMenuItemInventoryCount[] | null;
}

// ── Sync result ─────────────────────────────────────────────────────────────

export interface InventorySyncResult {
  success: boolean;
  message: string;
  businessDate?: string;
  itemsSynced?: number;
  itemsCreated?: number;
  itemsUpdated?: number;
  errors?: string[];
}
