/**
 * services/micros/normalize.ts
 *
 * Converts raw Oracle MICROS API response shapes into the internal
 * normalized data model.
 *
 * Oracle field names are never passed to UI components.
 * All numeric coercion happens here.
 */

import type {
  _OracleDailyTotals,
  _OracleIntervalRecord,
  _OracleGuestCheck,
  _OracleLaborRecord,
  MicrosSalesDaily,
  MicrosLaborDaily,
} from "@/types/micros";

// ── Numeric coercion ──────────────────────────────────────────────────────

function n(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const parsed = typeof v === "string" ? parseFloat(v) : v;
  return isFinite(parsed) ? parsed : 0;
}

function toTime(v: string | null | undefined): string {
  if (!v) return "00:00";
  // Accept HH:MM or HH:MM:SS
  return v.slice(0, 5);
}

// ── Daily totals ──────────────────────────────────────────────────────────

export interface NormalizedDailyTotals
  extends Omit<MicrosSalesDaily, "id" | "connection_id" | "synced_at" | "loc_ref" | "business_date"> {}

export function normalizeDailyTotals(raw: _OracleDailyTotals): NormalizedDailyTotals {
  const checkCount    = Math.round(n(raw.checkCount));
  const guestCount    = Math.round(n(raw.guestCount));
  const netSales      = n(raw.netSales);
  const laborCost     = n(raw.laborCost);

  return {
    net_sales:       netSales,
    gross_sales:     n(raw.grossSales),
    tax_collected:   n(raw.taxTotal),
    service_charges: n(raw.serviceCharges),
    discounts:       n(raw.discountTotal),
    voids:           n(raw.voidTotal),
    returns:         n(raw.returnTotal),
    check_count:     checkCount,
    guest_count:     guestCount,
    avg_check_value: raw.averageCheck != null ? n(raw.averageCheck) : (checkCount > 0 ? netSales / checkCount : 0),
    avg_guest_spend: raw.averageGuest != null ? n(raw.averageGuest) : (guestCount > 0 ? netSales / guestCount : 0),
    labor_cost:      laborCost,
    labor_pct:       raw.laborPercent != null ? n(raw.laborPercent) : (netSales > 0 ? (laborCost / netSales) * 100 : 0),
  };
}

// ── Sales intervals ───────────────────────────────────────────────────────

export interface NormalizedInterval {
  interval_start: string;   // "HH:MM"
  interval_end:   string;
  net_sales:      number;
  check_count:    number;
  guest_count:    number;
}

export function normalizeInterval(raw: _OracleIntervalRecord): NormalizedInterval | null {
  if (!raw.intervalStart) return null;
  return {
    interval_start: toTime(raw.intervalStart),
    interval_end:   toTime(raw.intervalEnd),
    net_sales:      n(raw.netSales),
    check_count:    Math.round(n(raw.checkCount)),
    guest_count:    Math.round(n(raw.guestCount)),
  };
}

// ── Guest checks ──────────────────────────────────────────────────────────

export interface NormalizedGuestCheck {
  check_number:   string;
  opened_at:      string | null;
  closed_at:      string | null;
  table_number:   string | null;
  server_name:    string | null;
  guest_count:    number;
  net_total:      number;
  gross_total:    number;
  discounts:      number;
  gratuity:       number;
  payment_method: string | null;
  status:         string;
}

export function normalizeGuestCheck(raw: _OracleGuestCheck): NormalizedGuestCheck | null {
  if (!raw.checkNumber) return null;
  return {
    check_number:   raw.checkNumber,
    opened_at:      raw.openedAt ?? null,
    closed_at:      raw.closedAt ?? null,
    table_number:   raw.tableNumber ?? null,
    server_name:    raw.serverName ?? null,
    guest_count:    Math.max(1, Math.round(n(raw.guestCount))),
    net_total:      n(raw.netTotal),
    gross_total:    n(raw.grossTotal),
    discounts:      n(raw.discountTotal),
    gratuity:       n(raw.gratuity),
    payment_method: raw.paymentMethod ?? null,
    status:         raw.status ?? "closed",
  };
}

// ── Labour records ────────────────────────────────────────────────────────

export interface NormalizedLaborRecord
  extends Omit<MicrosLaborDaily, "id" | "connection_id" | "synced_at" | "loc_ref" | "business_date"> {}

export function normalizeLaborRecord(raw: _OracleLaborRecord): NormalizedLaborRecord {
  const regularHours  = n(raw.regularHours);
  const overtimeHours = n(raw.overtimeHours);
  return {
    job_code:       raw.jobCode ?? "",
    job_name:       raw.jobName ?? null,
    employee_count: Math.round(n(raw.employeeCount)),
    regular_hours:  regularHours,
    overtime_hours: overtimeHours,
    total_hours:    raw.totalHours != null ? n(raw.totalHours) : regularHours + overtimeHours,
    labor_cost:     n(raw.laborCost),
  };
}
