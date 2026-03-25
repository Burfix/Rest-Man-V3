/**
 * Service Score Engine
 *
 * getServiceScore(signals, previousScore?, lastSameShiftScore?) → ServiceScore
 *
 * Score out of 100:
 *   floor_energy_score     (20)
 *   walk_in_conversion     (20)
 *   upsell_rate            (15)
 *   booking_conversion     (15)
 *   avg_spend_vs_target    (15)
 *   table_turn_rate        (10)
 *   review_service_sent.   (5)
 */

import type { ServiceSignals, ScoreGrade } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ServiceScoreBreakdown {
  floorEnergy: number;         // max 20
  walkInConversion: number;    // max 20
  upsellRate: number;          // max 15
  bookingConversion: number;   // max 15
  avgSpendVsTarget: number;    // max 15
  tableTurnRate: number;       // max 10
  reviewSentiment: number;     // max 5
}

export type ServiceLabel =
  | "Service Leader"
  | "Most Improved"
  | "Best Shift Recovery"
  | "Top Conversion Store"
  | "Strongest Guest Spend";

export interface ServiceScore {
  totalScore: number;
  serviceGrade: ScoreGrade;
  breakdown: ServiceScoreBreakdown;
  biggestDriverUp: string | null;
  biggestDriverDown: string | null;
  movementVsYesterday: number | null;
  movementVsLastSameShift: number | null;
  labels: ServiceLabel[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Component scoring functions
// ═══════════════════════════════════════════════════════════════════════════════

const COMPONENT_CONFIG = [
  { key: "floorEnergy",       label: "Floor Energy",       max: 20 },
  { key: "walkInConversion",  label: "Walk-in Conversion", max: 20 },
  { key: "upsellRate",        label: "Upsell Rate",        max: 15 },
  { key: "bookingConversion", label: "Booking Conversion", max: 15 },
  { key: "avgSpendVsTarget",  label: "Avg Spend vs Target",max: 15 },
  { key: "tableTurnRate",     label: "Table Turn Rate",    max: 10 },
  { key: "reviewSentiment",   label: "Review Sentiment",   max: 5 },
] as const;

function scoreFloorEnergy(energy: number): number {
  // energy is 0-100, map to 0-20
  if (energy >= 80) return 20;
  if (energy >= 60) return 15;
  if (energy >= 40) return 10;
  if (energy >= 20) return 5;
  return 0;
}

function scoreWalkInConversion(rate: number): number {
  // rate is 0-1, map to 0-20
  if (rate >= 0.5) return 20;
  if (rate >= 0.4) return 16;
  if (rate >= 0.3) return 12;
  if (rate >= 0.2) return 8;
  if (rate >= 0.1) return 4;
  return 0;
}

function scoreUpsellRate(rate: number): number {
  // rate is avgSpend/targetAvgSpend ratio, 0-1+
  if (rate >= 1.0) return 15;
  if (rate >= 0.95) return 13;
  if (rate >= 0.85) return 10;
  if (rate >= 0.75) return 7;
  if (rate >= 0.65) return 4;
  return 0;
}

function scoreBookingConversion(rate: number): number {
  // rate is 0-1, map to 0-15
  if (rate >= 0.9) return 15;
  if (rate >= 0.8) return 12;
  if (rate >= 0.65) return 9;
  if (rate >= 0.5) return 6;
  if (rate >= 0.3) return 3;
  return 0;
}

function scoreAvgSpendVsTarget(ratio: number): number {
  // ratio = avgSpend / targetAvgSpend
  if (ratio >= 1.0) return 15;
  if (ratio >= 0.95) return 13;
  if (ratio >= 0.85) return 10;
  if (ratio >= 0.75) return 7;
  if (ratio >= 0.60) return 3;
  return 0;
}

function scoreTableTurnRate(turns: number): number {
  if (turns >= 2.0) return 10;
  if (turns >= 1.5) return 8;
  if (turns >= 1.0) return 5;
  if (turns >= 0.5) return 2;
  return 0;
}

function scoreReviewSentiment(sentimentPct: number): number {
  // sentiment is 0-100 representing % positive
  if (sentimentPct >= 90) return 5;
  if (sentimentPct >= 75) return 4;
  if (sentimentPct >= 60) return 3;
  if (sentimentPct >= 40) return 2;
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Grade
// ═══════════════════════════════════════════════════════════════════════════════

function toGrade(score: number): ScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main scoring function
// ═══════════════════════════════════════════════════════════════════════════════

export interface ServiceScoreInput {
  signals: ServiceSignals;
  avgSpendVsTargetRatio: number;   // avgSpend / targetAvgSpend
  reviewSentimentPct: number;      // 0-100 (% positive reviews)
  previousDayScore?: number | null;
  lastSameShiftScore?: number | null;
}

export function getServiceScore(input: ServiceScoreInput): ServiceScore {
  const { signals, avgSpendVsTargetRatio, reviewSentimentPct } = input;

  const breakdown: ServiceScoreBreakdown = {
    floorEnergy: scoreFloorEnergy(signals.floorEnergyScore),
    walkInConversion: scoreWalkInConversion(signals.walkInConversionRate),
    upsellRate: scoreUpsellRate(signals.upsellRate),
    bookingConversion: scoreBookingConversion(signals.bookingConversionRate),
    avgSpendVsTarget: scoreAvgSpendVsTarget(avgSpendVsTargetRatio),
    tableTurnRate: scoreTableTurnRate(signals.tableTurnRate),
    reviewSentiment: scoreReviewSentiment(reviewSentimentPct),
  };

  const totalScore =
    breakdown.floorEnergy +
    breakdown.walkInConversion +
    breakdown.upsellRate +
    breakdown.bookingConversion +
    breakdown.avgSpendVsTarget +
    breakdown.tableTurnRate +
    breakdown.reviewSentiment;

  // ── Find biggest drivers ──────────────────────────────────────────────
  type CompEntry = { key: string; label: string; max: number; actual: number };

  const components: CompEntry[] = COMPONENT_CONFIG.map((c) => ({
    key: c.key,
    label: c.label,
    max: c.max,
    actual: breakdown[c.key],
  }));

  // Best performer (highest % of max)
  const sorted = [...components].sort(
    (a, b) => b.actual / b.max - a.actual / a.max,
  );
  const biggestDriverUp = sorted[0]?.actual > 0 ? sorted[0].label : null;

  // Worst performer (lowest % of max)
  const sortedAsc = [...components].sort(
    (a, b) => a.actual / a.max - b.actual / b.max,
  );
  const biggestDriverDown =
    sortedAsc[0]?.actual < sortedAsc[0]?.max ? sortedAsc[0].label : null;

  // ── Movement ──────────────────────────────────────────────────────────
  const movementVsYesterday =
    input.previousDayScore != null ? totalScore - input.previousDayScore : null;
  const movementVsLastSameShift =
    input.lastSameShiftScore != null ? totalScore - input.lastSameShiftScore : null;

  // ── Labels ────────────────────────────────────────────────────────────
  const labels: ServiceLabel[] = [];
  if (totalScore >= 85) labels.push("Service Leader");
  if (movementVsYesterday != null && movementVsYesterday >= 15)
    labels.push("Most Improved");
  if (
    movementVsLastSameShift != null &&
    movementVsLastSameShift >= 10 &&
    input.lastSameShiftScore != null &&
    input.lastSameShiftScore < 50
  )
    labels.push("Best Shift Recovery");
  if (breakdown.walkInConversion >= 16 && breakdown.bookingConversion >= 12)
    labels.push("Top Conversion Store");
  if (breakdown.avgSpendVsTarget >= 13) labels.push("Strongest Guest Spend");

  return {
    totalScore,
    serviceGrade: toGrade(totalScore),
    breakdown,
    biggestDriverUp,
    biggestDriverDown,
    movementVsYesterday,
    movementVsLastSameShift,
    labels,
  };
}
