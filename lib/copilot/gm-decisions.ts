/**
 * GM Decision Engine
 *
 * generateGMDecisions(input) → GMDecision[]
 *
 * The heart of the co-pilot. Generates ranked, executable decisions
 * with direct instructions, consequences, and ownership.
 *
 * Priority: service → revenue → labour → bookings → compliance → maintenance → data
 */

import type {
  GMDecision,
  GMDecisionCategory,
  GMDecisionSeverity,
  GMActionType,
  ServiceWindow,
  ConfidenceType,
} from "./types";
import type { ServiceState } from "./types";
import { windowUrgencyMultiplier, isPeakWindow, isRevenueWindow } from "./service-window";

export interface DecisionInput {
  serviceWindow: ServiceWindow;
  serviceState: ServiceState;
  revenueActual: number;
  revenueTarget: number;
  revenueGap: number;
  labourPercent: number;
  targetLabourPercent: number;
  activeStaff: number | null;
  covers: number;
  forecastCovers: number;
  avgSpend: number;
  targetAvgSpend: number;
  bookingsToday: number;
  bookedCovers: number;
  walkInCovers: number;
  maintenanceUrgent: number;
  maintenanceServiceBlocking: boolean;
  complianceExpired: number;
  complianceDueSoon: number;
  salesAgeMinutes: number | null;
  labourAgeMinutes: number | null;
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `gmd-${_idCounter}`;
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function confidence(ageMinutes: number | null, threshold = 120): ConfidenceType {
  if (ageMinutes == null) return "estimated";
  return ageMinutes < threshold ? "measured" : "inferred";
}

// ── Category priority for sorting ────────────────────────────────────────────

const CAT_PRIORITY: Record<GMDecisionCategory, number> = {
  service: 1,
  revenue: 2,
  labour: 3,
  bookings: 4,
  compliance: 5,
  maintenance: 6,
  data: 7,
};

const SEV_WEIGHT: Record<GMDecisionSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function generateGMDecisions(input: DecisionInput): GMDecision[] {
  _idCounter = 0;
  const decisions: GMDecision[] = [];
  const urgMult = windowUrgencyMultiplier(input.serviceWindow);
  const isPeak = isPeakWindow(input.serviceWindow);
  const isRevWin = isRevenueWindow(input.serviceWindow);

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE DECISIONS (priority 1)
  // ═══════════════════════════════════════════════════════════════════════════

  // S1: Low floor energy during revenue window
  if (
    (input.serviceState.energyLevel === "low" || input.serviceState.energyLevel === "critical") &&
    isRevWin
  ) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "service",
      title: "Floor energy critically low",
      directInstruction: "Reposition strongest server to high-traffic zone now",
      whyItMatters: "Low energy suppresses guest engagement and spend",
      expectedImpactText: "Lift avg spend 10-15% through active floor presence",
      expectedImpactValue: Math.round(input.avgSpend * input.covers * 0.12),
      dueAt: "now",
      owner: "Shift Lead",
      severity: input.serviceState.energyLevel === "critical" ? "critical" : "high",
      status: "pending",
      consequenceIfIgnored: "Guests under-served → lower spend, weaker reviews, lost repeat visits",
      actionType: "reposition_staff",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: "inferred",
    });
  }

  // S2: Weak upsell execution
  if (
    (input.serviceState.upsellStrength === "weak" || input.serviceState.upsellStrength === "none") &&
    input.covers > 3
  ) {
    const liftPerCover = Math.max(0, input.targetAvgSpend - input.avgSpend);
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "service",
      title: "Upsell execution weak",
      directInstruction: "Push starters, sides, desserts, and premium drinks on every table",
      whyItMatters: `Average spend R${input.avgSpend.toFixed(0)} vs target R${input.targetAvgSpend.toFixed(0)}`,
      expectedImpactText: `+${rands(liftPerCover)} per cover remaining`,
      expectedImpactValue: Math.round(liftPerCover * Math.max(1, input.forecastCovers - input.covers)),
      dueAt: "now",
      owner: "FOH Manager",
      severity: input.serviceState.upsellStrength === "none" ? "critical" : "high",
      status: "pending",
      consequenceIfIgnored: "Revenue gap widens with every table served without suggestive selling",
      actionType: "push_upsell",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: "measured",
    });
  }

  // S3: Low walk-in conversion
  if (input.serviceState.conversionRate === "low" || input.serviceState.conversionRate === "critical") {
    if (isRevWin) {
      decisions.push({
        id: nextId(),
        priorityRank: 0,
        category: "service",
        title: "Walk-in conversion critically low",
        directInstruction: "Position host at entrance, activate walk-in signage, menu visible outside",
        whyItMatters: "Foot traffic not converting — leaving revenue on the pavement",
        expectedImpactText: `Each extra walk-in 2-top adds ~${rands(input.avgSpend * 2)}`,
        expectedImpactValue: Math.round(input.avgSpend * 4),
        dueAt: "now",
        owner: "FOH Manager",
        severity: "high",
        status: "pending",
        consequenceIfIgnored: "Continued cover shortfall vs forecast",
        actionType: "push_walk_ins",
        serviceWindowRelevance: input.serviceWindow,
        confidenceType: "inferred",
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVENUE DECISIONS (priority 2)
  // ═══════════════════════════════════════════════════════════════════════════

  // R1: Major revenue gap during peak
  if (input.revenueGap > 0 && input.revenueGap > input.revenueTarget * 0.15 && isRevWin) {
    const dueTime = isPeak ? "now" : "14:00";
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "revenue",
      title: `Recover ${rands(input.revenueGap)} before ${isPeak ? "peak ends" : "14:00"}`,
      directInstruction: "Activate revenue recovery: upsell, extend tables, push walk-ins",
      whyItMatters: `Store is ${rands(input.revenueGap)} behind target with ${isPeak ? "peak underway" : "peak approaching"}`,
      expectedImpactText: `Recover up to ${rands(input.revenueGap * 0.3)} through active intervention`,
      expectedImpactValue: Math.round(input.revenueGap * 0.3),
      dueAt: dueTime,
      owner: "GM",
      severity: input.revenueGap > input.revenueTarget * 0.3 ? "critical" : "high",
      status: "pending",
      consequenceIfIgnored: `Today's target will be missed by ${rands(input.revenueGap)}+`,
      actionType: "extend_service",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: confidence(input.salesAgeMinutes),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LABOUR DECISIONS (priority 3)
  // ═══════════════════════════════════════════════════════════════════════════

  // L1: Labour overspend
  if (input.labourPercent > input.targetLabourPercent + 5) {
    const overspend = input.labourPercent - input.targetLabourPercent;
    const savingEstimate = Math.round(input.revenueActual * overspend / 100);
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "labour",
      title: `Cut 1 FOH position now — labour at ${input.labourPercent.toFixed(1)}%`,
      directInstruction: overspend > 10
        ? "Release lowest-performing FOH team member immediately"
        : "Reduce overlap — end earliest shift now",
      whyItMatters: `Labour ${overspend.toFixed(1)}pp above target, costing ~${rands(savingEstimate)} today`,
      expectedImpactText: `Save ${rands(savingEstimate)} in labour cost`,
      expectedImpactValue: savingEstimate,
      dueAt: "now",
      owner: "Shift Lead",
      severity: overspend > 15 ? "critical" : overspend > 8 ? "high" : "medium",
      status: "pending",
      consequenceIfIgnored: "Labour cost erodes already-low revenue margin",
      actionType: "cut_shift",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: confidence(input.labourAgeMinutes),
    });
  }

  // L2: Labour too low during peak build
  if (
    input.labourPercent < 20 &&
    input.activeStaff != null && input.activeStaff < 4 &&
    (input.serviceWindow === "lunch_build" || input.serviceWindow === "dinner_build")
  ) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "labour",
      title: "Understaffed for upcoming peak",
      directInstruction: "Call in additional FOH cover or extend current shift",
      whyItMatters: "Insufficient staff will tank service quality during peak",
      expectedImpactText: "Protect service execution and guest experience",
      expectedImpactValue: null,
      dueAt: "now",
      owner: "GM",
      severity: "high",
      status: "pending",
      consequenceIfIgnored: "Peak service collapses → lower spend, complaints, lost revenue",
      actionType: "reposition_staff",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: "measured",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING DECISIONS (priority 4)
  // ═══════════════════════════════════════════════════════════════════════════

  // B1: Pending bookings not confirmed
  if (input.bookingsToday > 0 && input.bookedCovers < input.bookingsToday * 2) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "bookings",
      title: "Call pending bookings in the next 15 minutes",
      directInstruction: `Confirm attendance for all ${input.bookingsToday} bookings — no-show risk detected`,
      whyItMatters: `Only ${input.bookedCovers} covers against ${input.bookingsToday} bookings`,
      expectedImpactText: `Each confirmed 2-top = +${rands(input.avgSpend * 2)}`,
      expectedImpactValue: Math.round(input.avgSpend * 2 * 2),
      dueAt: "15min",
      owner: "FOH Manager",
      severity: input.bookingsToday > 5 ? "high" : "medium",
      status: "pending",
      consequenceIfIgnored: "No-shows create empty tables during peak",
      actionType: "call_bookings",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: "measured",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLIANCE DECISIONS (priority 5)
  // ═══════════════════════════════════════════════════════════════════════════

  if (input.complianceExpired > 0) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "compliance",
      title: `${input.complianceExpired} expired compliance item${input.complianceExpired > 1 ? "s" : ""} — regulatory risk`,
      directInstruction: "Start renewal process immediately",
      whyItMatters: "Operating with expired compliance exposes the business to closure",
      expectedImpactText: "Prevent potential R50,000+ fine or forced closure",
      expectedImpactValue: 50000,
      dueAt: "today",
      owner: "GM",
      severity: "critical",
      status: "pending",
      consequenceIfIgnored: "Inspection or audit will result in fine or shutdown order",
      actionType: "start_renewal",
      serviceWindowRelevance: null,
      confidenceType: "measured",
    });
  }

  if (input.complianceDueSoon > 0 && input.complianceExpired === 0) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "compliance",
      title: `${input.complianceDueSoon} compliance renewal${input.complianceDueSoon > 1 ? "s" : ""} due soon`,
      directInstruction: "Schedule renewals this week to prevent expiry",
      whyItMatters: "Proactive renewal avoids last-minute scramble and risk gaps",
      expectedImpactText: "Maintain full compliance coverage",
      expectedImpactValue: null,
      dueAt: "this_week",
      owner: "GM",
      severity: "medium",
      status: "pending",
      consequenceIfIgnored: "Items will expire and become critical",
      actionType: "start_renewal",
      serviceWindowRelevance: null,
      confidenceType: "measured",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAINTENANCE DECISIONS (priority 6)
  // ═══════════════════════════════════════════════════════════════════════════

  if (input.maintenanceServiceBlocking) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "maintenance",
      title: "Service-blocking maintenance issue — escalate now",
      directInstruction: "Escalate to facilities and get emergency resolution timeline",
      whyItMatters: "Equipment failure is directly blocking service capacity",
      expectedImpactText: "Restore full service capability",
      expectedImpactValue: null,
      dueAt: "now",
      owner: "GM",
      severity: "critical",
      status: "pending",
      consequenceIfIgnored: "Continued service disruption and revenue loss",
      actionType: "escalate_issue",
      serviceWindowRelevance: input.serviceWindow,
      confidenceType: "measured",
    });
  } else if (input.maintenanceUrgent > 0) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "maintenance",
      title: `${input.maintenanceUrgent} urgent maintenance issue${input.maintenanceUrgent > 1 ? "s" : ""} open`,
      directInstruction: "Assign and get resolution timeline today",
      whyItMatters: "Unresolved urgent issues escalate to service-blocking",
      expectedImpactText: "Prevent escalation to service disruption",
      expectedImpactValue: null,
      dueAt: "today",
      owner: "Shift Lead",
      severity: "high",
      status: "pending",
      consequenceIfIgnored: "Issue will escalate and may block service",
      actionType: "inspect_issue",
      serviceWindowRelevance: null,
      confidenceType: "measured",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA DECISIONS (priority 7)
  // ═══════════════════════════════════════════════════════════════════════════

  const staleFlags: string[] = [];
  if (input.salesAgeMinutes != null && input.salesAgeMinutes > 480) staleFlags.push("sales");
  if (input.labourAgeMinutes != null && input.labourAgeMinutes > 480) staleFlags.push("labour");

  if (staleFlags.length > 0) {
    decisions.push({
      id: nextId(),
      priorityRank: 0,
      category: "data",
      title: `Stale data: ${staleFlags.join(", ")} — decisions degraded`,
      directInstruction: `Sync ${staleFlags.join(" and ")} data now`,
      whyItMatters: "Decisions based on partial data — operating blind",
      expectedImpactText: "Restore decision accuracy",
      expectedImpactValue: null,
      dueAt: "now",
      owner: "GM",
      severity: staleFlags.length >= 2 ? "high" : "medium",
      status: "pending",
      consequenceIfIgnored: "Will continue operating on stale information",
      actionType: "sync_data",
      serviceWindowRelevance: null,
      confidenceType: "measured",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RANK decisions by severity + category priority + window urgency
  // ═══════════════════════════════════════════════════════════════════════════

  decisions.sort((a, b) => {
    const aScore = SEV_WEIGHT[a.severity] * urgMult + (10 - CAT_PRIORITY[a.category]);
    const bScore = SEV_WEIGHT[b.severity] * urgMult + (10 - CAT_PRIORITY[b.category]);
    return bScore - aScore;
  });

  // Assign ranks
  decisions.forEach((d, i) => {
    d.priorityRank = i + 1;
  });

  return decisions;
}
