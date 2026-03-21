/**
 * services/micros/normalize.ts -- stub: no data normalization active.
 */
import type { MicrosSalesDaily, MicrosLaborDaily } from "@/types/micros";

export interface NormalizedDailyTotals extends MicrosSalesDaily {}
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
export function normalizeLaborDaily(_raw: unknown): MicrosLaborDaily | null {
  return null;
}
