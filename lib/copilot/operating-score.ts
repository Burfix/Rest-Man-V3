/**
 * Operating Score Engine -- GM Co-Pilot
 *
 * Uses the canonical calculateOperatingScore() from lib/scoring/operatingScore.
 * Weights (single source of truth):
 *   Revenue:     40 pts
 *   Labour:      25 pts
 *   Service:     15 pts  <- computed from floor energy + upsell + conversion
 *   Compliance:  10 pts
 *   Maintenance: 10 pts
 */

import { calculateOperatingScore } from "@/lib/scoring/operatingScore";
import type { CopilotOperatingScore } from "./types";
import type { ServiceState } from "./types";

export interface ScoreInput {
  serviceState: ServiceState;
  revenueActual: number;
  revenueTarget: number;
  labourPercent: number;
  targetLabourPercent: number;
  maintenanceUrgent: number;
  maintenanceHighCount: number;
  maintenanceMediumCount: number;
  maintenanceOpenCount: number;
  maintenanceServiceBlocking: boolean;
  maintenanceOldestOpenDays: number;
  complianceExpired: number;
  complianceDueSoon: number;
}

export function getCopilotOperatingScore(input: ScoreInput): CopilotOperatingScore {
  const {
    serviceState, revenueActual, revenueTarget,
    labourPercent, targetLabourPercent,
    maintenanceUrgent,
    maintenanceOpenCount, maintenanceServiceBlocking,
    complianceExpired, complianceDueSoon,
  } = input;

  // ---- Service raw score (0-25) from floor signals -------------------------
  // Then normalize to 0-100 for the canonical engine
  let svcPts = 0;
  const energy = serviceState.signals.floorEnergyScore;
  if (energy >= 70) svcPts += 12;
  else if (energy >= 50) svcPts += 8;
  else if (energy >= 30) svcPts += 4;

  if (serviceState.upsellStrength === "strong") svcPts += 8;
  else if (serviceState.upsellStrength === "moderate") svcPts += 5;
  else if (serviceState.upsellStrength === "weak") svcPts += 2;

  if (serviceState.conversionRate === "high") svcPts += 5;
  else if (serviceState.conversionRate === "moderate") svcPts += 3;
  else if (serviceState.conversionRate === "low") svcPts += 1;

  svcPts = Math.min(25, svcPts);
  // Normalize 0-25 to 0-100
  const serviceRaw = Math.round((svcPts / 25) * 100);

  // ---- Maintenance: derive critical count ----------------------------------
  const criticalCount = maintenanceServiceBlocking ? maintenanceOpenCount : maintenanceUrgent;

  // ---- Canonical operating score ------------------------------------------
  const scoreInput = {
    actualRevenue:   revenueActual,
    targetRevenue:   revenueTarget,
    labourPct:       labourPercent,
    targetLabourPct: targetLabourPercent,
    serviceScore:    serviceRaw,
    expiredItems:    complianceExpired,
    dueSoonItems:    complianceDueSoon,
    openIssues:      maintenanceOpenCount,
    criticalIssues:  criticalCount,
  };
  console.log("SCORE INPUT [lib/copilot/operating-score]:", {
    ...scoreInput,
    serviceRawSource: `svcPts=${svcPts}/25 → ${serviceRaw}/100`,
    revenueTargetZero: revenueTarget === 0,
  });
  const result = calculateOperatingScore(scoreInput);

  const totalScore = result.score;

  // ---- Summary -------------------------------------------------------------
  const weakest: string[] = [];
  if (result.components.service.rawScore < 50)     weakest.push("service weakness");
  if (result.components.revenue.rawScore < 50)     weakest.push("revenue underperformance");
  if (result.components.labour.rawScore < 50)      weakest.push("labour overspend");
  if (result.components.maintenance.rawScore < 50) weakest.push("maintenance issues");
  if (result.components.compliance.rawScore < 50)  weakest.push("compliance gaps");

  let scoreSummary: string;
  if (weakest.length === 0) {
    scoreSummary = "Strong operational performance across all domains.";
  } else if (weakest.length <= 2) {
    scoreSummary = `${capitalize(weakest.join(" and "))} ${weakest.length === 1 ? "is" : "are"} driving today's score.`;
  } else {
    scoreSummary = `${capitalize(weakest.slice(0, 2).join(", "))} and ${weakest.length - 2} other issue${weakest.length - 2 > 1 ? "s" : ""} are impacting performance.`;
  }

  return {
    totalScore,
    grade: result.grade,
    breakdown: {
      service:     result.components.service.weightedScore,
      revenue:     result.components.revenue.weightedScore,
      labour:      result.components.labour.weightedScore,
      maintenance: result.components.maintenance.weightedScore,
      compliance:  result.components.compliance.weightedScore,
    },
    scoreSummary,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}