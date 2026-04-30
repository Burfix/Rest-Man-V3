/**
 * lib/sales/types.ts — Unified sales data types
 *
 * Single source of truth for all revenue/sales data flowing through
 * the dashboard. Every revenue-dependent widget reads from
 * NormalizedSalesSnapshot.
 */

// ── Source classification ───────────────────────────────────────────────────

export type SalesDataSource = "micros" | "manual" | "forecast";

export type SalesFreshnessState = "live" | "stale" | "offline";

// ── Core snapshot ───────────────────────────────────────────────────────────

export interface NormalizedSalesSnapshot {
  /** Where the sales data came from */
  source: SalesDataSource;
  /** Human-readable label, e.g. "MICROS LIVE", "Manual Upload", "Forecast" */
  sourceLabel: string;
  /** True when source is MICROS and data is ≤20 min old */
  isLive: boolean;
  /** True when MICROS is configured but data is >20 min old */
  isStale: boolean;
  /** Current freshness state */
  freshnessState: SalesFreshnessState;
  /** Minutes since last data update, null if unknown */
  freshnessMinutes: number | null;
  /** ISO timestamp of last update */
  lastUpdatedAt: string | null;

  /** YYYY-MM-DD */
  businessDate: string;

  // ── Sales metrics ────────────────────────────────────────────────────────

  /** Net sales (excl. VAT) — primary metric */
  netSales: number;
  /** Gross sales (incl. VAT) */
  grossSales: number;
  /** Guest/cover count */
  covers: number;
  /** Number of checks/bills */
  checks: number;
  /** Net sales / covers */
  averageSpendPerCover: number;
  /** Net sales / checks */
  averageCheckValue: number;

  // ── Labour (from daily ops or POS, if available) ─────────────────────────

  labourCostPercent: number | null;
  labourCostAmount: number | null;

  // ── Target analysis ──────────────────────────────────────────────────────

  /** Today's sales target */
  targetSales: number | null;
  /** Same calendar day last year */
  sameDayLastYearSales: number | null;
  /** How the target was derived */
  targetSource: "manual" | "auto" | null;
  /** Actual or forecast minus target (negative = behind) */
  targetVarianceAmount: number | null;
  /** Variance as % of target */
  targetVariancePercent: number | null;
  /** Forecast progress as % of target */
  forecastProgressPercent: number | null;
  /** Revenue shortfall requiring walk-in recovery */
  walkInRecoveryNeeded: number | null;
  /** Extra covers needed at current avg spend to hit target */
  additionalCoversNeeded: number | null;

  // ── Bookings context ─────────────────────────────────────────────────────

  bookingsToday: number | null;
  bookedCoversToday: number | null;

  // ── Informational ────────────────────────────────────────────────────────

  /** Optional notes (e.g. "Event: Quiz Night", "Forecast confidence: low") */
  notes: string[];

  // ── Module-level data state ───────────────────────────────────────────────

  /**
   * High-level data state for UI badges:
   *   "live"      — POS connected, data flowing (MICROS)
   *   "estimated" — Fallback active: manual upload or revenue forecast
   *   "none"      — No data at all; UI must hide revenue numbers
   */
  data_source: "live" | "estimated" | "none";
}

// ── Revenue score (pure, from snapshot) ─────────────────────────────────────

export interface RevenueScoreResult {
  /** Score out of 40 */
  score: number;
  max: 40;
  /** Gap as % of target (positive = below target) */
  gapPercent: number | null;
  detail: string;
}
