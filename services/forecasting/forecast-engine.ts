/**
 * Forecasting Engine — Multi-Site Revenue Projection
 *
 * Supports siteId-based routing to per-site historical datasets.
 * Si Cantina Sociale: 20-month monthly aggregates, seasonality-driven projection.
 *
 * Methodology:
 *   - SDLY daily avg = same calendar month last year total ÷ days in that month
 *   - Projection blends live run-rate with SDLY, weighted by service progress
 *   - Seasonality index adjusts the monthly baseline expectation
 *   - No blanket YoY growth multiplier — month-specific indices only
 *
 * No AI API. Pure deterministic functions.
 */

import {
  SI_CANTINA_BY_MONTH,
  SI_CANTINA_SEASONALITY,
  type MonthlyRevenue,
} from "./si-cantina-historical";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ForecastResult = {
  /** Estimated end-of-day revenue (ZAR) */
  projectedClose: number;
  /** Same-calendar-month last year daily average (ZAR), null if no prior data */
  sdlyDailyAvg: number | null;
  /**
   * % vs SDLY: compares today's projected full-day revenue against SDLY daily avg.
   * Positive = tracking ahead of last year. Null if no SDLY data or no revenue yet.
   */
  vsSameDayLastYear: number | null;
  /**
   * % vs daily revenue target.
   * Positive = ahead of target. 0 if no target provided.
   */
  vsTarget: number;
  /** Seasonality multiplier for this calendar month */
  seasonalityIndex: number;
  /** How reliable this projection is */
  confidence: "high" | "medium" | "low";
  /**
   * Warning message when this month's historical data has known anomalies.
   * Callers should surface this to the user.
   */
  anomalyWarning: string | null;
};

// ── Site routing ──────────────────────────────────────────────────────────────

type SiteKey = "si-cantina";

/**
 * Map a siteId (UUID or slug) to an internal site key.
 *
 * On the si-cantina branch only Si Cantina data is loaded. Camps Bay would
 * require importing its own historical dataset (available on the main branch).
 */
function resolveSiteKey(siteId: string): SiteKey {
  // Explicit slug match
  if (siteId === "si-cantina" || siteId.includes("si-cantina")) return "si-cantina";
  // Camps Bay slug detected but data not loaded on this branch — fall back to Si Cantina
  // (add: import SI_CAMPS_BAY_... and return "camps-bay" here when needed)
  return "si-cantina";
}

