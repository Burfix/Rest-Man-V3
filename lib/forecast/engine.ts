/**
 * lib/forecast/engine.ts — Core forecast computation engine
 *
 * Rule-based forecasting for sales, covers, hourly demand distribution,
 * labour guidance, and confidence scoring.
 *
 * Weighting:
 *   40% recent same-weekday average
 *   30% trailing 4-week average (approximated via recentWeekdayAvg)
 *   20% same day last year
 *   10% reservations + event adjustments
 */

import { WALKIN_COVER_RATIO, DEFAULT_AVG_SPEND_ZAR, RISK } from "@/lib/constants";
import type {
  ForecastInput,
  DemandSnapshot,
  HourlySlot,
  LabourGuidance,
  ForecastConfidence,
} from "@/types/forecast";

// ── Hourly demand distribution curves ──────────────────────────────────────
// Percentage of daily revenue by hour (10am–10pm, 13 slots)
// Based on typical full-service Cape Town restaurant patterns.

const WEEKDAY_CURVE: Record<number, number> = {
  10: 0.02, 11: 0.06, 12: 0.12, 13: 0.10, 14: 0.05,
  15: 0.03, 16: 0.03, 17: 0.06, 18: 0.14, 19: 0.18,
  20: 0.13, 21: 0.06, 22: 0.02,
};

const WEEKEND_CURVE: Record<number, number> = {
  10: 0.04, 11: 0.08, 12: 0.11, 13: 0.09, 14: 0.06,
  15: 0.04, 16: 0.04, 17: 0.06, 18: 0.12, 19: 0.16,
  20: 0.12, 21: 0.06, 22: 0.02,
};

const EVENT_EVENING_CURVE: Record<number, number> = {
  10: 0.02, 11: 0.04, 12: 0.08, 13: 0.07, 14: 0.04,
  15: 0.02, 16: 0.03, 17: 0.07, 18: 0.16, 19: 0.20,
  20: 0.16, 21: 0.08, 22: 0.03,
};

function getDemandCurve(dayName: string, hasEvent: boolean): Record<number, number> {
  if (hasEvent) return EVENT_EVENING_CURVE;
  if (dayName === "friday" || dayName === "saturday" || dayName === "sunday") return WEEKEND_CURVE;
  return WEEKDAY_CURVE;
}

// ── Sales forecast ─────────────────────────────────────────────────────────

export function generateSalesForecast(input: ForecastInput): {
  total: number;
  signalCount: number;
} {
  const signals: Array<{ value: number; weight: number }> = [];

  // 40% recent same-weekday average
  if (input.recentWeekdayAvgSales != null && input.recentWeekdayAvgSales > 0)
    signals.push({ value: input.recentWeekdayAvgSales, weight: 40 });

  // 20% same day last year
  if (input.sameDayLastYearSales != null && input.sameDayLastYearSales > 0)
    signals.push({ value: input.sameDayLastYearSales, weight: 20 });

  // 10% reservation-based (covers × spend)
  if (input.confirmedCovers > 0 && input.historicalAvgSpend != null) {
    const walkIns = estimateWalkIns(input);
    signals.push({
      value: (input.confirmedCovers + walkIns) * (input.historicalAvgSpend ?? DEFAULT_AVG_SPEND_ZAR),
      weight: 10,
    });
  }

  if (signals.length === 0) {
    // Absolute fallback — covers × spend estimate
    const total = input.confirmedCovers + estimateWalkIns(input);
    return {
      total: Math.round(total * (input.historicalAvgSpend ?? DEFAULT_AVG_SPEND_ZAR) * input.eventMultiplier),
      signalCount: 0,
    };
  }

  // Normalise weights and compute weighted average
  const totalW = signals.reduce((s, sig) => s + sig.weight, 0);
  const base = signals.reduce((s, sig) => s + (sig.value * sig.weight) / totalW, 0);

  return {
    total: Math.round(base * input.eventMultiplier),
    signalCount: signals.length,
  };
}

// ── Covers forecast ────────────────────────────────────────────────────────

export function generateCoversForecast(input: ForecastInput): number {
  const signals: Array<{ value: number; weight: number }> = [];

  if (input.recentWeekdayAvgCovers != null && input.recentWeekdayAvgCovers > 0)
    signals.push({ value: input.recentWeekdayAvgCovers, weight: 40 });

  if (input.sameDayLastYearCovers != null && input.sameDayLastYearCovers > 0)
    signals.push({ value: input.sameDayLastYearCovers, weight: 20 });

  if (input.confirmedCovers > 0)
    signals.push({ value: input.confirmedCovers + estimateWalkIns(input), weight: 10 });

  if (signals.length === 0) {
    return input.confirmedCovers + estimateWalkIns(input);
  }

  const totalW = signals.reduce((s, sig) => s + sig.weight, 0);
  const base = signals.reduce((s, sig) => s + (sig.value * sig.weight) / totalW, 0);

  return Math.round(base * input.eventMultiplier);
}

