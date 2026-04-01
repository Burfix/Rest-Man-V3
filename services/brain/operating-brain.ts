/**
 * Operating Brain — Master Orchestrator
 *
 * Answers 6 questions at any moment:
 *   1. What is the biggest risk right now?
 *   2. What should I do first?
 *   3. What happens if I do nothing?
 *   4. Who owns it?
 *   5. How much money is at risk?
 *   6. How long do I have?
 *
 * No circular dependencies — only imports from services, never from components.
 * Degrades gracefully if any data source is unavailable.
 */

import { createServerClient } from "@/lib/supabase/server";
import {
  buildOperationsContext,
  type OperationsContext,
} from "@/services/intelligence/context-builder";
import {
  detectSignals,
  type CrossModuleSignal,
  type SignalSeverity,
} from "@/services/intelligence/signal-detector";
import {
  getPerformanceTier,
} from "@/services/accountability/score-calculator";
import { generateVoice } from "./voice-generator";
import { forecastToday } from "@/services/forecasting/forecast-engine";
import type { SportsEvent } from "@/services/forecasting/events-calendar";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BrainThreatSeverity = "critical" | "high" | "medium" | "low";
export type BrainConfidence = "high" | "medium" | "low";

export type ScoreDriver = {
  module: string;
  reason: string;
  pts: number;
  direction: "up" | "down";
};

export type RecoveryMeter = {
  revenueGap: number;
  recoverable: number;
  timeLeftMinutes: number;
  isOnTrack: boolean;
  limitedWindow: boolean;
  partialOnly: boolean;
  topActions: string[];
};

export type BrainOutput = {
  timestamp: string;
  siteId: string;

  primaryThreat: {
    title: string;
    description: string;
    severity: BrainThreatSeverity;
    modulesInvolved: string[];
    owner: { name: string; role: string; userId: string };
    moneyAtRisk: number;
    timeWindowMinutes: number;
    timeWindowLabel: string;
    ifIgnored: string;
    recommendedAction: string;
    confidence: BrainConfidence;
  };

  actionQueue: Array<{
    priority: number;
    title: string;
    why: string;
    impact: string;
    owner: string;
    estimatedMinutes: number;
    moneyAtRisk: number | null;
    deadline: string | null;
    financialImpact: string | null;
    ownerRole: "Shift Lead" | "GM" | "Head Office";
    escalateTo: "GM" | "Head Office" | "Facilities" | null;
    status: "not_started" | "in_progress" | "completed";
  }>;

  doNothingConsequences: Array<{
    timeframe: string;
    consequence: string;
    financialImpact: number | null;
  }>;

  systemHealth: {
    score: number;
    grade: string;
    trend: "improving" | "stable" | "declining";
    criticalCount: number;
    highCount: number;
    scoreDrivers: ScoreDriver[];
    /** All 5 module drivers in fixed order — used for score breakdown bars */
    allScoreDrivers: ScoreDriver[];
    /** True before 11:00 (first 60 min of service) — show "Day Starting" label */
    isDayStarting: boolean;
    /** True from noon onwards — duty completion is scored from this point */
    isDutyWindow: boolean;
  };

  forecastSummary: {
    projectedClose: number;
    vsTarget: number;
    vsSameDayLastYear: number | null;
    recoverable: boolean;
    recoveryAction: string | null;
    isRamadan: boolean;
    activeEvent: string | null;
    eventUplift: number | null;
    isDayClosed: boolean;
    syncPending: boolean;
    /** True when no trading minutes have elapsed — showing SDLY baseline, not a live projection */
    isPreService: boolean;
  };

  gmSituation: {
    name: string;
    score: number;
    tier: string;
    alertNeeded: boolean;
    alertReason: string | null;
  };

  recoveryMeter: RecoveryMeter | null;

  voiceLine: string;
};

export const BRAIN_FALLBACK: BrainOutput = {
  timestamp: new Date().toISOString(),
  siteId: "",
  primaryThreat: {
    title: "System Initialising",
    description: "Brain is loading operational data. Refresh in 30 seconds.",
    severity: "low",
    modulesInvolved: [],
    owner: { name: "System", role: "system", userId: "" },
    moneyAtRisk: 0,
    timeWindowMinutes: 0,
    timeWindowLabel: "Not applicable",
    ifIgnored: "No data to evaluate yet.",
    recommendedAction: "Wait for data sync to complete.",
    confidence: "low",
  },
  actionQueue: [],
  doNothingConsequences: [],
  systemHealth: {
    score: 0,
    grade: "?",
    trend: "stable",
    criticalCount: 0,
    highCount: 0,
    scoreDrivers: [],
    allScoreDrivers: [],
    isDayStarting: false,
    isDutyWindow: true,
  },
  forecastSummary: {
    projectedClose: 0,
    vsTarget: 0,
    vsSameDayLastYear: null,
    recoverable: true,
    recoveryAction: null,
    isRamadan: false,
    activeEvent: null,
    eventUplift: null,
    isDayClosed: false,
    syncPending: false,
    isPreService: false,
  },
  gmSituation: {
    name: "Unknown",
    score: 0,
    tier: "Unknown",
    alertNeeded: false,
    alertReason: null,
  },
  recoveryMeter: null,
  voiceLine: "Operational data is loading. Check back shortly.",
};

// ── Severity helpers ───────────────────────────────────────────────────────────

const SEV_BASE: Record<SignalSeverity, number> = {
  CRITICAL: 100,
  HIGH:     60,
  MEDIUM:   30,
  INFO:     10,
};

