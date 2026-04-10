/**
 * Operating Score Engine (Service-Weighted)
 *
 * getCopilotOperatingScore(input) → CopilotOperatingScore
 *
 * Weights:
 *   Service:    25 pts
 *   Revenue:    25 pts
 *   Labour:     20 pts
 *   Maintenance: 10 pts
 *   Compliance: 10 pts
 *                ── max 90 pts
 */

import type { CopilotOperatingScore, ScoreGrade } from "./types";
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

function toGrade(total: number): ScoreGrade {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  if (total >= 40) return "D";
  return "F";
}

export function getCopilotOperatingScore(input: ScoreInput): CopilotOperatingScore {
  const {
    serviceState, revenueActual, revenueTarget,
    labourPercent, targetLabourPercent,
    maintenanceUrgent, maintenanceHighCount, maintenanceMediumCount,
    maintenanceOpenCount, maintenanceServiceBlocking,
    maintenanceOldestOpenDays,
    complianceExpired, complianceDueSoon,
  } = input;

  // ── Service (max 25) ────────────────────────────────────────────────────
  let serviceScore = 0;
  const energy = serviceState.signals.floorEnergyScore;
  // Energy: 0-12 points
  if (energy >= 70) serviceScore += 12;
  else if (energy >= 50) serviceScore += 8;
  else if (energy >= 30) serviceScore += 4;

  // Upsell: 0-8 points
  if (serviceState.upsellStrength === "strong") serviceScore += 8;
  else if (serviceState.upsellStrength === "moderate") serviceScore += 5;
  else if (serviceState.upsellStrength === "weak") serviceScore += 2;

  // Conversion: 0-5 points
  if (serviceState.conversionRate === "high") serviceScore += 5;
  else if (serviceState.conversionRate === "moderate") serviceScore += 3;
  else if (serviceState.conversionRate === "low") serviceScore += 1;

  serviceScore = Math.min(25, serviceScore);

  // ── Revenue (max 25) ────────────────────────────────────────────────────
  let revenueScore = 0;
  if (revenueTarget > 0) {
    const gapPct = ((revenueTarget - revenueActual) / revenueTarget) * 100;
    if (gapPct <= 0) revenueScore = 25;
    else if (gapPct <= 5) revenueScore = 20;
    else if (gapPct <= 10) revenueScore = 15;
    else if (gapPct <= 20) revenueScore = 8;
    else if (gapPct <= 40) revenueScore = 3;
    else revenueScore = 0;
  }

  // ── Labour (max 20) ────────────────────────────────────────────────────
  let labourScore = 0;
  if (labourPercent <= targetLabourPercent) labourScore = 20;
  else if (labourPercent <= targetLabourPercent + 3) labourScore = 15;
  else if (labourPercent <= targetLabourPercent + 8) labourScore = 10;
  else if (labourPercent <= targetLabourPercent + 15) labourScore = 5;
  else labourScore = 0;

  // ── Maintenance (max 10) — penalty-from-full, spec v1.0 scaled from 15→10 ──
  // Component 1: Severity
  let mSev = 0;
  if (maintenanceServiceBlocking)      mSev = 10;  // -10 → 0/10
  else if (maintenanceUrgent > 0)      mSev = 8;   // scaled ~5.3→5
  else if (maintenanceHighCount > 0)   mSev = 5;   // scaled ~3.3→3
  else if (maintenanceMediumCount > 0) mSev = 2;   // scaled ~1.3→1
  // Component 2: SLA age
  let mSla = 0;
  if (maintenanceOldestOpenDays > 7)       mSla = 3;
  else if (maintenanceOldestOpenDays > 3)  mSla = 2;
  else if (maintenanceOldestOpenDays > 1)  mSla = 1;
  // Component 3: Volume
  let mVol = 0;
  if (maintenanceOpenCount >= 4)       mVol = 2;
  else if (maintenanceOpenCount >= 2)  mVol = 1;
  // Scale from /15 model: deductions are out of 15, scale result to 10
  const maintFrom15 = Math.max(0, 15 - mSev - mSla - mVol);
  let maintenanceScore = Math.round(maintFrom15 * (10 / 15));

  // ── Compliance (max 10) ────────────────────────────────────────────────
  let complianceScore = 10;
  if (complianceExpired > 0) complianceScore = 0;
  else if (complianceDueSoon > 0) complianceScore = 6;

  const totalScore = serviceScore + revenueScore + labourScore + maintenanceScore + complianceScore;

  // ── Summary ────────────────────────────────────────────────────────────

  const weakest: string[] = [];
  if (serviceScore < 12) weakest.push("service weakness");
  if (revenueScore < 12) weakest.push("revenue underperformance");
  if (labourScore < 10) weakest.push("labour overspend");
  if (maintenanceScore < 5) weakest.push("maintenance issues");
  if (complianceScore < 5) weakest.push("compliance gaps");

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
    grade: toGrade(totalScore),
    breakdown: {
      service: serviceScore,
      revenue: revenueScore,
      labour: labourScore,
      maintenance: maintenanceScore,
      compliance: complianceScore,
    },
    scoreSummary,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
