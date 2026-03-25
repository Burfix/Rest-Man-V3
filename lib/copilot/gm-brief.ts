/**
 * GM Brief Engine
 *
 * generateGMBrief(storeId, now) → GMBrief
 *
 * Produces the top-level operational briefing a GM needs.
 * Thinks by service window. Speaks in direct operational language.
 */

import type { GMBrief, GMDecision, UrgencyState, ServiceWindow } from "./types";
import type { ServiceState } from "./types";
import type { ServiceRevenueImpact } from "./types";
import { getServiceWindow, isPeakWindow, isRevenueWindow } from "./service-window";

export interface BriefInput {
  serviceWindow: ServiceWindow;
  serviceState: ServiceState;
  serviceImpact: ServiceRevenueImpact;
  revenueActual: number;
  revenueTarget: number;
  labourPercent: number;
  coversActual: number;
  coversForecast: number;
  avgSpend: number;
  stockRisks: number;
  maintenanceUrgent: number;
  complianceExpired: number;
  decisions: GMDecision[];
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

export function generateGMBrief(input: BriefInput): GMBrief {
  const {
    serviceWindow, serviceState, serviceImpact,
    revenueActual, revenueTarget, labourPercent,
    coversActual, coversForecast, avgSpend,
    stockRisks, maintenanceUrgent, complianceExpired,
    decisions,
  } = input;

  const revenueGap = Math.max(0, revenueTarget - revenueActual);
  const windowInfo = getServiceWindow(new Date());
  const isPeak = isPeakWindow(serviceWindow);
  const isRevWindow = isRevenueWindow(serviceWindow);

  // ── Urgency ──────────────────────────────────────────────────────────────

  const criticalIssues = decisions.filter(d => d.severity === "critical").length;
  const highIssues = decisions.filter(d => d.severity === "high").length;

  let urgencyState: UrgencyState;
  if (criticalIssues >= 2 || (criticalIssues >= 1 && revenueGap > revenueTarget * 0.3)) {
    urgencyState = "critical";
  } else if (criticalIssues >= 1 || highIssues >= 2 || revenueGap > revenueTarget * 0.2) {
    urgencyState = "urgent";
  } else if (highIssues >= 1 || revenueGap > revenueTarget * 0.1) {
    urgencyState = "attention";
  } else {
    urgencyState = "on_track";
  }

  // ── Headline ─────────────────────────────────────────────────────────────

  let headline: string;
  if (urgencyState === "critical") {
    if (serviceState.serviceRiskLevel === "critical" || serviceState.serviceRiskLevel === "high") {
      headline = "Service and revenue at risk";
    } else {
      headline = `Revenue recovery required — ${rands(revenueGap)} gap`;
    }
  } else if (urgencyState === "urgent") {
    if (isPeak) {
      headline = `${windowInfo.label} underperforming — act now`;
    } else {
      headline = `Recover ${rands(revenueGap)} before end of day`;
    }
  } else if (urgencyState === "attention") {
    headline = `${windowInfo.label} needs attention`;
  } else {
    headline = "Operations on track — maintain execution";
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  const pieces: string[] = [];
  if (revenueGap > 0 && isRevWindow) {
    pieces.push(`Revenue ${rands(revenueGap)} behind target`);
  }
  if (labourPercent > 35) {
    pieces.push(`labour at ${labourPercent.toFixed(1)}%`);
  }
  if (serviceState.serviceRiskLevel === "critical" || serviceState.serviceRiskLevel === "high") {
    pieces.push("service signals are weak");
  }
  if (stockRisks > 0) {
    pieces.push(`${stockRisks} stock risk${stockRisks > 1 ? "s" : ""}`);
  }
  if (maintenanceUrgent > 0) {
    pieces.push(`${maintenanceUrgent} urgent maintenance issue${maintenanceUrgent > 1 ? "s" : ""}`);
  }
  if (complianceExpired > 0) {
    pieces.push(`${complianceExpired} expired compliance item${complianceExpired > 1 ? "s" : ""}`);
  }

  const summary = pieces.length > 0
    ? capitalize(pieces.join(", ")) + "."
    : "All key metrics within range.";

  // ── Service risk summary ────────────────────────────────────────────────

  const serviceRiskSummary: string[] = [];
  if (serviceState.energyLevel === "low" || serviceState.energyLevel === "critical") {
    serviceRiskSummary.push("Low floor energy");
  }
  if (serviceState.upsellStrength === "weak" || serviceState.upsellStrength === "none") {
    serviceRiskSummary.push("Weak upsell execution");
  }
  if (serviceState.conversionRate === "low" || serviceState.conversionRate === "critical") {
    serviceRiskSummary.push("Low walk-in conversion");
  }
  if (serviceState.signals.tableTurnRate < 0.8) {
    serviceRiskSummary.push("Slow table turns");
  }
  if (serviceState.signals.bookingConversionRate < 0.65) {
    serviceRiskSummary.push("Low booking arrival rate");
  }

  // ── Consequence ──────────────────────────────────────────────────────────

  let consequenceIfIgnored: string;
  if (urgencyState === "critical") {
    consequenceIfIgnored = `Store will miss today's target by ${rands(revenueGap)}+. Service quality will compound revenue loss.`;
  } else if (urgencyState === "urgent") {
    consequenceIfIgnored = `Risk of missing target. ${serviceImpact.estimatedRevenueLoss > 0 ? `Service drag estimated at ${rands(serviceImpact.estimatedRevenueLoss)}.` : ""}`;
  } else if (urgencyState === "attention") {
    consequenceIfIgnored = "Performance trending down. Early intervention prevents escalation.";
  } else {
    consequenceIfIgnored = "No immediate risk. Maintain current execution.";
  }

  return {
    serviceWindow,
    urgencyState,
    headline,
    summary,
    todayTarget: revenueTarget,
    actualRevenue: revenueActual,
    revenueGap,
    labourPercent,
    coversActual,
    coversForecast,
    avgSpend,
    stockRisks,
    criticalIssues: criticalIssues + maintenanceUrgent + complianceExpired,
    serviceRiskSummary,
    topThreeActions: decisions.slice(0, 3),
    consequenceIfIgnored,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
