/**
 * ForgeStack Forecasting Engine
 *
 * Pure functions — no async, no side effects.
 * Uses Primi Camps Bay historical data as the reference corpus.
 *
 * Functions:
 *   sameDayLastYear       — exact SDLY revenue or null
 *   sameWeekdayLast4Weeks — rolling 4-week average for same weekday
 *   weekdayBaseline       — grand average for a day-of-week across all data
 *   monthlySeasonalityIndex — multiplier vs annual mean
 *   forecastToday         — full projection with confidence and variance
 */

import { HISTORICAL_REVENUE, HISTORICAL_BY_DATE } from "./historical-data";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ForecastResult = {
  projectedClose: number;
  vsTarget: number;              // % vs revenueTarget (or vs weekday baseline if no target)
  vsSameDayLastYear: number | null;      // % change vs exact SDLY
  vsSameWeekdayAvg: number;     // % vs 4-week rolling avg for same weekday
  confidence: "high" | "medium" | "low";
  warning: string | null;
};

// Standard service window for Camps Bay restaurant
const SERVICE_START_HOUR = 10;  // 10:00
const SERVICE_END_HOUR   = 22;  // 22:00
const SERVICE_HOURS      = SERVICE_END_HOUR - SERVICE_START_HOUR; // 12 hours

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayOfWeekName(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function annualMean(): number {
  const sum = HISTORICAL_REVENUE.reduce((s, d) => s + d.revenue, 0);
  return sum / HISTORICAL_REVENUE.length;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the revenue recorded exactly 364 days before `date` (same weekday
 * as one year ago). Returns null if not in the dataset.
 */
export function sameDayLastYear(date: string): number | null {
  // 364 days = exactly 52 weeks — preserves weekday alignment
  const sdlyDate = addDays(date, -364);
  return HISTORICAL_BY_DATE.get(sdlyDate) ?? null;
}

/**
 * Average revenue for the same weekday over the 4 most recent complete weeks
 * prior to `date`. Returns null if fewer than 2 data points available.
 */
export function sameWeekdayLast4Weeks(date: string): number | null {
  const results: number[] = [];
  for (let w = 1; w <= 4; w++) {
    const lookupDate = addDays(date, -(w * 7));
    const rev = HISTORICAL_BY_DATE.get(lookupDate);
    if (rev != null) results.push(rev);
  }
  if (results.length < 2) return null;
  return Math.round(results.reduce((s, v) => s + v, 0) / results.length);
}

/**
 * Grand average revenue for a given day of week (0=Sun, 1=Mon … 6=Sat)
 * across the full dataset.
 */
export function weekdayBaseline(dayOfWeek: number): number {
  const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const name = dowNames[dayOfWeek];
  const matching = HISTORICAL_REVENUE.filter((d) => d.day === name);
  if (matching.length === 0) return annualMean();
  return Math.round(matching.reduce((s, d) => s + d.revenue, 0) / matching.length);
}

/**
 * Seasonality multiplier for a given ISO month number (1–12) relative to
 * the annual average. 1.0 = average month; >1.0 = above average.
 */
export function monthlySeasonalityIndex(month: number): number {
  const mean = annualMean();
  const monthName = new Date(2025, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const matching = HISTORICAL_REVENUE.filter((d) => d.month === monthName);
  if (matching.length === 0 || mean === 0) return 1.0;
  const monthAvg = matching.reduce((s, d) => s + d.revenue, 0) / matching.length;
  return parseFloat((monthAvg / mean).toFixed(3));
}

/**
 * Full day projection for the GM Co-Pilot.
 *
 * @param date           ISO date string "YYYY-MM-DD"
 * @param currentRevenue Revenue banked so far today (R)
 * @param hoursRemaining Hours left in the service window (0–12)
 * @param revenueTarget  Optional revenue target (R) for vsTarget calc
 */
export function forecastToday(
  date: string,
  currentRevenue: number,
  hoursRemaining: number,
  revenueTarget?: number,
): ForecastResult {
  const hoursElapsed = Math.max(0, SERVICE_HOURS - hoursRemaining);
  const sdly         = sameDayLastYear(date);
  const weekdayAvg   = sameWeekdayLast4Weeks(date) ?? weekdayBaseline(new Date(date + "T12:00:00").getDay());

  // ── Run-rate projection ───────────────────────────────────────────────────
  let runRateProjected: number;
  if (hoursElapsed <= 0) {
    // No service time elapsed — fall back entirely to historical
    runRateProjected = weekdayAvg;
  } else if (hoursRemaining <= 0) {
    // Service complete — actual is the final figure
    runRateProjected = currentRevenue;
  } else {
    // Extrapolate: assume even revenue distribution across service hours
    const ratePerHour = currentRevenue / hoursElapsed;
    runRateProjected = Math.round(currentRevenue + ratePerHour * hoursRemaining);
  }

  // ── Blended projection ────────────────────────────────────────────────────
  // Weight run-rate more heavily as service progresses; lean on history early
  const progressRatio = hoursElapsed / SERVICE_HOURS; // 0 → 1
  let projectedClose: number;

  if (sdly != null) {
    // High confidence blend: 60% run-rate (scales with progress) + 40% SDLY
    const runRateWeight = 0.4 + progressRatio * 0.4;  // 0.4 → 0.8
    const sdlyWeight    = 1 - runRateWeight;
    projectedClose = Math.round(runRateProjected * runRateWeight + sdly * sdlyWeight);
  } else if (weekdayAvg > 0) {
    // Medium confidence: blend with 4-week avg
    const runRateWeight = 0.5 + progressRatio * 0.35;  // 0.5 → 0.85
    projectedClose = Math.round(runRateProjected * runRateWeight + weekdayAvg * (1 - runRateWeight));
  } else {
    // Low confidence: pure run-rate
    projectedClose = runRateProjected;
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  const hasSdly       = sdly != null;
  const has4WeekAvg   = sameWeekdayLast4Weeks(date) != null;
  const confidence: ForecastResult["confidence"] =
    hasSdly && has4WeekAvg ? "high" :
    hasSdly || has4WeekAvg ? "medium" :
    "low";

  // ── Variance calculations ─────────────────────────────────────────────────
  const benchmark = revenueTarget ?? weekdayAvg;
  const vsTarget  = benchmark > 0
    ? parseFloat(((projectedClose - benchmark) / benchmark * 100).toFixed(1))
    : 0;

  const vsSameDayLastYear: number | null = sdly != null && sdly > 0
    ? parseFloat(((projectedClose - sdly) / sdly * 100).toFixed(1))
    : null;

  const vsSameWeekdayAvg = weekdayAvg > 0
    ? parseFloat(((projectedClose - weekdayAvg) / weekdayAvg * 100).toFixed(1))
    : 0;

  // ── Warnings ──────────────────────────────────────────────────────────────
  let warning: string | null = null;

  if (hoursElapsed < 1 && progressRatio < 0.1) {
    warning = "Early in service — projection based on historical only.";
  } else if (confidence === "low") {
    warning = "No historical data for this date — projection is estimate only.";
  } else if (vsTarget < -20) {
    warning = `Tracking ${Math.abs(vsTarget).toFixed(0)}% below target. Recovery needed.`;
  } else if (sdly != null && vsSameDayLastYear != null && vsSameDayLastYear < -15) {
    warning = `Tracking ${Math.abs(vsSameDayLastYear).toFixed(0)}% below same day last year.`;
  }

  return {
    projectedClose,
    vsTarget,
    vsSameDayLastYear,
    vsSameWeekdayAvg,
    confidence,
    warning,
  };
}
