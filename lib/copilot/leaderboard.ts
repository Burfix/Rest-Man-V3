/**
 * Leaderboard Engine
 *
 * getServiceLeaderboard(entries)    → ranked stores by service score
 * getMostImprovedStores(entries)    → sorted by score improvement
 * getLowestServiceStores(entries)   → at-risk stores
 * getShiftLeaderboard(entries)      → best/worst shift performers
 */

import type { ServiceScore, ServiceLabel } from "./service-score";
import type { ScoreGrade, ServiceWindow } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface LeaderboardEntry {
  storeId: string;
  storeName: string;
  serviceScore: number;
  serviceGrade: ScoreGrade;
  rank: number;
  movement: number | null;          // vs yesterday or last same shift
  biggestStrength: string | null;
  biggestWeakness: string | null;
  serviceRisk: "none" | "low" | "moderate" | "high" | "critical";
  lunchScore: number | null;
  dinnerScore: number | null;
  labels: ServiceLabel[];
  consecutiveAbove80: number;
  isRepeatLowScore: boolean;
}

export interface ShiftLeaderboardEntry {
  storeId: string;
  storeName: string;
  shiftType: "lunch" | "dinner";
  serviceScore: number;
  avgSpend: number;
  walkInConversion: number;
  isRecovery: boolean;
  movement: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Store-level input
// ═══════════════════════════════════════════════════════════════════════════════

export interface StoreServiceInput {
  storeId: string;
  storeName: string;
  score: ServiceScore;
  lunchScore?: number | null;
  dinnerScore?: number | null;
  consecutiveAbove80: number;
  daysBelowAverage: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Leaderboard
// ═══════════════════════════════════════════════════════════════════════════════

export function getServiceLeaderboard(
  stores: StoreServiceInput[],
): LeaderboardEntry[] {
  const sorted = [...stores].sort(
    (a, b) => b.score.totalScore - a.score.totalScore,
  );

  return sorted.map((s, i) => {
    const risk = deriveServiceRisk(s.score.totalScore, s.daysBelowAverage);
    return {
      storeId: s.storeId,
      storeName: s.storeName,
      serviceScore: s.score.totalScore,
      serviceGrade: s.score.serviceGrade,
      rank: i + 1,
      movement: s.score.movementVsYesterday,
      biggestStrength: s.score.biggestDriverUp,
      biggestWeakness: s.score.biggestDriverDown,
      serviceRisk: risk,
      lunchScore: s.lunchScore ?? null,
      dinnerScore: s.dinnerScore ?? null,
      labels: s.score.labels,
      consecutiveAbove80: s.consecutiveAbove80,
      isRepeatLowScore: s.daysBelowAverage >= 3,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Most Improved
// ═══════════════════════════════════════════════════════════════════════════════

export function getMostImprovedStores(
  stores: StoreServiceInput[],
): LeaderboardEntry[] {
  const withMovement = stores.filter(
    (s) => s.score.movementVsYesterday != null && s.score.movementVsYesterday > 0,
  );
  const sorted = [...withMovement].sort(
    (a, b) => (b.score.movementVsYesterday ?? 0) - (a.score.movementVsYesterday ?? 0),
  );

  return sorted.map((s, i) => ({
    storeId: s.storeId,
    storeName: s.storeName,
    serviceScore: s.score.totalScore,
    serviceGrade: s.score.serviceGrade,
    rank: i + 1,
    movement: s.score.movementVsYesterday,
    biggestStrength: s.score.biggestDriverUp,
    biggestWeakness: s.score.biggestDriverDown,
    serviceRisk: deriveServiceRisk(s.score.totalScore, s.daysBelowAverage),
    lunchScore: s.lunchScore ?? null,
    dinnerScore: s.dinnerScore ?? null,
    labels: s.score.labels,
    consecutiveAbove80: s.consecutiveAbove80,
    isRepeatLowScore: s.daysBelowAverage >= 3,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lowest / At-Risk
// ═══════════════════════════════════════════════════════════════════════════════

export function getLowestServiceStores(
  stores: StoreServiceInput[],
): LeaderboardEntry[] {
  const sorted = [...stores].sort(
    (a, b) => a.score.totalScore - b.score.totalScore,
  );

  return sorted
    .filter((s) => s.score.totalScore < 55)
    .map((s, i) => ({
      storeId: s.storeId,
      storeName: s.storeName,
      serviceScore: s.score.totalScore,
      serviceGrade: s.score.serviceGrade,
      rank: i + 1,
      movement: s.score.movementVsYesterday,
      biggestStrength: s.score.biggestDriverUp,
      biggestWeakness: s.score.biggestDriverDown,
      serviceRisk: deriveServiceRisk(s.score.totalScore, s.daysBelowAverage),
      lunchScore: s.lunchScore ?? null,
      dinnerScore: s.dinnerScore ?? null,
      labels: s.score.labels,
      consecutiveAbove80: s.consecutiveAbove80,
      isRepeatLowScore: s.daysBelowAverage >= 3,
    }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function deriveServiceRisk(
  score: number,
  daysBelowAvg: number,
): "none" | "low" | "moderate" | "high" | "critical" {
  if (score < 30 || daysBelowAvg >= 5) return "critical";
  if (score < 45 || daysBelowAvg >= 3) return "high";
  if (score < 55) return "moderate";
  if (score < 65) return "low";
  return "none";
}