function getMonthEntry(month: string, siteKey: SiteKey): MonthlyRevenue | undefined {
  if (siteKey === "si-cantina") return SI_CANTINA_BY_MONTH.get(month);
  return undefined;
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the daily average for the same calendar month one year prior.
 * Uses monthly total ÷ days-in-month as the per-day proxy.
 */
export function sameDayLastYear(
  date: string,          // ISO "YYYY-MM-DD"
  siteId = "si-cantina",
): { dailyAvg: number; anomaly: string | null } | null {
  const siteKey   = resolveSiteKey(siteId);
  const parts     = date.split("-");
  const year      = parseInt(parts[0], 10);
  const monthPad  = parts[1];                 // "MM" (zero-padded)
  const priorKey  = `${year - 1}-${monthPad}`;

  const entry = getMonthEntry(priorKey, siteKey);
  if (!entry) return null;

  return {
    dailyAvg: entry.total / entry.daysInMonth,
    anomaly:  entry.anomaly ?? null,
  };
}

/**
 * Seasonality index for the given calendar month (1-indexed).
 * Returns 1.0 for unknown sites or months.
 */
export function monthlySeasonalityIndex(
  month: number,         // 1–12
  siteId = "si-cantina",
): number {
  const siteKey = resolveSiteKey(siteId);
  if (siteKey === "si-cantina") {
    return SI_CANTINA_SEASONALITY[month] ?? 1.0;
  }
  return 1.0;
}

// ── Main forecast function ────────────────────────────────────────────────────

/**
 * Project today's end-of-day revenue from current actuals + historical patterns.
 *
 * Projection logic:
 *   - If service is over (hoursRemaining ≤ 0): actual is final.
 *   - Early in day (< 2 hrs elapsed): SDLY-heavy (70%) + run-rate (30%)
 *   - Mid service (2–12 hrs): blend shifts toward run-rate
 *   - Late service (> 12 hrs): run-rate dominant (85%)
 *   - If no SDLY available: run-rate only, confidence = 'low'
 *   - If no revenue yet: SDLY daily avg as baseline, confidence = 'low'
 *
 * vsSameDayLastYear compares today's projected full-day revenue vs SDLY daily avg.
 *
 * @param date            ISO "YYYY-MM-DD"
 * @param currentRevenue  Revenue recorded so far today (ZAR)
 * @param hoursRemaining  Hours left in service window (0 = service closed)
 * @param revenueTarget   Optional daily revenue target (ZAR)
 * @param siteId          Site identifier — UUID or org slug (e.g. "si-cantina")
 */
export function forecastToday(
  date: string,
  currentRevenue: number,
  hoursRemaining: number,
  revenueTarget?: number,
  siteId = "si-cantina",
): ForecastResult {
  const SERVICE_END_HOUR = 22;            // 10pm — total revenue hours in the day
  const hoursElapsed     = Math.max(0, SERVICE_END_HOUR - hoursRemaining);
  const calMonth         = parseInt(date.split("-")[1], 10);  // 1–12

  const seasIdx   = monthlySeasonalityIndex(calMonth, siteId);
  const sdlyData  = sameDayLastYear(date, siteId);
  const sdlyDaily = sdlyData?.dailyAvg ?? null;   // full-day avg for same month last year

  // ── Projected close ──────────────────────────────────────────────────────

  let projectedClose: number;
  let confidence: ForecastResult["confidence"] = "medium";

  if (hoursRemaining <= 0) {
    // Service is closed — actual revenue is the final answer
    projectedClose = currentRevenue;
    confidence     = "high";

  } else if (hoursElapsed > 0) {
    // We have revenue data: compute run-rate projection
    const runRateProjection = (currentRevenue / hoursElapsed) * SERVICE_END_HOUR;

    if (sdlyDaily !== null) {
      // Blend: shift weight from SDLY toward run-rate as session progresses
      const progress   = hoursElapsed / SERVICE_END_HOUR;        // 0.0 → 1.0
      const runWeight  = Math.min(0.85, progress * 1.4);         // 0 → ~0.85
      const sdlyWeight = 1 - runWeight;

      projectedClose = runRateProjection * runWeight + (sdlyDaily * SERVICE_END_HOUR) * sdlyWeight;
      confidence     = progress > 0.5 ? "high" : "medium";
    } else {
      projectedClose = runRateProjection;
      confidence     = "low";
    }

  } else {
    // No revenue data yet — use SDLY daily average as baseline
    if (sdlyDaily !== null) {
      projectedClose = sdlyDaily * SERVICE_END_HOUR;
      confidence     = "low";
    } else {
      projectedClose = 0;
      confidence     = "low";
    }
  }

  // ── vs Target ────────────────────────────────────────────────────────────

  const vsTarget =
    revenueTarget && revenueTarget > 0
      ? +((currentRevenue - revenueTarget) / revenueTarget * 100).toFixed(1)
      : 0;

  // ── vs SDLY ──────────────────────────────────────────────────────────────
  // Compare today's projected full-day revenue against SDLY daily average.

  let vsSameDayLastYear: number | null = null;

  if (sdlyDaily !== null && sdlyDaily > 0) {
    if (hoursRemaining <= 0) {
      // Final actuals vs SDLY
      vsSameDayLastYear = +((currentRevenue - sdlyDaily) / sdlyDaily * 100).toFixed(1);
    } else if (hoursElapsed > 0) {
      // Projected full-day vs SDLY
      vsSameDayLastYear = +((projectedClose - sdlyDaily) / sdlyDaily * 100).toFixed(1);
    }
    // If hoursElapsed === 0 (no revenue yet), leave null — comparison meaningless
  }

  // ── Anomaly handling ─────────────────────────────────────────────────────

  const anomalyWarning = sdlyData?.anomaly ?? null;
  if (anomalyWarning) confidence = "low";

  return {
    projectedClose:    Math.round(projectedClose),
    sdlyDailyAvg:      sdlyDaily !== null ? Math.round(sdlyDaily) : null,
    vsSameDayLastYear,
    vsTarget,
    seasonalityIndex:  seasIdx,
    confidence,
    anomalyWarning,
  };
}