function sevToThreat(sev: SignalSeverity): BrainThreatSeverity {
  if (sev === "CRITICAL") return "critical";
  if (sev === "HIGH")     return "high";
  if (sev === "MEDIUM")   return "medium";
  return "low";
}

function confidenceFromScore(confidence: number): BrainConfidence {
  if (confidence >= 80) return "high";
  if (confidence >= 60) return "medium";
  return "low";
}

// ── Time window estimators ─────────────────────────────────────────────────────

/**
 * Estimate time-to-act in minutes from a signal's timeWindow string + context.
 */
function estimateTimeWindowMinutes(
  timeWindow: string | undefined,
  ctx: OperationsContext,
  hour: number,
): number {
  if (!timeWindow) return 480;
  const tw = timeWindow.toLowerCase();
  if (tw === "immediate")                          return 30;
  if (tw.includes("session end") || tw.includes("until session")) {
    return Math.max(30, (22 - hour) * 60);
  }
  if (tw.includes("this service") || tw.includes("this session")) {
    return Math.max(30, (22 - hour) * 60);
  }
  if (tw.includes("before service") || tw.includes("next service")) {
    if (ctx.meta.timeOfDay === "pre-service") return Math.max(30, (11 - hour) * 60);
    return 18 * 60;
  }
  if (tw.includes("next shift"))         return 8 * 60;
  if (tw.includes("this week") || tw.includes("week")) return 7 * 24 * 60;
  if (tw.includes("today"))              return Math.max(30, (22 - hour) * 60);
  return 480;
}

function timeWindowLabel(minutes: number, timeWindow: string | undefined): string {
  if (!timeWindow || timeWindow === "Immediate") return "Immediate — act now";
  if (minutes <= 30)  return "Next 30 minutes";
  if (minutes <= 60)  return "Next 1 hour";
  if (minutes <= 120) return "Next 2 hours";
  if (minutes <= 240) return "Next 4 hours";
  if (minutes >= 7 * 24 * 60) return "This week";
  return timeWindow;
}

// ── Priority matrix scorer ─────────────────────────────────────────────────────

function scoreSignal(
  sig: CrossModuleSignal,
  ctx: OperationsContext,
  hour: number,
): number {
  let score = SEV_BASE[sig.severity] ?? 10;

  // Money at risk multiplier
  const money = sig.moneyAtRisk ?? 0;
  if (money > 10_000)     score *= 2.0;
  else if (money > 5_000) score *= 1.5;
  else if (money > 1_000) score *= 1.2;

  // Time pressure multiplier
  const mins = estimateTimeWindowMinutes(sig.timeWindow, ctx, hour);
  if (mins < 30)       score *= 2.0;
  else if (mins < 120) score *= 1.5;
  else if (mins < 240) score *= 1.2;

  // Module breadth bonus (+10 per additional module)
  score += (sig.modules.length - 1) * 10;

  return score;
}

// ── System health computation ──────────────────────────────────────────────────

