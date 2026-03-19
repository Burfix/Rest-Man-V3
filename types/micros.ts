/**
 * Oracle MICROS BI Integration — type definitions.
 *
 * Public-facing types (MicrosConnection, MicrosSalesDaily, etc.) describe
 * the normalized internal data model. Oracle raw response shapes are prefixed
 * with `_Oracle` and kept server-side only — never bound to UI components.
 */

// ── Connection & sync status ──────────────────────────────────────────────

export type MicrosConnectionStatus =
  | "awaiting_setup"
  | "connected"
  | "syncing"
  | "stale"
  | "error";

export type MicrosSyncType =
  | "daily_totals"
  | "intervals"
  | "guest_checks"
  | "labor"
  | "full";

export type MicrosSyncStatus = "running" | "success" | "error" | "partial";

// ── Connection config (safe to show in settings UI) ───────────────────────

/** Fields that can be sent to / received from the settings API */
export interface MicrosConnectionConfig {
  location_name: string;
  loc_ref:        string;
  auth_server_url: string;
  app_server_url:  string;
  client_id:       string;
  org_identifier:  string;
}

/** Full DB row — access_token / token_expires_at excluded from all API responses */
export interface MicrosConnection extends MicrosConnectionConfig {
  id:                      string;
  status:                  MicrosConnectionStatus;
  last_sync_at:            string | null;
  last_sync_error:         string | null;
  last_successful_sync_at: string | null;
  created_at:              string;
  updated_at:              string;
}

// ── Sync runs ─────────────────────────────────────────────────────────────

export interface MicrosSyncRun {
  id:               string;
  connection_id:    string;
  sync_type:        MicrosSyncType;
  started_at:       string;
  completed_at:     string | null;
  status:           MicrosSyncStatus;
  records_fetched:  number;
  records_inserted: number;
  error_message:    string | null;
}

// ── Normalized data tables ────────────────────────────────────────────────

export interface MicrosSalesDaily {
  id:             string;
  connection_id:  string;
  loc_ref:        string;
  business_date:  string;   // YYYY-MM-DD
  net_sales:      number;
  gross_sales:    number;
  tax_collected:  number;
  service_charges: number;
  discounts:      number;
  voids:          number;
  returns:        number;
  check_count:    number;
  guest_count:    number;
  avg_check_value: number;
  avg_guest_spend: number;
  labor_cost:     number;
  labor_pct:      number;
  synced_at:      string;
}

export interface MicrosLaborDaily {
  id:             string;
  connection_id:  string;
  loc_ref:        string;
  business_date:  string;
  job_code:       string;
  job_name:       string | null;
  employee_count: number;
  regular_hours:  number;
  overtime_hours: number;
  total_hours:    number;
  labor_cost:     number;
  synced_at:      string;
}

// ── Status summary (returned by GET /api/micros/status) ───────────────────

export interface MicrosStatusSummary {
  connection:        MicrosConnection | null;
  isConfigured:      boolean;
  lastRun:           MicrosSyncRun | null;
  latestDailySales:  MicrosSalesDaily | null;
  minutesSinceSync:  number | null;
}

// ── Internal Oracle API response shapes ───────────────────────────────────
// These are NEVER bound to UI. Normalization happens in services/micros/normalize.ts

/** @internal Raw OAuth token response from Oracle OIDC provider */
export interface _OracleTokenResponse {
  access_token:  string;
  token_type:    string;
  expires_in:    number;
  refresh_token?: string;
  id_token?:     string;
  scope?:        string;
}

/** @internal Oracle MICROS BI daily business summary */
export interface _OracleDailyTotals {
  locRef?:         string;
  businessDate?:   string;
  netSales?:       number | string;
  grossSales?:     number | string;
  taxTotal?:       number | string;
  serviceCharges?: number | string;
  discountTotal?:  number | string;
  voidTotal?:      number | string;
  returnTotal?:    number | string;
  checkCount?:     number | string;
  guestCount?:     number | string;
  averageCheck?:   number | string;
  averageGuest?:   number | string;
  laborCost?:      number | string;
  laborPercent?:   number | string;
}

/** @internal Oracle MICROS BI interval sales record */
export interface _OracleIntervalRecord {
  intervalStart?: string;  // "HH:MM"
  intervalEnd?:   string;
  netSales?:      number | string;
  checkCount?:    number | string;
  guestCount?:    number | string;
}

/** @internal Oracle guest check */
export interface _OracleGuestCheck {
  checkNumber?:   string;
  openedAt?:      string;   // ISO
  closedAt?:      string;
  tableNumber?:   string;
  serverName?:    string;
  guestCount?:    number | string;
  netTotal?:      number | string;
  grossTotal?:    number | string;
  discountTotal?: number | string;
  gratuity?:      number | string;
  paymentMethod?: string;
  status?:        string;
}

/** @internal Oracle labor timecard record */
export interface _OracleLaborRecord {
  jobCode?:       string;
  jobName?:       string;
  employeeCount?: number | string;
  regularHours?:  number | string;
  overtimeHours?: number | string;
  totalHours?:    number | string;
  laborCost?:     number | string;
}
