/**
 * services/micros/normalize.ts
 *
 * Transforms raw Oracle BIAPI getGuestChecks responses into the
 * normalized shapes stored in Supabase (micros_sales_daily, etc.).
 */
import type { MicrosSalesDaily } from "@/types/micros";

// ── Oracle raw shapes (from getGuestChecks response) ────────────────────

interface OracleGuestCheck {
  guestCheckId: number;
  chkNum: number;
  chkName?: string;
  opnBusDt: string;
  opnLcl?: string;
  clsdBusDt?: string;
  clsdLcl?: string;
  clsdFlag: boolean;
  gstCnt: number;
  subTtl: number | null;
  chkTtl: number | null;
  dscTtl: number | null;
  payTtl: number | null;
  taxes?: { taxCollTtl: number }[];
  detailLines?: {
    dspTtl: number | null;
    dspQty: number | null;
    menuItem?: { miNum: number; modFlag: boolean };
  }[];
}

interface OracleGuestChecksResponse {
  curUTC: string;
  locRef: string;
  guestChecks: OracleGuestCheck[] | null;
}

// ── Public types ────────────────────────────────────────────────────────

export interface NormalizedDailyTotals {
  business_date: string;
  loc_ref: string;
  net_sales: number;
  gross_sales: number;
  tax_collected: number;
  service_charges: number;
  discounts: number;
  voids: number;
  returns: number;
  check_count: number;
  guest_count: number;
  avg_check_value: number;
  avg_guest_spend: number;
  labor_cost: number;
  labor_pct: number;
}

export interface NormalizedInterval {
  hour: number;
  netSalesAmount: number;
  checkCount: number;
  guestCount: number;
}

export interface NormalizedGuestCheck {
  checkNumber: string;
  openTime: string;
  closeTime: string | null;
  netAmount: number;
  guestCount: number;
  serverId: string | null;
}

export interface NormalizedLaborRecord {
  employeeId: string;
  jobCode: string;
  clockIn: string;
  clockOut: string | null;
  regularHours: number;
  overtimeHours: number;
}

// ── Aggregator: getGuestChecks → daily totals ───────────────────────────

/**
 * Aggregates an Oracle getGuestChecks response into a single daily summary.
 * This is the primary data path since only getGuestChecks is enabled
 * for this API account.
 */
export function aggregateGuestChecksToDailySales(
  raw: OracleGuestChecksResponse,
  businessDate: string,
): NormalizedDailyTotals | null {
  const checks = raw.guestChecks;
  if (!checks || checks.length === 0) {
    return {
      business_date: businessDate,
      loc_ref: raw.locRef ?? "",
      net_sales: 0,
      gross_sales: 0,
      tax_collected: 0,
      service_charges: 0,
      discounts: 0,
      voids: 0,
      returns: 0,
      check_count: 0,
      guest_count: 0,
      avg_check_value: 0,
      avg_guest_spend: 0,
      labor_cost: 0,
      labor_pct: 0,
    };
  }

  let netSales = 0;
  let taxCollected = 0;
  let discounts = 0;
  let guestCount = 0;
  let checkCount = 0;

  for (const chk of checks) {
    netSales += chk.subTtl ?? 0;
    taxCollected += (chk.taxes ?? []).reduce((s, t) => s + (t.taxCollTtl ?? 0), 0);
    discounts += Math.abs(chk.dscTtl ?? 0);
    guestCount += chk.gstCnt ?? 0;
    checkCount++;
  }

  const grossSales = netSales + taxCollected;
  const avgCheck = checkCount > 0 ? netSales / checkCount : 0;
  const avgGuest = guestCount > 0 ? netSales / guestCount : 0;

  return {
    business_date: businessDate,
    loc_ref: raw.locRef ?? "",
    net_sales: round2(netSales),
    gross_sales: round2(grossSales),
    tax_collected: round2(taxCollected),
    service_charges: 0,
    discounts: round2(discounts),
    voids: 0,
    returns: 0,
    check_count: checkCount,
    guest_count: guestCount,
    avg_check_value: round2(avgCheck),
    avg_guest_spend: round2(avgGuest),
    labor_cost: 0,
    labor_pct: 0,
  };
}

/**
 * Build hourly sales intervals from guest check open times.
 */
export function aggregateGuestChecksToIntervals(
  raw: OracleGuestChecksResponse,
): NormalizedInterval[] {
  const checks = raw.guestChecks;
  if (!checks || checks.length === 0) return [];

  const hourMap = new Map<number, { sales: number; checks: number; guests: number }>();

  for (const chk of checks) {
    // Use local close time or open time to assign to hour bucket
    const timeStr = chk.clsdLcl ?? chk.opnLcl;
    if (!timeStr) continue;
    const hour = new Date(timeStr).getHours();
    const entry = hourMap.get(hour) ?? { sales: 0, checks: 0, guests: 0 };
    entry.sales += chk.subTtl ?? 0;
    entry.checks += 1;
    entry.guests += chk.gstCnt ?? 0;
    hourMap.set(hour, entry);
  }

  return Array.from(hourMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({
      hour,
      netSalesAmount: round2(v.sales),
      checkCount: v.checks,
      guestCount: v.guests,
    }));
}

// ── Stubs for endpoints not yet available ───────────────────────────────

export function normalizeDailyTotals(_raw: unknown): NormalizedDailyTotals | null {
  return null;
}

export function normalizeInterval(_raw: unknown): NormalizedInterval | null {
  return null;
}

export function normalizeGuestCheck(_raw: unknown): NormalizedGuestCheck | null {
  return null;
}

export function normalizeLaborRecord(_raw: unknown): NormalizedLaborRecord | null {
  return null;
}

export function normalizeSalesDaily(_raw: unknown): MicrosSalesDaily | null {
  return null;
}

export function normalizeLaborDaily(_raw: unknown): null {
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
