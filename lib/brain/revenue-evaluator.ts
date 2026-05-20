/**
 * lib/brain/revenue-evaluator.ts
 *
 * Pace-adjusted revenue evaluator.
 *
 * Fixes the critical trust issue: at 12:18 SAST with R1,396 of sales
 * and a R15k daily target, the old brain said "CRITICAL: Revenue -90.9% vs target".
 * This is wrong — lunch just started. A pace-aware model gives context.
 *
 * Algorithm:
 * 1. Compute fraction of trading day elapsed using historical hourly curve
 *    (not linear clock time — different hours have different revenue weight)
 * 2. Project EOD = current_revenue / curve_fraction_elapsed
 * 3. Return pace_status with confidence based on how much day has elapsed
 * 4. Only raise 'critically_behind' when projected EOD < 70% of target
 *    AND confidence > 0.7 (i.e., at least 30% of trading day elapsed)
 *
 * Feature flag: brain.pace_adjusted_revenue
 * If flag is false, falls back to raw percentage comparison.
 */

export interface PaceInputs {
  current_net_sales: number;
  daily_target: number;
  /** Local time string "HH:MM" e.g. "08:00" */
  trading_start_local: string;
  /** Local time string "HH:MM" e.g. "23:00" */
  trading_end_local: string;
  now_local: Date;
  /**
   * 24-entry array where index = hour of day (0–23).
   * Each value = cumulative % of day's total revenue earned BY that hour.
   * Must be monotonically non-decreasing from 0.0 to 1.0.
   * Defaults to ITALIAN_LUNCH_DINNER_CURVE if not supplied.
   */
  historical_hourly_curve?: number[];
}

export type PaceStatus =
  | "too_early_to_tell"
  | "ahead"
  | "on_pace"
  | "behind"
  | "critically_behind";

export interface PaceResult {
  pace_status: PaceStatus;
  /** Projected revenue at end of trading day */
  projected_eod: number;
  /** projected_eod - daily_target (can be negative) */
  gap_to_target: number;
  /** 0.0–1.0 — how much of the trading day has elapsed on the revenue curve */
  confidence: number;
  /** Fraction of trading day elapsed based on revenue curve */
  curve_fraction_elapsed: number;
  /** Raw percentage of target achieved so far */
  raw_pct_of_target: number;
}

/**
 * Default revenue distribution curve for an Italian restaurant with
 * lunch (12–15h) and dinner service (18–22h).
 * Index = hour of day; value = cumulative fraction of daily revenue earned BY that hour.
 *
 * Based on typical South African restaurant trading patterns.
 */
export const ITALIAN_LUNCH_DINNER_CURVE: number[] = [
  0.00, // 00:00
  0.00, // 01:00
  0.00, // 02:00
  0.00, // 03:00
  0.00, // 04:00
  0.00, // 05:00
  0.00, // 06:00
  0.00, // 07:00
  0.02, // 08:00 — early covers / coffee
  0.05, // 09:00
  0.12, // 10:00 — brunch build
  0.22, // 11:00
  0.35, // 12:00 — lunch peak starts
  0.45, // 13:00
  0.50, // 14:00 — post-lunch tail
  0.53, // 15:00
  0.58, // 16:00 — afternoon quiet
  0.65, // 17:00 — early dinner
  0.75, // 18:00 — dinner peak
  0.87, // 19:00
  0.95, // 20:00
  0.99, // 21:00 — last covers
  1.00, // 22:00
  1.00, // 23:00
];

/**
 * Evaluate revenue pace against a daily target.
 *
 * Acceptance criteria:
 * - At 12:18 with R1,396 and R15k target → NOT 'critically_behind'
 * - Before trading starts → 'too_early_to_tell'
 * - After trading ends with 0 revenue → 'critically_behind' (real problem)
 */
