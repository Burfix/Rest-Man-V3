/**
 * services/micros/MicrosSalesService.ts
 *
 * Fetches and normalizes sales data from Oracle MICROS BI API.
 *
 * Each method:
 *  - Accepts locRef + date (YYYY-MM-DD)
 *  - Calls MicrosApiClient (authenticated, with retry)
 *  - Returns normalized internal types — UI never sees raw Oracle shapes
 *
 * Endpoint paths are configurable via env vars with sane Oracle defaults:
 *   MICROS_PATH_DAILY_TOTALS  (default: /rms/v1/reports/dailyBusinessSummary)
 *   MICROS_PATH_INTERVALS     (default: /rms/v1/reports/salesByInterval)
 *   MICROS_PATH_GUEST_CHECKS  (default: /rms/v1/guestChecks)
 */

import { MicrosApiClient } from "./MicrosApiClient";
import {
  normalizeDailyTotals,
  normalizeInterval,
  normalizeGuestCheck,
  type NormalizedDailyTotals,
  type NormalizedInterval,
  type NormalizedGuestCheck,
} from "./normalize";
import type {
  _OracleDailyTotals,
  _OracleIntervalRecord,
  _OracleGuestCheck,
} from "@/types/micros";

// ── Endpoint paths ────────────────────────────────────────────────────────

function paths() {
  return {
    dailyTotals: process.env.MICROS_PATH_DAILY_TOTALS  ?? "/rms/v1/reports/dailyBusinessSummary",
    intervals:   process.env.MICROS_PATH_INTERVALS     ?? "/rms/v1/reports/salesByInterval",
    guestChecks: process.env.MICROS_PATH_GUEST_CHECKS  ?? "/rms/v1/guestChecks",
  };
}

// ── Service class ─────────────────────────────────────────────────────────

export class MicrosSalesService {

  /**
   * Fetches daily business summary totals for a given store + date.
   * Returns normalized revenue, traffic, and labour KPIs.
   *
   * Maps to internal schema: micros_sales_daily
   */
  async getDailySales(
    locRef: string,
    date:   string,
  ): Promise<{ totals: NormalizedDailyTotals; raw: _OracleDailyTotals }> {
    const raw = await MicrosApiClient.get<_OracleDailyTotals>(
      paths().dailyTotals,
      { businessDate: date },
      locRef,
    );

    return { totals: normalizeDailyTotals(raw), raw };
  }

  /**
   * Fetches quarter-hour (15-min) interval sales for a given store + date.
   * Invalid or null intervals are filtered out.
   *
   * Maps to internal schema: micros_sales_intervals
   */
  async getIntervalSales(
    locRef:        string,
    date:          string,
    intervalMins?: "15" | "30" | "60",
  ): Promise<NormalizedInterval[]> {
    const res = await MicrosApiClient.get<{ intervals?: _OracleIntervalRecord[] }>(
      paths().intervals,
      { businessDate: date, intervalMins: intervalMins ?? "15" },
      locRef,
    );

    return (res.intervals ?? [])
      .map(normalizeInterval)
      .filter((r): r is NormalizedInterval => r !== null);
  }

  /**
   * Fetches all guest checks for a given store + date.
   * Invalid records (missing check number) are filtered out.
   *
   * Maps to internal schema: micros_guest_checks
   */
  async getGuestChecks(
    locRef: string,
    date:   string,
  ): Promise<NormalizedGuestCheck[]> {
    const res = await MicrosApiClient.get<{ checks?: _OracleGuestCheck[] }>(
      paths().guestChecks,
      { businessDate: date },
      locRef,
    );

    return (res.checks ?? [])
      .map(normalizeGuestCheck)
      .filter((r): r is NormalizedGuestCheck => r !== null);
  }
}
