/**
 * MICROS Inventory Management API — TypeScript types
 *
 * Covers the SOAP-based POS Web Services response shapes and
 * the local DB row types for stock-on-hand, cost centers, vendors.
 */

// ── SOAP response shapes (parsed from XML) ──────────────────────────────────

export interface MicrosItemRaw {
  Name:       string;
  Number:     number;
  Unit:       string | null;
  ItemGroup:  string | null;
  SalesPrice: number | null;
  Barcodes:   string | null;
  Categories: string | null;
}

export interface MicrosStockOnHandRaw {
  CostCenter: string | null;
  ItemNumber: number;
  Item:       string | null;
  Qty: {
    Amount: number;
    Unit:   string | null;
  };
}

export interface MicrosCostCenterRaw {
  Name:       string;
  Number:     number;
  LocationID: number | null;
}

export interface MicrosVendorRaw {
  Name:                      string;
  Number:                    number;
  Address:                   string | null;
  Email:                     string | null;
  Phone:                     string | null;
  TaxID:                     string | null;
  ExternalInvoiceProcessing: boolean;
}

export interface MicrosOpenOrderRaw {
  OrderNumber: number;
  OrderDate:   string;
  Vendor:      string | null;
  Items:       { ItemNumber: number; Qty: number; Unit: string | null }[];
}

// ── Generic SOAP response wrapper ───────────────────────────────────────────

export interface MicrosSoapResponse<T> {
  Success: boolean;
  ErrorCode: string | null;
  Message: string | null;
  Data: T[];
}

// ── DB row types ────────────────────────────────────────────────────────────

export interface MicrosStockOnHandRow {
  id:                 string;
  site_id:            string;
  connection_id:      string;
  item_number:        number;
  item_name:          string | null;
  cost_center_name:   string | null;
  cost_center_number: number | null;
  qty_amount:         number | null;
  qty_unit:           string | null;
  synced_at:          string;
  business_date:      string;
}

export interface MicrosCostCenterRow {
  id:            string;
  connection_id: string;
  name:          string;
  number:        number;
  location_id:   number | null;
  synced_at:     string;
}

export interface MicrosVendorRow {
  id:                          string;
  connection_id:               string;
  name:                        string;
  number:                      number;
  address:                     string | null;
  email:                       string | null;
  phone:                       string | null;
  tax_id:                      string | null;
  external_invoice_processing: boolean;
  synced_at:                   string;
}

// ── Connection row (inv_* fields only) ──────────────────────────────────────

export interface MicrosInvConnection {
  id:                 string;
  site_id:            string | null;
  inv_app_server_url: string | null;
  inv_username:       string | null;
  inv_password_enc:   string | null;
  inv_pos_sequence:   number | null;
  inv_last_sync_at:   string | null;
  inv_enabled:        boolean;
}

// ── Sync result ─────────────────────────────────────────────────────────────

export interface InventorySyncResult {
  inserted: number;
  updated:  number;
  errors:   string[];
}

export type InventorySyncType = "items" | "stock" | "cost_centers" | "vendors" | "all";