// ── Hourly forecast ────────────────────────────────────────────────────────

export function generateHourlyForecast(
  input: ForecastInput,
  totalSales: number,
  totalCovers: number,
): DemandSnapshot {
  const curve = getDemandCurve(input.dayName, !!input.eventName);
  const hourly: HourlySlot[] = [];

  let peakHour = 19;
  let peakSales = 0;

  for (const [hourStr, pct] of Object.entries(curve)) {
    const hour = Number(hourStr);
    const forecastSales = Math.round(totalSales * pct);
    const forecastCovers = Math.round(totalCovers * pct);
    hourly.push({ hour, forecastSales, forecastCovers });

    if (forecastSales > peakSales) {
      peakSales = forecastSales;
      peakHour = hour;
    }
  }

  // Determine peak window (3-hour band centred on peak)
  const peakStart = Math.max(10, peakHour - 1);
  const peakEnd = Math.min(22, peakHour + 1);
  const peakWindow = `${formatHour(peakStart)} – ${formatHour(peakEnd)}`;

  return {
    totalForecastSales: totalSales,
    totalForecastCovers: totalCovers,
    forecastAvgSpend: totalCovers > 0 ? Math.round(totalSales / totalCovers) : 0,
    peakHour,
    peakHourSales: peakSales,
    peakWindow,
    hourlyBreakdown: hourly,
  };
}

// ── Labour guidance ────────────────────────────────────────────────────────

// Labour target is loaded from site config at call sites.
// The function accepts the target as a parameter now.

export function generateLabourGuidance(
  input: ForecastInput,
  salesForecast: number,
  targetLabourPct: number = 30,
): LabourGuidance {
  const pct = input.latestLabourPct;
  const actions: string[] = [];

  let status: LabourGuidance["status"] = "on_track";
  let message = `Labour cost is tracking normally against forecast revenue of R${(salesForecast / 1000).toFixed(0)}k.`;

  if (pct != null) {
    if (pct > RISK.LABOR_HIGH_PCT) {
      status = "above_target";
      message = `Labour is running at ${pct.toFixed(1)}% — above the ${RISK.LABOR_HIGH_PCT}% threshold. Review the roster before service.`;
      actions.push("Consider releasing one floor staff member during the quiet 2pm–5pm window");
      actions.push("Review overtime authorisations for tonight's close");
    } else if (pct > RISK.LABOR_MEDIUM_PCT) {
      status = "above_target";
      message = `Labour is at ${pct.toFixed(1)}% — slightly elevated. Monitor hours closely during service.`;
      actions.push("Track cover-to-staff ratio during dinner peak");
    } else {
      message = `Labour is at ${pct.toFixed(1)}% — within target range.`;
    }
  }

  // If high-demand day + no labour data, flag it
  if (pct == null && salesForecast > 40000) {
    status = "below_target";
    message = "Forecast suggests a busy day but no recent labour data is available. Consider reviewing your roster.";
    actions.push("Check staffing levels match the expected covers");
  }

  return {
    targetLabourPct: targetLabourPct,
    forecastLabourPct: pct,
    status,
    message,
    suggestedActions: actions,
  };
}

// ── Confidence scoring ─────────────────────────────────────────────────────

export function calculateConfidenceScore(input: ForecastInput): {
  score: number;
  confidence: ForecastConfidence;
} {
  let score = 0;
  // Recent weekday sales history (most valuable)
  if (input.recentWeekdayAvgSales != null) score += 30;
  // Same day last year
  if (input.sameDayLastYearSales != null) score += 20;
  // Cover history
  if (input.recentWeekdayAvgCovers != null) score += 15;
  // Bookings/reservations
  if (input.confirmedCovers > 0) score += 15;
  // Labour cost data
  if (input.latestLabourPct != null) score += 10;
  // Sales target set
  if (input.salesTarget != null) score += 10;

  const confidence: ForecastConfidence =
    score >= 70 ? "high" : score >= 40 ? "medium" : "low";

  return { score, confidence };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function estimateWalkIns(input: ForecastInput): number {
  if (input.recentWeekdayAvgCovers != null && input.recentWeekdayAvgCovers > input.confirmedCovers) {
    return Math.max(0, Math.round(
      (input.recentWeekdayAvgCovers - input.confirmedCovers) * WALKIN_COVER_RATIO
    ));
  }
  return Math.round(input.confirmedCovers * 0.2);
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}
