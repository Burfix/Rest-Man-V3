/**
 * Forecasting Engine — Multi-Site Revenue Projection
 *
 * Supports siteId-based routing to per-site historical datasets.
 * Si Cantina Sociale: 20-month monthly aggregates, seasonality + event uplift.
 *
 * Methodology (applied in order):
 *   1. Event uplift check (evaluated first — drives September SDLY decision)
 *   2. SDLY lookup with September anomaly fallback (Aug/Oct avg if no event)
 *   3. Run-rate × SDLY blend, weighted by service progress
 *   4. Apply event uplift multiplier to projection
 *   5. Apply Ramadan suppression (only when no active event)
 *
 * No AI API. Pure deterministic functions. All async concerns handled by callers.
 */

import {
  SI_CANTINA_BY_MONTH,
  SI_CANTINA_SEASONALITY,
  type MonthlyRevenue,
} from "./si-cantina-historical";
import {
  eventUpliftFactor,
  type EventCategory,
  type SportsEvent,
} from "./events-calendar";

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
   * % vs daily revenue target — compares PROJECTED CLOSE to target, not current revenue.
   * Positive = ahead of target. 0 if no target provided.
   */
  vsTarget: number;
  /** Seasonality multiplier for this calendar month */
  seasonalityIndex: number;
  /** How reliable this projection is */
  confidence: "high" | "medium" | "low";
  /**
   * Warning when this period's historical data is anomalous.
   * Includes September adjustment notice when Aug/Oct fallback is applied.
   */
  anomalyWarning: string | null;
  /** True when today falls within a known Ramadan window */
  isRamadan: boolean;
  /** Set during Ramadan — null otherwise */
  ramadanWarning: string | null;
  /** Name of any confirmed sports/event uplifting today's forecast. Null if none. */
  activeEvent: string | null;
  /** Uplift multiplier applied (e.g. 1.40). Null if no event. */
  eventUplift: number | null;
  /** True when no trading minutes have elapsed yet — showing SDLY baseline, not a live projection */
  isPreService: boolean;
};

// ── Site routing ──────────────────────────────────────────────────────────────

type SiteKey = "si-cantina";

function resolveSiteKey(siteId: string): SiteKey {
  if (siteId === "si-cantina" || siteId.includes("si-cantina")) return "si-cantina";
  // Camps Bay: add import + return "camps-bay" when that dataset is loaded
  return "si-cantina";
}

function getMonthEntry(month: string, siteKey: SiteKey): MonthlyRevenue | undefined {
  if (siteKey === "si-cantina") return SI_CANTINA_BY_MONTH.get(month);
  return undefined;
}

// ── Ramadan calendar ──────────────────────────────────────────────────────────

type RamadanWindow = { start: string; end: string };

/**
 * Approximate Ramadan windows. Dates shift ~11 days earlier each year.
 * March 2026 underperformance (-21.6% YoY) is explained by the 2026 window.
 * Suppression: 0.70 multiplier applied to projection (lunch impact).
 * NOT applied when an active sports event overrides (event uplift dominates).
 */
const RAMADAN_CALENDAR: RamadanWindow[] = [
  { start: "2026-02-18", end: "2026-03-19" },
  { start: "2027-02-07", end: "2027-03-08" },
  { start: "2028-01-27", end: "2028-02-25" },
];

const RAMADAN_WARNING =
  "Ramadan period — expect 25-30% suppressed lunch covers. Dinner service may partially recover.";

