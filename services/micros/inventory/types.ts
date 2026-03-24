/**
 * services/micros/inventory/types.ts
 *
 * Oracle MICROS Inventory Management POS Web Services response types.
 *
 * Based on Oracle MICROS Inventory Management POS Web Services API Guide
 * (E91248_07, Back Office 20.1).
 *
 * Endpoint: GetStockOnHandList
 * Returns: StockOnHandListResult = Result<StockOnHand[]>
 */

// ── Oracle Quantity type ────────────────────────────────────────────────────

/** Oracle Quantity — contains numeric value and unit of measure */
export interface OracleQuantity {
  Value?: number;
  value?: number;
  Unit?: string;
  unit?: string;
}

// ── Oracle CostCenter type ──────────────────────────────────────────────────

/** Oracle CostCenter structure returned inside StockOnHand items */
export interface OracleCostCenter {
  ID?: number;
  id?: number;
  Name?: string;
  name?: string;
}

// ── StockOnHand item from Oracle ────────────────────────────────────────────

/**
 * A single Stock-on-Hand record from Oracle MICROS.
 * Per Table 30 — StockOnHand Parameters (E91248_07).
 */
export interface OracleStockOnHand {
  /** CostCenter structure */
  CostCenter?: OracleCostCenter;
  costCenter?: OracleCostCenter;
  /** Item Number (Int64) */
  ItemNumber?: number;
  itemNumber?: number;
  /** Item Name (String) */
  Item?: string;
  item?: string;
  /** Stock on Hand Quantity & Unit */
  Qty?: OracleQuantity;
  qty?: OracleQuantity;
}

// ── GetStockOnHandList response wrapper ─────────────────────────────────────

/** Standard Oracle Result wrapper */
export interface OracleResult<T> {
  /** Whether the API call succeeded */
  Success?: boolean;
  success?: boolean;
  /** Error message if call failed */
  Message?: string;
  message?: string;
  /** The payload array */
  Data?: T;
  data?: T;
}

/** Top-level response from GetStockOnHandList */
export type StockOnHandListResult = OracleResult<OracleStockOnHand[]>;

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
