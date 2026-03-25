/**
 * Shift Performance Engine
 *
 * buildShiftSummary(input) → ShiftPerformanceSummary
 * getShiftAwards(shifts)   → ShiftAward[]
 * updateStreaks(storeId, score, serviceRisk) → streaks update info
 */

import type { ServiceWindow, ScoreGrade } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ShiftPerformanceSummary {
  shiftType: "lunch" | "dinner" | "full_day";
  serviceScore: number;
  serviceGrade: ScoreGrade;
  revenueActual: number;
  revenueTarget: number;
  coversActual: number;
  coversForecast: number;
  avgSpend: number;
  labourPercent: number;
  actionsCompleted: number;
  actionsTotal: number;
  revenueRecovered: number;
  carryForwardActions: number;
  isRecoveryShift: boolean;
  shiftSummary: string;
}

export type ShiftAwardType =
  | "best_lunch_shift"
  | "best_dinner_shift"
  | "best_recovery_shift"
  | "highest_avg_spend"
  | "lowest_walk_in_conversion";

export interface ShiftAward {
  type: ShiftAwardType;
  storeId: string;
  storeName: string;
  value: number;
  label: string;
}

export interface StreakUpdate {
  above80: { count: number; isActive: boolean };
  noCriticalRisk: { count: number; isActive: boolean };
  recovery: { count: number; isActive: boolean };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shift Summary Builder
// ═══════════════════════════════════════════════════════════════════════════════

export interface ShiftSummaryInput {
  serviceScore: number;
  revenueActual: number;
  revenueTarget: number;
  coversActual: number;
  coversForecast: number;
  avgSpend: number;
  labourPercent: number;
  actionsCompleted: number;
  actionsTotal: number;
  revenueRecovered: number;
  carryForwardActions: number;
  previousShiftScore: number | null;
  window: ServiceWindow;
}

function toGrade(score: number): ScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function buildShiftSummary(input: ShiftSummaryInput): ShiftPerformanceSummary {
  const {
    serviceScore, revenueActual, revenueTarget,
    coversActual, coversForecast, avgSpend,
    labourPercent, actionsCompleted, actionsTotal,
    revenueRecovered, carryForwardActions, previousShiftScore, window,
  } = input;

  const shiftType: "lunch" | "dinner" | "full_day" =
    window === "lunch_build" || window === "lunch_peak" ? "lunch" :
    window === "dinner_build" || window === "dinner_peak" ? "dinner" : "full_day";

  const isRecoveryShift =
    previousShiftScore != null &&
    previousShiftScore < 50 &&
    serviceScore >= previousShiftScore + 10;

  const revenueGap = Math.max(0, revenueTarget - revenueActual);
  const completionRate = actionsTotal > 0
    ? Math.round((actionsCompleted / actionsTotal) * 100)
    : 100;

  let shiftSummary: string;
  if (serviceScore >= 80 && revenueGap === 0) {
    shiftSummary = `Strong ${shiftType} shift. Service score ${serviceScore}, revenue on target, ${completionRate}% actions completed.`;
  } else if (isRecoveryShift) {
    shiftSummary = `Recovery shift. Score improved from ${previousShiftScore} to ${serviceScore}. ${revenueRecovered > 0 ? `${rands(revenueRecovered)} recovered.` : ""}`;
  } else if (revenueGap > 0) {
    shiftSummary = `${capitalize(shiftType)} shift closed with ${rands(revenueGap)} revenue gap. ${carryForwardActions > 0 ? `${carryForwardActions} action${carryForwardActions > 1 ? "s" : ""} carry forward.` : ""}`;
  } else {
    shiftSummary = `${capitalize(shiftType)} shift complete. Service score ${serviceScore}. ${actionsCompleted}/${actionsTotal} actions done.`;
  }

  return {
    shiftType,
    serviceScore,
    serviceGrade: toGrade(serviceScore),
    revenueActual,
    revenueTarget,
    coversActual,
    coversForecast,
    avgSpend,
    labourPercent,
    actionsCompleted,
    actionsTotal,
    revenueRecovered,
    carryForwardActions,
    isRecoveryShift,
    shiftSummary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shift Awards
// ═══════════════════════════════════════════════════════════════════════════════

export interface ShiftAwardInput {
  storeId: string;
  storeName: string;
  shiftType: "lunch" | "dinner" | "full_day";
  serviceScore: number;
  avgSpend: number;
  walkInConversionRate: number;
  isRecoveryShift: boolean;
}

export function getShiftAwards(shifts: ShiftAwardInput[]): ShiftAward[] {
  const awards: ShiftAward[] = [];

  // Best lunch shift
  const lunchShifts = shifts.filter((s) => s.shiftType === "lunch");
  if (lunchShifts.length > 0) {
    const best = lunchShifts.reduce((a, b) => a.serviceScore > b.serviceScore ? a : b);
    awards.push({
      type: "best_lunch_shift",
      storeId: best.storeId,
      storeName: best.storeName,
      value: best.serviceScore,
      label: `Best lunch shift — score ${best.serviceScore}`,
    });
  }

  // Best dinner shift
  const dinnerShifts = shifts.filter((s) => s.shiftType === "dinner");
  if (dinnerShifts.length > 0) {
    const best = dinnerShifts.reduce((a, b) => a.serviceScore > b.serviceScore ? a : b);
    awards.push({
      type: "best_dinner_shift",
      storeId: best.storeId,
      storeName: best.storeName,
      value: best.serviceScore,
      label: `Best dinner shift — score ${best.serviceScore}`,
    });
  }

  // Best recovery shift
  const recoveries = shifts.filter((s) => s.isRecoveryShift);
  if (recoveries.length > 0) {
    const best = recoveries.reduce((a, b) => a.serviceScore > b.serviceScore ? a : b);
    awards.push({
      type: "best_recovery_shift",
      storeId: best.storeId,
      storeName: best.storeName,
      value: best.serviceScore,
      label: `Best recovery — score ${best.serviceScore}`,
    });
  }

  // Highest avg spend
  const allWithSpend = shifts.filter((s) => s.avgSpend > 0);
  if (allWithSpend.length > 0) {
    const best = allWithSpend.reduce((a, b) => a.avgSpend > b.avgSpend ? a : b);
    awards.push({
      type: "highest_avg_spend",
      storeId: best.storeId,
      storeName: best.storeName,
      value: best.avgSpend,
      label: `Strongest guest spend — ${rands(best.avgSpend)}`,
    });
  }

  // Lowest walk-in conversion
  const allWithConversion = shifts.filter((s) => s.walkInConversionRate > 0);
  if (allWithConversion.length > 0) {
    const worst = allWithConversion.reduce((a, b) =>
      a.walkInConversionRate < b.walkInConversionRate ? a : b,
    );
    awards.push({
      type: "lowest_walk_in_conversion",
      storeId: worst.storeId,
      storeName: worst.storeName,
      value: Math.round(worst.walkInConversionRate * 100),
      label: `Lowest walk-in conversion — ${Math.round(worst.walkInConversionRate * 100)}%`,
    });
  }

  return awards;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Streak Tracking
// ═══════════════════════════════════════════════════════════════════════════════

export function updateStreaks(
  currentStreaks: StreakUpdate,
  serviceScore: number,
  serviceRiskLevel: string,
  isRecoveryShift: boolean,
): StreakUpdate {
  return {
    above80: {
      count: serviceScore >= 80
        ? currentStreaks.above80.count + 1
        : 0,
      isActive: serviceScore >= 80,
    },
    noCriticalRisk: {
      count: serviceRiskLevel !== "critical" && serviceRiskLevel !== "high"
        ? currentStreaks.noCriticalRisk.count + 1
        : 0,
      isActive: serviceRiskLevel !== "critical" && serviceRiskLevel !== "high",
    },
    recovery: {
      count: isRecoveryShift
        ? currentStreaks.recovery.count + 1
        : currentStreaks.recovery.count,
      isActive: isRecoveryShift,
    },
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
