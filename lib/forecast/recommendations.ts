/**
 * lib/forecast/recommendations.ts — Rule-based recommendation engine
 *
 * Generates prioritised, actionable recommendations based on
 * forecast data, operational signals, and venue state.
 */

import { RISK } from "@/lib/constants";
import type {
  ForecastInput,
  GMActionRecommendation,
  DemandSnapshot,
  LabourGuidance,
  RecommendationCategory,
  ForecastPriority,
} from "@/types/forecast";

/**
 * Generate ranked operational recommendations from forecast inputs + demand snapshot.
 */
export function generateRecommendations(
  input: ForecastInput,
  demand: DemandSnapshot,
  labour: LabourGuidance,
): GMActionRecommendation[] {
  const recs: GMActionRecommendation[] = [];

  // ── Staffing ─────────────────────────────────────────────────────────────

  if (labour.status === "above_target" && input.latestLabourPct != null) {
    recs.push(rec("staffing",
      input.latestLabourPct > RISK.LABOR_HIGH_PCT ? "high" : "medium",
      "Review staffing before service",
      `Labour cost is at ${input.latestLabourPct.toFixed(1)}% of revenue. Consider adjusting tonight's roster to bring costs in line.`,
      "Labour percentage is above the target threshold",
      "Reducing one shift could save ~R800–R1,200 on a mid-week evening",
    ));
  }

  if (demand.totalForecastCovers > 100 && input.latestLabourPct == null) {
    recs.push(rec("staffing", "medium",
      "Check staffing for busy forecast",
      `Forecast of ${demand.totalForecastCovers} covers suggests a busy day. Ensure the roster has enough floor and kitchen capacity.`,
      "High cover forecast without confirmed labour data",
      "Adequate staffing prevents service slowdowns and protects review scores",
    ));
  }

  if (demand.peakHourSales > demand.totalForecastSales * 0.20) {
    const peakPct = Math.round((demand.peakHourSales / demand.totalForecastSales) * 100);
    recs.push(rec("staffing", "medium",
      `Prepare for a sharp ${demand.peakWindow} rush`,
      `${peakPct}% of today's revenue is expected in a ${demand.peakWindow} window. Pre-position staff and brief the kitchen before the rush.`,
      "Concentrated demand window creates service pressure",
      "Pre-rush preparation reduces ticket times by 15–20%",
    ));
  }

  // ── Revenue / Sales gap ──────────────────────────────────────────────────

  if (input.salesTarget != null && demand.totalForecastSales < input.salesTarget) {
    const gap = input.salesTarget - demand.totalForecastSales;
    const gapPct = Math.round((gap / input.salesTarget) * 100);
    const extraCovers = demand.forecastAvgSpend > 0
      ? Math.ceil(gap / demand.forecastAvgSpend)
      : 0;

    recs.push(rec("revenue",
      gapPct > 15 ? "high" : "medium",
      "Close the revenue gap",
      `Forecast is R${formatK(gap)} below today's target. You need approximately ${extraCovers} additional covers at R${demand.forecastAvgSpend} avg spend to close the gap.`,
      `Sales forecast is ${gapPct}% below the daily target`,
      "Focus on walk-in conversion and confirming pending bookings",
    ));
  }

  if (demand.forecastAvgSpend < 200 && demand.totalForecastCovers > 20) {
    recs.push(rec("revenue", "medium",
      "Drive average spend per cover",
      "Forecast spend per cover is below R200. Activate floor staff to recommend wines, sharing plates, and cocktails to lift revenue per guest.",
      "Average spend is below the venue's typical range",
      "Even R30 extra per cover across 80 guests adds R2,400 to the day",
    ));
  }

  // ── Compliance ───────────────────────────────────────────────────────────

  if (input.complianceExpired > 0) {
    recs.push(rec("compliance", "urgent",
      `${input.complianceExpired} compliance item${input.complianceExpired > 1 ? "s" : ""} expired`,
      "Expired compliance certificates create regulatory risk. Schedule renewals immediately and confirm with your service provider.",
      "Expired items are active compliance breaches",
      "Resolving these eliminates risk of regulatory penalties or forced closure",
    ));
  }

  if (input.complianceDueSoon > 0) {
    recs.push(rec("compliance", "high",
      `${input.complianceDueSoon} compliance renewal${input.complianceDueSoon > 1 ? "s" : ""} due soon`,
      "These items are approaching their expiry date. Book renewal appointments now to avoid gaps in compliance.",
      "Certificates are within the 30-day due-soon window",
      "Proactive scheduling prevents last-minute rushes and potential lapses",
    ));
  }

  // ── Maintenance ──────────────────────────────────────────────────────────

  if (input.maintenanceUrgent > 0) {
    recs.push(rec("maintenance",
      demand.totalForecastCovers > 80 ? "urgent" : "high",
      `${input.maintenanceUrgent} urgent maintenance issue${input.maintenanceUrgent > 1 ? "s" : ""}`,
      `Urgent equipment issues on a day forecast for ${demand.totalForecastCovers} covers. Escalate with contractors before the lunch rush.`,
      "Unresolved maintenance during high-demand periods increases service failure risk",
      "Clearing urgent maintenance before service protects kitchen throughput",
    ));
  }

  if (input.outOfServiceCount > 0) {
    recs.push(rec("maintenance", "high",
      `${input.outOfServiceCount} equipment item${input.outOfServiceCount > 1 ? "s" : ""} out of service`,
      "Out-of-service equipment reduces kitchen capacity. Check if workarounds are in place or if you need to adjust the menu offering.",
      "Equipment downtime directly impacts service capacity",
      "Kitchen backup plans prevent bottlenecks during peak",
    ));
  }

  // ── Prep ─────────────────────────────────────────────────────────────────

  if (demand.totalForecastCovers > 60) {
    recs.push(rec("prep", "medium",
      "Complete prep before the lunch rush",
      `With ${demand.totalForecastCovers} covers expected, ensure all mise en place is completed before 11am. Focus on high-volume items first.`,
      "Moderate-to-high cover forecast needs advance preparation",
      "Completed prep reduces ticket times and prevents mid-service scrambles",
    ));
  }

  if (input.eventName) {
    recs.push(rec("prep", "high",
      `Prep for "${input.eventName}" event`,
      `Tonight's "${input.eventName}" typically drives ${Math.round((input.eventMultiplier - 1) * 100)}% uplift. Increase prep volumes for high-demand items and brief the floor team on event flow.`,
      `${input.eventName} historically lifts both covers and spend`,
      "Event-specific prep prevents stock-outs on peak items",
    ));
  }

  // ── Promo ────────────────────────────────────────────────────────────────

  if (input.salesTarget != null && demand.totalForecastSales < input.salesTarget * 0.85 && !input.eventName) {
    recs.push(rec("promo", "medium",
      "Consider activating a promotion",
      "Forecast trade is below target and no event is scheduled. A lunch special or happy hour push could drive incremental walk-in traffic.",
      "Forecast revenue gap without event support",
      "A targeted promo could lift covers by 10–15% for the slower period",
    ));
  }

  // ── Service ──────────────────────────────────────────────────────────────

  if (demand.totalForecastCovers > 120) {
    recs.push(rec("service", "high",
      "High-volume service day — brief the team",
      `${demand.totalForecastCovers} covers expected. Hold a pre-service briefing covering table turn targets, upsell focus items, and allergen awareness.`,
      "High-cover days require proactive service management",
      "Pre-service briefings reduce errors and improve guest experience on busy days",
    ));
  }

  // Sort by priority weight
  return recs.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function rec(
  category: RecommendationCategory,
  priority: ForecastPriority,
  title: string,
  description: string,
  operationalReason: string,
  expectedImpact: string,
): GMActionRecommendation {
  return { category, priority, title, description, operationalReason, expectedImpact };
}

function priorityWeight(p: ForecastPriority): number {
  switch (p) {
    case "urgent": return 4;
    case "high":   return 3;
    case "medium": return 2;
    case "low":    return 1;
  }
}

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}
