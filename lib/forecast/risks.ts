/**
 * lib/forecast/risks.ts — Risk assessment engine
 *
 * Evaluates staffing, compliance, maintenance and service risks
 * into a unified risk score and severity level.
 */

import type {
  ForecastInput,
  RiskAssessment,
  RiskItem,
  RiskSeverity,
  DemandSnapshot,
} from "@/types/forecast";
import { RISK } from "@/lib/constants";

export function generateRiskAssessment(
  input: ForecastInput,
  demand: DemandSnapshot,
): RiskAssessment {
  const risks: RiskItem[] = [];

  // ── Staffing risk ────────────────────────────────────────────────────────

  if (input.latestLabourPct != null) {
    if (input.latestLabourPct > RISK.LABOR_HIGH_PCT) {
      risks.push({
        riskType: "staffing",
        severity: "high",
        title: "Labour cost above threshold",
        description: `Labour is at ${input.latestLabourPct.toFixed(1)}% — above the ${RISK.LABOR_HIGH_PCT}% target.`,
        recommendedAction: "Review roster and consider releasing one shift during the quiet period",
      });
    } else if (input.latestLabourPct > RISK.LABOR_MEDIUM_PCT) {
      risks.push({
        riskType: "staffing",
        severity: "medium",
        title: "Labour cost elevated",
        description: `Labour is at ${input.latestLabourPct.toFixed(1)}% — above ${RISK.LABOR_MEDIUM_PCT}%.`,
        recommendedAction: "Monitor hours closely during service",
      });
    }
  } else if (demand.totalForecastCovers > 80) {
    risks.push({
      riskType: "staffing",
      severity: "medium",
      title: "No labour data available",
      description: "High covers expected but no recent labour data. Staffing adequacy unknown.",
      recommendedAction: "Manually verify roster covers the forecast demand",
    });
  }

  // ── Compliance risk ──────────────────────────────────────────────────────

  if (input.complianceExpired > 0) {
    risks.push({
      riskType: "compliance",
      severity: "critical",
      title: `${input.complianceExpired} expired compliance item${input.complianceExpired > 1 ? "s" : ""}`,
      description: "Active regulatory breach — expired certificates require immediate action.",
      recommendedAction: "Contact service providers today and schedule renewals",
    });
  }

  if (input.complianceDueSoon > 0) {
    risks.push({
      riskType: "compliance",
      severity: "medium",
      title: `${input.complianceDueSoon} compliance item${input.complianceDueSoon > 1 ? "s" : ""} due soon`,
      description: "Certificates approaching expiry within 30 days.",
      recommendedAction: "Schedule renewals to avoid lapses",
    });
  }

  // ── Maintenance risk ─────────────────────────────────────────────────────

  if (input.outOfServiceCount > 0) {
    risks.push({
      riskType: "maintenance",
      severity: demand.totalForecastCovers > 80 ? "high" : "medium",
      title: `${input.outOfServiceCount} equipment item${input.outOfServiceCount > 1 ? "s" : ""} down`,
      description: "Out-of-service equipment reduces kitchen capacity.",
      recommendedAction: "Confirm workarounds or escalate with contractors",
    });
  }

  if (input.maintenanceUrgent > 0) {
    risks.push({
      riskType: "maintenance",
      severity: "high",
      title: `${input.maintenanceUrgent} urgent maintenance issue${input.maintenanceUrgent > 1 ? "s" : ""}`,
      description: "Urgent equipment issues that need resolution before service.",
      recommendedAction: "Contact contractors and resolve before the lunch rush",
    });
  }

  // ── Service bottleneck risk ──────────────────────────────────────────────

  if (demand.totalForecastCovers > 150) {
    risks.push({
      riskType: "service",
      severity: "high",
      title: "Very high cover count expected",
      description: `${demand.totalForecastCovers} covers forecast — near or above capacity.`,
      recommendedAction: "Pre-brief team, confirm table turn plan, consider reservation cap",
    });
  } else if (demand.totalForecastCovers > 100) {
    risks.push({
      riskType: "service",
      severity: "medium",
      title: "High cover volume expected",
      description: `${demand.totalForecastCovers} covers forecast — requires active floor management.`,
      recommendedAction: "Hold pre-service briefing and assign sections clearly",
    });
  }

  // ── Revenue risk ─────────────────────────────────────────────────────────

  if (input.salesTarget != null) {
    const gapPct = ((demand.totalForecastSales - input.salesTarget) / input.salesTarget) * 100;
    if (gapPct < -15) {
      risks.push({
        riskType: "revenue",
        severity: "high",
        title: "Forecast significantly below target",
        description: `Sales forecast is ${Math.abs(Math.round(gapPct))}% below target.`,
        recommendedAction: "Activate promos, push walk-in conversion, confirm pending bookings",
      });
    } else if (gapPct < -5) {
      risks.push({
        riskType: "revenue",
        severity: "medium",
        title: "Forecast slightly below target",
        description: `Sales forecast is ${Math.abs(Math.round(gapPct))}% below target.`,
        recommendedAction: "Focus on upselling and walk-in conversion during service",
      });
    }
  }

  // ── Compute overall score ────────────────────────────────────────────────

  const overallScore = computeOverallRiskScore(risks);
  const overallLevel = scoreToLevel(overallScore);

  return { overallScore, overallLevel, risks };
}

function severityScore(s: RiskSeverity): number {
  switch (s) {
    case "critical": return 30;
    case "high":     return 20;
    case "medium":   return 10;
    case "low":      return 5;
  }
}

function computeOverallRiskScore(risks: RiskItem[]): number {
  if (risks.length === 0) return 0;
  const total = risks.reduce((sum, r) => sum + severityScore(r.severity), 0);
  return Math.min(100, total);
}

function scoreToLevel(score: number): RiskSeverity {
  if (score >= 60) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}