function isRamadanPeriod(date: string): boolean {
  return RAMADAN_CALENDAR.some((w) => date >= w.start && date <= w.end);
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the daily average for the same calendar month one year prior.
 * Uses monthly total ÷ days-in-month as the per-day proxy.
 */
export function sameDayLastYear(
  date: string,
  siteId = "si-cantina",
): { dailyAvg: number; anomaly: string | null } | null {
  const siteKey  = resolveSiteKey(siteId);
  const parts    = date.split("-");
  const year     = parseInt(parts[0], 10);
  const monthPad = parts[1];
  const priorKey = `${year - 1}-${monthPad}`;

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
  month: number,
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
 * Processing order:
 *   1. Evaluate event uplift (needed before September SDLY decision)
 *   2. SDLY lookup — apply Aug/Oct fallback for anomalous September if no event
 *   3. Blend run-rate (from opening time) with SDLY daily average
 *   4. Apply event uplift multiplier
 *   5. Apply Ramadan suppression (only when no active event)
 *
 * @param date             ISO "YYYY-MM-DD"
 * @param currentRevenue   Revenue recorded so far today (ZAR)
 * @param minutesElapsed   Minutes since restaurant opened (0 if pre-service)
 * @param minutesRemaining Minutes until restaurant closes (0 if closed)
 * @param revenueTarget    Optional daily revenue target (ZAR)
 * @param siteId           Site identifier — UUID or org slug (e.g. "si-cantina")
 * @param dbEvents         Events from site_events DB table, loaded by the caller
 */
export function forecastToday(
  date: string,
  currentRevenue: number,
  minutesElapsed: number,
  minutesRemaining: number,
  revenueTarget?: number,
  siteId = "si-cantina",
  dbEvents: SportsEvent[] = [],
): ForecastResult {
  const calMonth = parseInt(date.split("-")[1], 10);  // 1–12
  const siteKey  = resolveSiteKey(siteId);
  const seasIdx  = monthlySeasonalityIndex(calMonth, siteId);

  // ── 1. Event uplift (evaluated first) ──────────────────────────────────────
  const eventData = eventUpliftFactor(date, siteId, dbEvents);

  // ── 2. SDLY with September anomaly fallback ────────────────────────────────
  const rawSdly   = sameDayLastYear(date, siteId);
  let sdlyDaily   = rawSdly?.dailyAvg ?? null;
  let sdlyAnomaly = rawSdly?.anomaly  ?? null;

  if (
    calMonth === 9 &&
    rawSdly?.anomaly &&
    eventData.multiplier <= 1.0 &&
    sdlyDaily !== null
  ) {
    const sdlyYear = parseInt(date.split("-")[0], 10) - 1;
    const augEntry = getMonthEntry(`${sdlyYear}-08`, siteKey);
    const octEntry = getMonthEntry(`${sdlyYear}-10`, siteKey);
    if (augEntry && octEntry) {
      sdlyDaily = (
        augEntry.total / augEntry.daysInMonth +
        octEntry.total / octEntry.daysInMonth
      ) / 2;
      sdlyAnomaly =
        "September SDLY adjusted — Aug/Oct average used (event spike excluded from baseline)";
    }
  }

  // ── 3. Projected close ────────────────────────────────────────────────────
  //
  // Run rate is calculated from actual minutes traded since opening.
  // SDLY daily average is already a full-day revenue figure — no multiplier needed.
  //
  let projectedClose: number;
  let confidence: ForecastResult["confidence"] = "medium";

  if (minutesRemaining <= 0) {
    // Day is closed — actuals are final
    projectedClose = currentRevenue;
    confidence     = "high";

  } else if (minutesElapsed > 0) {
    // Service is live: run rate = revenue per minute since opening
    const runRate           = currentRevenue / minutesElapsed;
    const runRateProjection = currentRevenue + runRate * minutesRemaining;

    if (sdlyDaily !== null) {
      const totalMinutes = minutesElapsed + minutesRemaining;
      const progress     = minutesElapsed / totalMinutes;
      const runWeight    = Math.min(0.85, progress * 1.4);
      const sdlyWeight   = 1 - runWeight;

      // sdlyDaily is the full-day average — blend directly (no × SERVICE_END_HOUR)
      projectedClose = runRateProjection * runWeight + sdlyDaily * sdlyWeight;
      confidence     = progress > 0.5 ? "high" : "medium";
    } else {
      projectedClose = runRateProjection;
      confidence     = "low";
    }

  } else {
    // Pre-service: no trading minutes yet — show SDLY daily average as baseline
    projectedClose = sdlyDaily !== null ? sdlyDaily : 0;
    confidence     = "low";
  }

  // ── 4. Apply event uplift multiplier ──────────────────────────────────────
  if (eventData.multiplier > 1.0 && minutesRemaining > 0) {
    projectedClose = projectedClose * eventData.multiplier;
    if (confidence === "low") confidence = "medium";
  }

  // ── 5. vs Target — compare PROJECTED CLOSE to target (not current revenue) ─
  const vsTarget =
    revenueTarget && revenueTarget > 0
      ? +((projectedClose - revenueTarget) / revenueTarget * 100).toFixed(1)
      : 0;

  // ── 6. vs SDLY ────────────────────────────────────────────────────────────
  let vsSameDayLastYear: number | null = null;
  if (sdlyDaily !== null && sdlyDaily > 0) {
    if (minutesRemaining <= 0) {
      vsSameDayLastYear = +((currentRevenue - sdlyDaily) / sdlyDaily * 100).toFixed(1);
    } else if (minutesElapsed > 0) {
      vsSameDayLastYear = +((projectedClose - sdlyDaily) / sdlyDaily * 100).toFixed(1);
    }
  }

  // ── 7. Anomaly confidence adjustment ─────────────────────────────────────
  if (sdlyAnomaly && confidence === "high") confidence = "medium";

  // ── 8. Ramadan suppression (skipped when event active) ────────────────────
  const ramadan = isRamadanPeriod(date);
  if (ramadan && minutesRemaining > 0 && eventData.multiplier <= 1.0) {
    projectedClose = projectedClose * 0.70;
    if (confidence === "low") confidence = "medium";
  }

  return {
    projectedClose:    Math.round(projectedClose),
    sdlyDailyAvg:      sdlyDaily !== null ? Math.round(sdlyDaily) : null,
    vsSameDayLastYear,
    vsTarget,
    seasonalityIndex:  seasIdx,
    confidence,
    anomalyWarning:    sdlyAnomaly,
    isRamadan:         ramadan,
    ramadanWarning:    ramadan ? RAMADAN_WARNING : null,
    activeEvent:       eventData.eventName,
    eventUplift:       eventData.multiplier > 1.0 ? eventData.multiplier : null,
    isPreService:      minutesElapsed === 0 && minutesRemaining > 0,
  };
}