function computeSystemHealth(
  ctx: OperationsContext,
  signals: CrossModuleSignal[],
  minutesElapsed: number,
): BrainOutput["systemHealth"] {
  // ── Revenue: 30 pts ─────────────────────────────────────────────────────
  // Early service (first 3 hours): use prorated target so the score reflects
  // progress relative to elapsed trading time, not the full day.
  const SERVICE_DURATION_MINUTES = 720; // 10:00–22:00
  let revenueVarianceForScore = ctx.revenue.variance;
  if (
    minutesElapsed > 0 &&
    minutesElapsed < 360 &&
    ctx.revenue.target > 0
  ) {
    const proratedTarget = ctx.revenue.target * (minutesElapsed / SERVICE_DURATION_MINUTES);
    revenueVarianceForScore = +(
      (ctx.revenue.actual - proratedTarget) / proratedTarget * 100
    ).toFixed(1);
  }
  const revPts = Math.max(0, Math.min(30, 30 * (1 + revenueVarianceForScore / 100)));

  // Labour: 20 pts (over-target reduces score)
  const labExcess = Math.max(0, ctx.labour.variance);
  const labPts = Math.max(0, 20 * (1 - labExcess / 20));

  // Duty completion: 20 pts
  // Duties are not expected to start in the first 2 hours of the day (before noon).
  // Suppress penalty during this window to avoid false F-grade at 11:30.
  const isDutyWindow = minutesElapsed >= 120;
  const dutyPts = isDutyWindow
    ? (ctx.dailyOps.completionRate / 100) * 20
    : 20; // full credit until duty window opens

  // Maintenance: 15 pts (service-blocking = 0; each urgent removes 4)
  const maintPts = ctx.maintenance.serviceBlocking
    ? 0
    : Math.max(0, 15 - ctx.maintenance.urgentCount * 4);

  // Compliance: 15 pts
  // Any expired/overdue item = full deduction (0/15) — legal/insurance exposure.
  // At-risk items (due soon) = partial deduction.
  const compPts = ctx.compliance.overdueCount > 0
    ? 0
    : Math.max(0, 15 - ctx.compliance.atRiskCount * 7);

  console.log(`[Brain] computeSystemHealth compliance: overdueCount=${ctx.compliance.overdueCount} atRiskCount=${ctx.compliance.atRiskCount} → compPts=${compPts}`);

  const score = Math.round(revPts + labPts + dutyPts + maintPts + compPts);
  let grade =
    score >= 90 ? "A" :
    score >= 80 ? "B" :
    score >= 65 ? "C" :
    score >= 50 ? "D" : "F";

  // Before noon: clamp grade floor at D (duties haven't opened yet)
  if (minutesElapsed < 120 && grade === "F") grade = "D";
  const isDayStarting = minutesElapsed < 60; // before 11:00

  const criticalCount = signals.filter((s) => s.severity === "CRITICAL").length;
  const highCount     = signals.filter((s) => s.severity === "HIGH").length;

  const trend: BrainOutput["systemHealth"]["trend"] =
    ctx.revenue.trend === "recovering" ? "improving" :
    ctx.revenue.trend === "declining"  ? "declining" : "stable";

  // ── Score drivers: top 3 by deviation from maximum ──────────────────────
  const MAX = { REVENUE: 30, LABOUR: 20, DUTIES: 20, MAINTENANCE: 15, COMPLIANCE: 15 };
  const allDrivers: ScoreDriver[] = [
    {
      module:    "REVENUE",
      pts:       Math.round(revPts),
      direction: revPts >= 25 ? "up" : "down",
      reason:    revPts >= 28
        ? `On or above target (+${Math.round(revPts)}/30 pts)`
        : `${Math.abs(revenueVarianceForScore).toFixed(0)}% below target — -${Math.round(MAX.REVENUE - revPts)} pts`,
    },
    {
      module:    "LABOUR",
      pts:       Math.round(labPts),
      direction: labPts >= 17 ? "up" : "down",
      reason:    labPts >= 17
        ? `Labour on budget (+${Math.round(labPts)}/20 pts)`
        : `${ctx.labour.variance.toFixed(1)}% over target — -${Math.round(MAX.LABOUR - labPts)} pts`,
    },
    {
      module:    "DUTIES",
      pts:       Math.round(dutyPts),
      direction: dutyPts >= 16 ? "up" : "down",
      reason:    dutyPts >= 16
        ? `${ctx.dailyOps.completionRate}% complete (+${Math.round(dutyPts)}/20 pts)`
        : `${ctx.dailyOps.completionRate}% complete — -${Math.round(MAX.DUTIES - dutyPts)} pts`,
    },
    {
      module:    "MAINTENANCE",
      pts:       Math.round(maintPts),
      direction: maintPts >= 13 ? "up" : "down",
      reason:    ctx.maintenance.serviceBlocking
        ? `Service blocked — -${MAX.MAINTENANCE} pts`
        : ctx.maintenance.urgentCount > 0
        ? `${ctx.maintenance.urgentCount} urgent issue${ctx.maintenance.urgentCount > 1 ? "s" : ""} — -${Math.round(MAX.MAINTENANCE - maintPts)} pts`
        : `No urgent issues (+${Math.round(maintPts)}/15 pts)`,
    },
    {
      module:    "COMPLIANCE",
      pts:       Math.round(compPts),
      direction: compPts >= 13 ? "up" : "down",
      reason:    ctx.compliance.overdueCount > 0
        ? `${ctx.compliance.overdueCount} expired — legal exposure, 0/15 pts`
        : ctx.compliance.atRiskCount > 0
        ? `${ctx.compliance.atRiskCount} item${ctx.compliance.atRiskCount > 1 ? "s" : ""} at risk — -${15 - Math.round(compPts)} pts`
        : `All items current (+${Math.round(compPts)}/15 pts)`,
    },
  ];

  // Sort by impact on score (biggest losers first, then biggest winners)
  const sortedDrivers = [...allDrivers]
    .sort((a, b) => {
      const lossA = (a.direction === "down" ? 1 : 0) * (30 - a.pts);
      const lossB = (b.direction === "down" ? 1 : 0) * (30 - b.pts);
      if (lossA !== lossB) return lossB - lossA;
      return b.pts - a.pts;
    });
  const scoreDrivers = sortedDrivers.slice(0, 3);

  return { score, grade, trend, criticalCount, highCount, scoreDrivers, allScoreDrivers: allDrivers, isDayStarting, isDutyWindow };
}