export function evaluatePaceAdjustedRevenue(i: PaceInputs): PaceResult {
  const curve = normalizeCurve(i.historical_hourly_curve ?? ITALIAN_LUNCH_DINNER_CURVE);

  // ── Time context ──────────────────────────────────────────────────────────
  const nowHour = i.now_local.getHours();
  const nowMinute = i.now_local.getMinutes();
  const nowFractional = nowHour + nowMinute / 60;

  const tradingStart = parseTimeToHour(i.trading_start_local);
  const tradingEnd = parseTimeToHour(i.trading_end_local);
  const tradingDurationH = tradingEnd - tradingStart;

  // ── Fraction of trading day elapsed (clock-based for interpolation) ───────
  const clockFractionElapsed = Math.max(
    0,
    Math.min(1, (nowFractional - tradingStart) / tradingDurationH),
  );

  // ── Revenue curve fraction at current time ────────────────────────────────
  // Interpolate between integer hours
  const curveAtNow = interpolateCurve(curve, nowFractional);
  const curveAtStart = interpolateCurve(curve, tradingStart);
  const curveAtEnd = interpolateCurve(curve, tradingEnd);

  const curveRange = curveAtEnd - curveAtStart;
  const curve_fraction_elapsed =
    curveRange > 0
      ? Math.max(0, Math.min(1, (curveAtNow - curveAtStart) / curveRange))
      : clockFractionElapsed;

  // ── Projection ────────────────────────────────────────────────────────────
  const raw_pct_of_target =
    i.daily_target > 0 ? i.current_net_sales / i.daily_target : 0;

  let projected_eod: number;
  if (curve_fraction_elapsed > 0.02) {
    projected_eod = i.current_net_sales / curve_fraction_elapsed;
  } else {
    // Too early — no meaningful projection
    projected_eod = i.daily_target; // optimistic default
  }

  const gap_to_target = projected_eod - i.daily_target;

  // confidence increases as more of the day has passed on the revenue curve
  const confidence = curve_fraction_elapsed;

  // ── Status decision ───────────────────────────────────────────────────────
  const pace_status = decidePaceStatus({
    curve_fraction_elapsed,
    confidence,
    projected_eod,
    daily_target: i.daily_target,
    nowFractional,
    tradingStart,
    tradingEnd,
  });

  return {
    pace_status,
    projected_eod: round2(projected_eod),
    gap_to_target: round2(gap_to_target),
    confidence: round3(confidence),
    curve_fraction_elapsed: round3(curve_fraction_elapsed),
    raw_pct_of_target: round3(raw_pct_of_target),
  };
}

// ── Decision logic ────────────────────────────────────────────────────────────

function decidePaceStatus(opts: {
  curve_fraction_elapsed: number;
  confidence: number;
  projected_eod: number;
  daily_target: number;
  nowFractional: number;
  tradingStart: number;
  tradingEnd: number;
}): PaceStatus {
  const { curve_fraction_elapsed, confidence, projected_eod, daily_target, nowFractional, tradingStart, tradingEnd } = opts;

  // Before trading starts
  if (nowFractional < tradingStart) {
    return "too_early_to_tell";
  }

  // Less than 20% of trading day has passed on the revenue curve
  // — not enough data regardless of numbers
  if (curve_fraction_elapsed < 0.20) {
    return "too_early_to_tell";
  }

  if (daily_target <= 0) {
    return "too_early_to_tell";
  }

  const projectedRatio = projected_eod / daily_target;
  const pctAhead = projectedRatio - 1; // positive = ahead

  // Gate: only let 'critically_behind' through with sufficient confidence
  if (projectedRatio < 0.70 && confidence > 0.70) {
    return "critically_behind";
  }

  if (projectedRatio < 0.85 && confidence > 0.50) {
    return "behind";
  }

  if (pctAhead >= 0.05) {
    return "ahead";
  }

  return "on_pace";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTimeToHour(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

/**
 * Interpolate a value in the 24-entry curve at a fractional hour.
 * e.g. 12.5 → midpoint between curve[12] and curve[13]
 */
function interpolateCurve(curve: number[], fractionalHour: number): number {
  const clamped = Math.max(0, Math.min(23.999, fractionalHour));
  const lower = Math.floor(clamped);
  const upper = Math.min(23, lower + 1);
  const frac = clamped - lower;
  return (curve[lower] ?? 0) + ((curve[upper] ?? 0) - (curve[lower] ?? 0)) * frac;
}

/**
 * Ensure the curve is 24 entries, non-decreasing, and bounded 0–1.
 */
function normalizeCurve(raw: number[]): number[] {
  const padded = Array.from({ length: 24 }, (_, i) => raw[i] ?? (i < 24 ? 1 : 0));
  // Enforce monotonicity
  let prev = 0;
  return padded.map((v) => {
    const clamped = Math.max(prev, Math.min(1, v));
    prev = clamped;
    return clamped;
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
