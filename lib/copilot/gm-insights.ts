/**
 * GM Insights Engine (Pattern + Cause Detection)
 *
 * generateGMInsights(input) → GMInsight[]
 *
 * Detects operational patterns and their likely causes.
 * Outputs are explainable and operationally grounded.
 */

import type { GMInsight, ConfidenceType, GMDecisionCategory } from "./types";

export interface InsightInput {
  revenueActual: number;
  revenueTarget: number;
  revenueVariancePercent: number;
  avgSpend: number;
  targetAvgSpend: number;
  covers: number;
  forecastCovers: number;
  labourPercent: number;
  targetLabourPercent: number;
  activeStaff: number | null;
  bookingsToday: number;
  bookedCovers: number;
  walkInCovers: number;
  criticalStockCount: number;
  lowStockCount: number;
  noPOCount: number;
  maintenanceOpen: number;
  maintenanceUrgent: number;
  maintenanceRepeatIssues: number;
  complianceExpired: number;
  complianceDueSoon: number;
  salesAgeMinutes: number | null;
  labourAgeMinutes: number | null;
  floorEnergyScore: number;
  upsellRate: number;         // avgSpend / targetAvgSpend ratio
  walkInConversionRate: number;
  tableTurnRate: number;
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function generateGMInsights(input: InsightInput): GMInsight[] {
  const insights: GMInsight[] = [];

  // ── 1. Revenue behind trend ──────────────────────────────────────────────
  if (input.revenueVariancePercent < -10) {
    const gap = Math.abs(input.revenueTarget - input.revenueActual);
    insights.push({
      detectedPattern: `Revenue ${rands(gap)} behind target (${Math.abs(input.revenueVariancePercent).toFixed(0)}% gap)`,
      likelyCause: input.floorEnergyScore < 50
        ? "Weak service execution is suppressing guest spend and cover conversion"
        : input.covers < input.forecastCovers * 0.5
          ? "Cover count well below forecast — demand or conversion issue"
          : "Multiple factors contributing to revenue underperformance",
      recommendedAction: gap > 5000
        ? "Activate revenue recovery: push upsells, call pending bookings, deploy strongest server"
        : "Monitor closely and push upsell on remaining covers",
      expectedImpact: `Recover up to ${rands(gap * 0.3)} through service intervention`,
      confidenceType: input.salesAgeMinutes != null && input.salesAgeMinutes < 120 ? "measured" : "inferred",
      category: "revenue",
    });
  }

  // ── 2. Labour overspend ──────────────────────────────────────────────────
  if (input.labourPercent > input.targetLabourPercent + 5) {
    const overspend = input.labourPercent - input.targetLabourPercent;
    insights.push({
      detectedPattern: `Labour at ${input.labourPercent.toFixed(1)}% — ${overspend.toFixed(1)}pp above target`,
      likelyCause: input.covers < input.forecastCovers * 0.6
        ? "Low covers with full staffing creating inefficiency"
        : input.activeStaff != null && input.activeStaff > 8
          ? "Team size exceeds demand for this service window"
          : "Revenue underperformance making fixed labour cost disproportionate",
      recommendedAction: overspend > 10
        ? "Cut 1 FOH position now"
        : "Review shift handoff — reduce overlap staffing",
      expectedImpact: `Save ${rands(input.revenueActual * overspend / 100)} on labour today`,
      confidenceType: input.labourAgeMinutes != null && input.labourAgeMinutes < 120 ? "measured" : "estimated",
      category: "labour",
    });
  }

  // ── 3. Weak booking conversion ──────────────────────────────────────────
  if (input.bookingsToday > 0 && input.bookedCovers < input.bookingsToday * 2) {
    insights.push({
      detectedPattern: `${input.bookingsToday} bookings with only ${input.bookedCovers} covers arriving`,
      likelyCause: "Booking no-shows or small party sizes reducing expected volume",
      recommendedAction: "Call all pending bookings in the next 15 minutes to confirm attendance",
      expectedImpact: `Each confirmed 2-top adds ~${rands(input.avgSpend * 2)}`,
      confidenceType: "measured",
      category: "bookings",
    });
  }

  // ── 4. Low stock without PO ─────────────────────────────────────────────
  if (input.noPOCount > 0) {
    insights.push({
      detectedPattern: `${input.noPOCount} low-stock item${input.noPOCount > 1 ? "s" : ""} with no purchase order`,
      likelyCause: "Reorder not triggered or supplier not contacted",
      recommendedAction: `Place orders before 16:00 to protect tomorrow`,
      expectedImpact: "Prevent stockout and menu disruption",
      confidenceType: "measured",
      category: "inventory",
    });
  }

  // ── 5. Critical stock ───────────────────────────────────────────────────
  if (input.criticalStockCount > 0) {
    insights.push({
      detectedPattern: `${input.criticalStockCount} item${input.criticalStockCount > 1 ? "s" : ""} at critical stock level`,
      likelyCause: "Consumption exceeded forecast or delivery missed",
      recommendedAction: "Emergency order or 86 affected dishes before guest complaints",
      expectedImpact: "Protect service quality and prevent revenue loss from unavailable items",
      confidenceType: "measured",
      category: "inventory",
    });
  }

  // ── 6. Repeat maintenance failures ──────────────────────────────────────
  if (input.maintenanceRepeatIssues > 0) {
    insights.push({
      detectedPattern: `${input.maintenanceRepeatIssues} recurring maintenance issue${input.maintenanceRepeatIssues > 1 ? "s" : ""}`,
      likelyCause: "Root cause not resolved — patching instead of fixing",
      recommendedAction: "Escalate to facilities manager with replacement recommendation",
      expectedImpact: "Eliminate recurring cost and service disruption",
      confidenceType: "inferred",
      category: "maintenance",
    });
  }

  // ── 7. Stale data affecting trust ───────────────────────────────────────
  const staleFlags: string[] = [];
  if (input.salesAgeMinutes != null && input.salesAgeMinutes > 480) staleFlags.push("sales");
  if (input.labourAgeMinutes != null && input.labourAgeMinutes > 480) staleFlags.push("labour");

  if (staleFlags.length > 0) {
    insights.push({
      detectedPattern: `Stale data: ${staleFlags.join(", ")}`,
      likelyCause: "Data sync not running or manual upload overdue",
      recommendedAction: `Sync ${staleFlags.join(" and ")} data now`,
      expectedImpact: "Restore decision accuracy — current signals may not reflect reality",
      confidenceType: "measured",
      category: "data",
    });
  }

  // ── 8. Weak service execution ───────────────────────────────────────────
  if (input.floorEnergyScore < 40) {
    insights.push({
      detectedPattern: "Floor energy critically low",
      likelyCause: input.activeStaff != null && input.activeStaff < 3
        ? "Understaffed — not enough presence on the floor"
        : "Team disengaged or poorly positioned",
      recommendedAction: "Reposition strongest server to high-traffic zone now",
      expectedImpact: "Lift engagement and avg spend by 10-15%",
      confidenceType: "inferred",
      category: "service",
    });
  }

  // ── 9. Poor avg spend ──────────────────────────────────────────────────
  if (input.upsellRate < 0.75 && input.covers > 5) {
    const spendGap = input.targetAvgSpend - input.avgSpend;
    insights.push({
      detectedPattern: `Average spend R${input.avgSpend.toFixed(0)} — ${Math.round((1 - input.upsellRate) * 100)}% below benchmark`,
      likelyCause: "Upsell not being executed —  servers not suggestive selling",
      recommendedAction: "Push upsell: starters, sides/sharing, desserts, premium drinks",
      expectedImpact: `Each R${spendGap.toFixed(0)} lift per cover adds ${rands(spendGap * (input.forecastCovers - input.covers + input.covers))} potential`,
      confidenceType: "measured",
      category: "service",
    });
  }

  // ── 10. Weak walk-in demand conversion ─────────────────────────────────
  if (input.walkInConversionRate < 0.25 && input.covers > 5) {
    insights.push({
      detectedPattern: "Low walk-in capture rate",
      likelyCause: "Street-facing presence weak, no host at door, or menu not visible",
      recommendedAction: "Position host at entrance, activate walk-in signage",
      expectedImpact: `Each extra walk-in 2-top adds ~${rands(input.avgSpend * 2)}`,
      confidenceType: "inferred",
      category: "service",
    });
  }

  // ── 11. Compliance expiry ───────────────────────────────────────────────
  if (input.complianceExpired > 0) {
    insights.push({
      detectedPattern: `${input.complianceExpired} compliance item${input.complianceExpired > 1 ? "s" : ""} expired`,
      likelyCause: "Renewal process not initiated or stalled",
      recommendedAction: "Start renewal immediately — regulatory risk",
      expectedImpact: "Prevent potential closure order or fine",
      confidenceType: "measured",
      category: "compliance",
    });
  }

  return insights;
}