// ── Do-nothing consequences ────────────────────────────────────────────────────

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function pct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function buildConsequences(
  signals: CrossModuleSignal[],
  ctx: OperationsContext,
  minutesElapsed: number,
  minutesRemaining: number,
): BrainOutput["doNothingConsequences"] {
  const consequences: BrainOutput["doNothingConsequences"] = [];
  const hoursLeft  = Math.round(minutesRemaining / 60);
  const revGap     = ctx.revenue.target > 0
    ? Math.abs(ctx.revenue.actual - ctx.revenue.target)
    : 0;

  const runRate    = minutesElapsed > 0 ? ctx.revenue.actual / minutesElapsed : 0;
  const projClose  = minutesElapsed > 0
    ? ctx.revenue.actual + runRate * minutesRemaining
    : 0;
  const expectedGap = Math.max(0, ctx.revenue.target - projClose);

  for (const sig of signals.slice(0, 5)) {
    if (
      sig.id === "S1_REVENUE_RECOVERY_WINDOW" ||
      sig.id === "S8_UNEXPLAINED_REVENUE_GAP" ||
      sig.id === "S9_REVENUE_BEHIND_PACE"     ||
      sig.id === "S10_REVENUE_OPS_LAG"
    ) {
      if (hoursLeft > 1) {
        consequences.push({
          timeframe: "In 1 hour",
          consequence: `Revenue gap of ${fmt(revGap)} stays fixed — no passive recovery without active floor effort.`,
          financialImpact: null,
        });
      }
      consequences.push({
        timeframe: "By close",
        consequence: expectedGap > revGap
          ? `Gap widens to ${fmt(expectedGap)} as run rate trails off without intervention.`
          : `Revenue gap of ${fmt(revGap)} locks in as session closes — no recovery path after service ends.`,
        financialImpact: expectedGap > 0 ? expectedGap : revGap,
      });
    }

    if (sig.id === "S2_SERVICE_COLLAPSE_RISK") {
      consequences.push({
        timeframe: "In 30 minutes",
        consequence: "Service disruption compounds. Guest-facing delays accumulate — review score risk increases.",
        financialImpact: null,
      });
      if (revGap > 0) {
        consequences.push({
          timeframe: "By close",
          consequence: `Service disruption sustained throughout service. Revenue gap of ${fmt(revGap)} confirmed with no recovery.`,
          financialImpact: revGap,
        });
      }
    }

    if (sig.id === "S3_LABOUR_EFFICIENCY_ALERT") {
      const labourCost  = ctx.revenue.actual > 0
        ? ctx.revenue.actual * ctx.labour.actualPercent / 100 : 0;
      const targetCost  = ctx.revenue.actual > 0
        ? ctx.revenue.actual * ctx.labour.targetPercent / 100 : 0;
      const excessCost  = Math.max(0, labourCost - targetCost);
      consequences.push({
        timeframe: "By close",
        consequence: `Labour ${pct(ctx.labour.variance)} over target. ${fmt(excessCost)} unnecessary cost confirmed on P&L if no reduction now.`,
        financialImpact: excessCost,
      });
    }

    if (sig.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND") {
      consequences.push({
        timeframe: "Tomorrow",
        consequence: `${ctx.compliance.overdueCount} overdue compliance item${ctx.compliance.overdueCount > 1 ? "s" : ""} + ${ctx.maintenance.urgentCount} urgent maintenance unresolved. Combined audit exposure grows each day.`,
        financialImpact: null,
      });
    }

    if (sig.id === "S6_PRE_SERVICE_LABOUR_SURGE") {
      consequences.push({
        timeframe: "Start of service",
        consequence: `Labour enters service session ${pct(ctx.labour.variance)} over budget with no revenue yet to absorb it.`,
        financialImpact: null,
      });
    }

    if (sig.id === "S7_OPS_MAINTENANCE_OVERLOAD") {
      consequences.push({
        timeframe: "This service",
        consequence: `${ctx.dailyOps.overdue} overdue ops tasks and active maintenance stretches the team. Guest experience degrades.`,
        financialImpact: null,
      });
    }
  }

  // Deduplicate by timeframe
  const seen = new Set<string>();
  return consequences.filter((c) => {
    const key = c.timeframe + c.consequence.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

// ── Contextual fallback threat (no-signal safety net) ─────────────────────────
//
// When no signals fire (edge cases / gap in signal coverage) but the context
// shows real issues, this synthesises a primaryThreat directly from ctx so the
// LEFT column never says "All Systems Nominal" while the voice line says
// "compound risk". Mirrors the same conditions as voice-generator states 11–13.

function buildContextualThreat(
  ctx: OperationsContext,
  systemHealth: BrainOutput["systemHealth"],
  gmOwner: BrainOutput["primaryThreat"]["owner"],
  hour: number,
): BrainOutput["primaryThreat"] {
  const hoursLeft   = Math.max(0, 22 - hour);
  const timeWindowM = Math.max(30, hoursLeft * 60);
  const revGap      = ctx.revenue.target > 0 ? Math.max(0, ctx.revenue.target - ctx.revenue.actual) : 0;
  const isActive    = ctx.meta.timeOfDay !== "closed" && ctx.meta.timeOfDay !== "post-service";

  // Revenue behind + ops lag — mirrors voice state 11 EXACTLY (no timeOfDay gate).
  // Voice state 11 fires on variance < -10 && ops < 70 regardless of service window.
  // primaryThreat must match — if voice says "compound risk", LEFT column must agree.
  if (isActive && ctx.revenue.variance < -10 && ctx.dailyOps.completionRate < 70) {
    const sev: BrainThreatSeverity = ctx.revenue.variance < -20 ? "high" : "medium";
    return {
      title:             "Revenue Behind + Operational Lag",
      description:       `Revenue ${ctx.revenue.variance.toFixed(1)}% vs target with ${ctx.dailyOps.completionRate}% of duties complete.`,
      severity:          sev,
      modulesInvolved:   ["REVENUE", "OPS"],
      owner:             gmOwner,
      moneyAtRisk:       revGap,
      timeWindowMinutes: timeWindowM,
      timeWindowLabel:   timeWindowLabel(timeWindowM, "Until session end"),
      ifIgnored:         `Revenue gap of ${fmt(revGap)} locks in as session closes — compound ops drag limits recovery.`,
      recommendedAction: "Address ops backlog immediately and push floor conversion to close the revenue gap.",
      confidence:        "high",
    };
  }

  // Compliance overdue or at risk — no revenue guard.
  // Even one expired certificate = CRITICAL regardless of trading performance.
  if (ctx.compliance.overdueCount > 0 || ctx.compliance.atRiskCount > 0) {
    const isExpired = ctx.compliance.overdueCount > 0;
    const itemCount = isExpired ? ctx.compliance.overdueCount : ctx.compliance.atRiskCount;
    const sev: BrainThreatSeverity = isExpired ? "critical" : "high";
    return {
      title:             isExpired
        ? `${itemCount} Expired Compliance ${itemCount === 1 ? "Item" : "Items"}`
        : `${itemCount} Compliance ${itemCount === 1 ? "Item" : "Items"} At Risk`,
      description:       isExpired
        ? `Operating with expired certificates. Legal, audit, and insurance exposure.${ctx.maintenance.urgentCount > 0 ? ` ${ctx.maintenance.urgentCount} maintenance issues also unresolved.` : ""}`
        : `${itemCount} compliance ${itemCount === 1 ? "item" : "items"} due soon — action before expiry.`,
      severity:          sev,
      modulesInvolved:   ["COMPLIANCE"],
      owner:             gmOwner,
      moneyAtRisk:       isExpired ? 50_000 : 0,
      timeWindowMinutes: 24 * 60,
      timeWindowLabel:   "Today",
      ifIgnored:         isExpired
        ? "Expired compliance compounds daily — potential closure, fine, or insurance exposure."
        : "Compliance items expire — creating the same legal and audit risk as overdue items.",
      recommendedAction: isExpired
        ? "Escalate to head office and schedule renewal immediately."
        : "Action overdue items today — assign owner and set deadline for each.",
      confidence:        "high",
    };
  }

  // Revenue behind (moderate) — no timeOfDay gate, matches voice state 14
  if (isActive && ctx.revenue.variance < -10 && ctx.revenue.target > 0) {
    return {
      title:             "Revenue Monitoring",
      description:       `Revenue ${ctx.revenue.variance.toFixed(1)}% vs target during service.`,
      severity:          "medium",
      modulesInvolved:   ["REVENUE"],
      owner:             gmOwner,
      moneyAtRisk:       revGap,
      timeWindowMinutes: timeWindowM,
      timeWindowLabel:   timeWindowLabel(timeWindowM, "Until session end"),
      ifIgnored:         "Revenue gap widens as service progresses without active floor intervention.",
      recommendedAction: "Monitor floor conversion and walk-in capture. Push upsell on current tables.",
      confidence:        "medium",
    };
  }

  // Worst score driver (catch-all for below-threshold scores)
  const topLoss = systemHealth.scoreDrivers.find((d) => d.direction === "down");
  if (topLoss && systemHealth.score < 70) {
    return {
      title:             `${topLoss.module} Below Threshold`,
      description:       topLoss.reason,
      severity:          systemHealth.score < 50 ? "medium" : "low",
      modulesInvolved:   [topLoss.module as string],
      owner:             gmOwner,
      moneyAtRisk:       0,
      timeWindowMinutes: 240,
      timeWindowLabel:   "Next 4 hours",
      ifIgnored:         "System health score remains suppressed until resolved.",
      recommendedAction: `Review ${topLoss.module.toLowerCase()} status and address the top gap.`,
      confidence:        "medium",
    };
  }

  // True all-systems nominal — only reached when no real issues exist
  return {
    title:             "All Systems Nominal",
    description:       "No active threats detected across any module.",
    severity:          "low",
    modulesInvolved:   ["REVENUE", "LABOUR", "OPS"],
    owner:             gmOwner,
    moneyAtRisk:       0,
    timeWindowMinutes: 0,
    timeWindowLabel:   "No active window",
    ifIgnored:         "Continue monitoring service quality and walk-in conversion.",
    recommendedAction: "Monitor booking pace and floor energy. No immediate action required.",
    confidence:        "high",
  };
}

// ── Primary threat builder ─────────────────────────────────────────────────────

function buildIfIgnored(
  sig: CrossModuleSignal,
  ctx: OperationsContext,
): string {
  const revGap = Math.abs(ctx.revenue.actual - ctx.revenue.target);

  if (sig.id === "S1_REVENUE_RECOVERY_WINDOW") {
    return `Revenue gap of ${fmt(revGap)} locks in as session closes — no recovery path after service ends.`;
  }
  if (sig.id === "S2_SERVICE_COLLAPSE_RISK") {
    return "Service disruption compounds into guest complaints, review score impact, and confirmed revenue loss.";
  }
  if (sig.id === "S3_LABOUR_EFFICIENCY_ALERT") {
    const excess = ctx.revenue.actual > 0
      ? ctx.revenue.actual * (ctx.labour.variance / 100) : 0;
    return `${fmt(excess)} in excess labour cost confirmed on P&L by close.`;
  }
  if (sig.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND") {
    return "Compliance audit risk escalates. Maintenance deteriorates further. Combined exposure worsens each day.";
  }
  if (sig.id === "S6_PRE_SERVICE_LABOUR_SURGE") {
    return "Labour enters service over budget — adds avoidable cost pressure to a session that hasn't earned revenue yet.";
  }
  if (sig.id === "S7_OPS_MAINTENANCE_OVERLOAD") {
    return "Ops backlog and maintenance compound. Guest experience degrades. Revenue risk increases.";
  }
  if (sig.id === "S8_UNEXPLAINED_REVENUE_GAP") {
    return `Revenue ${pct(-Math.abs(ctx.revenue.variance))} behind with no clear operational cause — floor conversion opportunity missed by close.`;
  }
  if (sig.id === "S9_REVENUE_BEHIND_PACE") {
    return `Revenue gap of ${fmt(revGap)} locks in as session closes — no recovery path after service ends.`;
  }
  if (sig.id === "S10_REVENUE_OPS_LAG") {
    return `Revenue gap of ${fmt(revGap)} grows as ops backlog compounds — recovery window narrows with each hour.`;
  }
  if (sig.id === "S11_COMPLIANCE_OVERDUE") {
    return "Expired compliance exposure compounds daily — potential closure, fine, or insurance exposure if not resolved.";
  }
  return sig.recommendation.split(".")[0] + ".";
}

function buildPrimaryThreat(
  topSignal: CrossModuleSignal,
  ctx: OperationsContext,
  hour: number,
  gmOwner: BrainOutput["primaryThreat"]["owner"],
): BrainOutput["primaryThreat"] {
  const mins   = estimateTimeWindowMinutes(topSignal.timeWindow, ctx, hour);
  const label  = timeWindowLabel(mins, topSignal.timeWindow);

  return {
    title:             topSignal.title,
    description:       topSignal.triggeredConditions.join(". "),
    severity:          sevToThreat(topSignal.severity),
    modulesInvolved:   topSignal.modules as string[],
    owner:             gmOwner,
    moneyAtRisk:       topSignal.moneyAtRisk ?? 0,
    timeWindowMinutes: mins,
    timeWindowLabel:   label,
    ifIgnored:         buildIfIgnored(topSignal, ctx),
    recommendedAction: topSignal.recommendation,
    confidence:        confidenceFromScore(topSignal.confidence),
  };
}

// ── Action queue builder ───────────────────────────────────────────────────────

/**
 * Extract the actionable sentence from a recommendation string.
 * Recommendations typically start with a problem statement, then give
 * the action. We take the last substantive sentence as the action.
 */
function extractActionText(recommendation: string): string {
  const sentences = recommendation.split(".").map((s) => s.trim()).filter((s) => s.length > 8);
  if (sentences.length > 1) return sentences[sentences.length - 1] + ".";
  return recommendation;
}

const ESTIMATED_MINUTES: Partial<Record<string, number>> = {
  S1_REVENUE_RECOVERY_WINDOW:        15,
  S2_SERVICE_COLLAPSE_RISK:          30,
  S3_LABOUR_EFFICIENCY_ALERT:        10,
  S4_COMPLIANCE_MAINTENANCE_COMPOUND: 60,
  S6_PRE_SERVICE_LABOUR_SURGE:       10,
  S7_OPS_MAINTENANCE_OVERLOAD:       20,
  S8_UNEXPLAINED_REVENUE_GAP:        20,
  S9_REVENUE_BEHIND_PACE:            15,
  S10_REVENUE_OPS_LAG:               20,
  S11_COMPLIANCE_OVERDUE:            45,
};

function getOwnerRole(sig: CrossModuleSignal): "Shift Lead" | "GM" | "Head Office" {
  if (sig.severity === "CRITICAL") return "GM";
  if (sig.id === "S2_SERVICE_COLLAPSE_RISK")          return "Shift Lead";
  if (sig.id === "S3_LABOUR_EFFICIENCY_ALERT")        return "Shift Lead";
  if (sig.id === "S6_PRE_SERVICE_LABOUR_SURGE")       return "Shift Lead";
  if (sig.id === "S7_OPS_MAINTENANCE_OVERLOAD")       return "Shift Lead";
  if (sig.id === "S10_REVENUE_OPS_LAG")               return "Shift Lead";
  if (sig.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND") return "GM";
  if (sig.id === "S11_COMPLIANCE_OVERDUE")             return "GM";
  return "GM";
}

function getEscalateTo(sig: CrossModuleSignal): "GM" | "Head Office" | "Facilities" | null {
  if (sig.severity === "CRITICAL")                     return "Head Office";
  if (sig.id === "S2_SERVICE_COLLAPSE_RISK")           return "GM";
  if (sig.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND") return "Head Office";
  if (sig.id === "S11_COMPLIANCE_OVERDUE")             return "Head Office";
  if (sig.id === "S7_OPS_MAINTENANCE_OVERLOAD")        return "GM";
  return null;
}

function buildFinancialImpact(
  sig: CrossModuleSignal,
  ctx: OperationsContext,
  saHour: number,
): string | null {
  const hoursLeft = Math.max(0, 22 - saHour);
  const runRate   = saHour > 0 ? ctx.revenue.actual / saHour : 0;

  if (sig.id === "S1_REVENUE_RECOVERY_WINDOW" || sig.id === "S8_UNEXPLAINED_REVENUE_GAP" || sig.id === "S9_REVENUE_BEHIND_PACE" || sig.id === "S10_REVENUE_OPS_LAG") {
    const gap = Math.max(0, ctx.revenue.target - ctx.revenue.actual);
    if (gap > 0) return `${fmt(gap)} revenue gap`;
  }
  if (sig.id === "S2_SERVICE_COLLAPSE_RISK") {
    const atRisk = Math.round(runRate * hoursLeft);
    if (atRisk > 0) return `~${fmt(atRisk)} revenue exposure`;
  }
  if (sig.id === "S3_LABOUR_EFFICIENCY_ALERT") {
    const labourCost = ctx.revenue.actual * ctx.labour.actualPercent / 100;
    const targetCost = ctx.revenue.actual * ctx.labour.targetPercent / 100;
    const excess     = Math.max(0, labourCost - targetCost);
    if (excess > 0) return `${fmt(excess)} excess cost`;
  }
  if (sig.id === "S6_PRE_SERVICE_LABOUR_SURGE") {
    const projRev = runRate > 0 ? runRate * 11 : 0;
    if (projRev > 0) {
      const excess = projRev * (ctx.labour.variance / 100);
      if (excess > 0) return `~${fmt(excess)} excess if not corrected`;
    }
  }
  if (sig.moneyAtRisk && sig.moneyAtRisk > 0) return `${fmt(sig.moneyAtRisk)} at risk`;
  return null;
}

function buildRecoveryMeter(
  ctx: OperationsContext,
  minutesElapsed: number,
  minutesRemaining: number,
  actionQueue: BrainOutput["actionQueue"],
  dayBaseline: number | null,
): RecoveryMeter | null {
  // Only during service with a meaningful gap and time remaining
  if (ctx.meta.timeOfDay === "post-service" || ctx.meta.timeOfDay === "closed") return null;
  const revenueGap = Math.max(0, ctx.revenue.target - ctx.revenue.actual);
  if (revenueGap < 2_000) return null;
  if (minutesRemaining <= 60) return null;

  const timeLeftMinutes = minutesRemaining;
  const SERVICE_DURATION_MINUTES = 720; // 10:00–22:00

  // Run rate from actual trading; if no revenue yet, use DOW baseline rate as proxy
  let runRate = minutesElapsed > 0 ? ctx.revenue.actual / minutesElapsed : 0;
  if (runRate === 0 && dayBaseline && dayBaseline > 0) {
    runRate = dayBaseline / SERVICE_DURATION_MINUTES;
  }

  const potentialRevenue = runRate * minutesRemaining;
  const recoverable    = Math.min(revenueGap, potentialRevenue * 0.5);
  const isOnTrack      = recoverable >= revenueGap;
  const limitedWindow  = timeLeftMinutes < 120 && !isOnTrack;
  const partialOnly    = revenueGap > recoverable * 1.1 && !isOnTrack;

  // Specific recovery actions (ordered by immediacy)
  const topActions: string[] = [
    "Push walk-in conversion at entrance.",
    "Activate upsell on current tables.",
  ];
  // Supplement with action queue if it has better context
  if (actionQueue.length > 0 && !actionQueue[0].impact.toLowerCase().startsWith("revenue")) {
    topActions[0] = actionQueue[0].impact;
  }

  return { revenueGap, recoverable, timeLeftMinutes, isOnTrack, limitedWindow, partialOnly, topActions };
}

function buildActionQueue(
  rankedSignals: Array<{ sig: CrossModuleSignal; score: number }>,
  gmName: string,
  ctx: OperationsContext,
  saHour: number,
): BrainOutput["actionQueue"] {
  return rankedSignals.slice(0, 5).map(({ sig }, idx) => ({
    priority:         idx + 1,
    title:            sig.title,
    why:              sig.triggeredConditions[0] ?? "Multiple conditions triggered",
    impact:           extractActionText(sig.recommendation),
    owner:            gmName,
    estimatedMinutes: ESTIMATED_MINUTES[sig.id] ?? 15,
    moneyAtRisk:      sig.moneyAtRisk ?? null,
    deadline:         sig.timeWindow ?? null,
    financialImpact:  buildFinancialImpact(sig, ctx, saHour),
    ownerRole:        getOwnerRole(sig),
    escalateTo:       getEscalateTo(sig),
    status:           "not_started" as const,
  }));
}

// ── GM situation lookup ────────────────────────────────────────────────────────

async function fetchGmSituation(
  supabase: ReturnType<typeof createServerClient>,
  siteId: string,
): Promise<BrainOutput["gmSituation"] & { userId: string }> {
  // Attempt GM profile lookup (graceful degradation if schema differs)
  let gmUserId = "";
  let gmName   = "Site GM";

  try {
    const { data: gmRows } = await (supabase as any)
      .from("profiles")
      .select("id, full_name")
      .eq("site_id", siteId)
      .eq("role", "gm")
      .limit(1);

    if (gmRows?.[0]) {
      gmUserId = gmRows[0].id ?? "";
      gmName   = gmRows[0].full_name ?? "Site GM";
    }
  } catch {
    // fall through to defaults
  }

  // Accountability score lookup
  let score = 0;
  let tier  = "Unknown";

  if (gmUserId) {
    try {
      const { data: scoreRows } = await (supabase as any)
        .from("manager_performance_scores")
        .select("score")
        .eq("user_id", gmUserId)
        .eq("site_id", siteId)
        .order("period_date", { ascending: false })
        .limit(1);

      if (scoreRows?.[0]?.score != null) {
        score = scoreRows[0].score as number;
        tier  = getPerformanceTier(score);
      }
    } catch {
      // fall through to defaults
    }
  }

  const alertNeeded = score > 0 && score < 60;

  return {
    userId:      gmUserId,
    name:        gmName,
    score,
    tier,
    alertNeeded,
    alertReason: alertNeeded
      ? `GM performance at ${score}/100 — below 60-point minimum threshold.`
      : null,
  };
}

// ── Site events loader ─────────────────────────────────────────────────────────

/**
 * Load admin-entered events from site_events table for a given date.
 * Degrades gracefully to empty array on any error.
 */
async function fetchSiteEvents(
  supabase: ReturnType<typeof createServerClient>,
  siteId: string,
  date: string,
): Promise<SportsEvent[]> {
  try {
    const { data } = await (supabase as any)
      .from("site_events")
      .select("event_name, event_date, category, uplift_multiplier, site_id, notes")
      .eq("site_id", siteId)
      .eq("event_date", date)
      .eq("confirmed", true);

    if (!data) return [];

    return data.map((row: any) => ({
      date:             row.event_date as string,
      name:             row.event_name as string,
      category:         (row.category ?? "custom") as SportsEvent["category"],
      upliftMultiplier: Number(row.uplift_multiplier ?? 1.0),
      siteId:           row.site_id as string,
      confirmed:        true,
      notes:            row.notes ?? undefined,
    }));
  } catch {
    return [];
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runOperatingBrain(
  siteId: string,
  date: string,
): Promise<BrainOutput> {
  const supabase = createServerClient();

  // Run context build + GM lookup + site events in parallel
  const [ctx, gmData, dbEvents] = await Promise.all([
    buildOperationsContext(siteId, date).catch(() => null as OperationsContext | null),
    fetchGmSituation(supabase, siteId),
    fetchSiteEvents(supabase, siteId, date),
  ]);

  if (!ctx) {
    return { ...BRAIN_FALLBACK, siteId, timestamp: new Date().toISOString() };
  }

  // ── SAST time with minute precision ────────────────────────────────────────
  const saTimeStr = new Date().toLocaleString("en-US", {
    timeZone: "Africa/Johannesburg",
    hour:     "numeric",
    minute:   "2-digit",
    hour12:   false,
  });
  const [saHourStr, saMinStr] = saTimeStr.split(":");
  const saHour   = parseInt(saHourStr, 10);
  const saMinute = parseInt(saMinStr ?? "0", 10);

  // Minutes since restaurant opened (10:00) and until close (22:00)
  const OPENING_HOUR = 10;
  const CLOSE_HOUR   = 22;
  const totalMinutes    = saHour * 60 + saMinute;
  const minutesElapsed  = Math.max(0, totalMinutes - OPENING_HOUR * 60);
  const minutesRemaining = Math.max(0, CLOSE_HOUR * 60 - totalMinutes);

  // ── Forecast (computed before signal detection to enable effectiveCtx) ─────
  const fcst = forecastToday(
    date,
    ctx.revenue.actual,
    minutesElapsed,
    minutesRemaining,
    ctx.revenue.target > 0 ? ctx.revenue.target : undefined,
    siteId,
    dbEvents,
  );

  // ── Patch ctx when no DB target: use DOW baseline so signals see real variance
  const effectiveCtx: OperationsContext =
    ctx.revenue.target === 0 && (fcst.dayBaseline ?? 0) > 0
      ? {
          ...ctx,
          revenue: {
            ...ctx.revenue,
            target:   fcst.dayBaseline!,
            variance: +((ctx.revenue.actual - fcst.dayBaseline!) / fcst.dayBaseline! * 100).toFixed(1),
          },
        }
      : ctx;

  const signals = detectSignals(effectiveCtx);
  // TODO: remove after confirming compliance signals flow correctly
  console.log("[Brain] signals:", signals.map((s) => `${s.id}(${s.severity})`).join(", ") || "NONE");

  // Rank signals (exclude INFO)
  const rankedSignals = signals
    .filter((s) => s.severity !== "INFO")
    .map((sig) => ({ sig, score: scoreSignal(sig, effectiveCtx, saHour) }))
    .sort((a, b) => b.score - a.score);

  const topSignal = rankedSignals[0]?.sig;

  const gmOwner: BrainOutput["primaryThreat"]["owner"] = {
    name:   gmData.name,
    role:   "gm",
    userId: gmData.userId,
  };

  // Compute systemHealth first — needed by buildContextualThreat for score drivers
  const systemHealth   = computeSystemHealth(effectiveCtx, signals, minutesElapsed);
  const actionQueue    = buildActionQueue(rankedSignals, gmData.name, effectiveCtx, saHour);
  const doNothingConsequences = buildConsequences(rankedSignals.map((r) => r.sig), effectiveCtx, minutesElapsed, minutesRemaining);

  // Primary threat: from top signal if available; otherwise synthesise from context
  // so LEFT column never contradicts the voice line or grade bar.
  const primaryThreat: BrainOutput["primaryThreat"] = topSignal
    ? buildPrimaryThreat(topSignal, effectiveCtx, saHour, gmOwner)
    : buildContextualThreat(effectiveCtx, systemHealth, gmOwner, saHour);

  const forecastSummary: BrainOutput["forecastSummary"] = {
    projectedClose:    fcst.projectedClose,
    vsTarget:          fcst.vsTarget,   // projected close vs target (not current revenue)
    vsSameDayLastYear: fcst.vsSameDayLastYear,
    recoverable:       fcst.vsTarget > -30,
    recoveryAction:    fcst.vsTarget < -10
      ? "Push floor conversion and walk-in capture to close the gap."
      : null,
    isRamadan:         fcst.isRamadan,
    activeEvent:       fcst.activeEvent,
    eventUplift:       fcst.eventUplift,
    isDayClosed:       effectiveCtx.meta.timeOfDay === "post-service" || effectiveCtx.meta.timeOfDay === "closed",
    syncPending:       (effectiveCtx.meta.timeOfDay === "post-service" || effectiveCtx.meta.timeOfDay === "closed") &&
                       effectiveCtx.revenue.actual < 5_000,
    isPreService:      fcst.isPreService,
  };

  // Remove gmSituation's internal userId before returning (it's already in primaryThreat.owner)
  const { userId: _uid, ...gmSituation } = gmData;

  const recoveryMeter = buildRecoveryMeter(effectiveCtx, minutesElapsed, minutesRemaining, actionQueue, fcst.dayBaseline ?? null);

  const brain: BrainOutput = {
    timestamp: new Date().toISOString(),
    siteId,
    primaryThreat,
    actionQueue,
    doNothingConsequences,
    systemHealth,
    forecastSummary,
    gmSituation,
    recoveryMeter,
    voiceLine: "",
  };

  brain.voiceLine = generateVoice(brain, effectiveCtx);

  return brain;
}
