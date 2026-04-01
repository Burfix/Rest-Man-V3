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
  const dutyPts = (ctx.dailyOps.completionRate / 100) * 20;

  // Maintenance: 15 pts (service-blocking = 0; each urgent removes 4)
  const maintPts = ctx.maintenance.serviceBlocking
    ? 0
    : Math.max(0, 15 - ctx.maintenance.urgentCount * 4);

  // Compliance: 15 pts (each overdue removes 5)
  const compPts = Math.max(0, 15 - ctx.compliance.overdueCount * 5);

  const score = Math.round(revPts + labPts + dutyPts + maintPts + compPts);
  const grade =
    score >= 90 ? "A" :
    score >= 80 ? "B" :
    score >= 65 ? "C" :
    score >= 50 ? "D" : "F";

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
      reason:    ctx.compliance.overdueCount === 0
        ? `All items current (+${Math.round(compPts)}/15 pts)`
        : `${ctx.compliance.overdueCount} overdue — -${Math.round(MAX.COMPLIANCE - compPts)} pts`,
    },
  ];

  // Sort by impact on score (biggest losers first, then biggest winners)
  const scoreDrivers = [...allDrivers]
    .sort((a, b) => {
      const lossA = (a.direction === "down" ? 1 : 0) * (30 - a.pts);
      const lossB = (b.direction === "down" ? 1 : 0) * (30 - b.pts);
      if (lossA !== lossB) return lossB - lossA;
      return b.pts - a.pts;
    })
    .slice(0, 3);

  return { score, grade, trend, criticalCount, highCount, scoreDrivers };
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
      sig.id === "S8_UNEXPLAINED_REVENUE_GAP"
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

const ESTIMATED_MINUTES: Partial<Record<string, number>> = {
  S1_REVENUE_RECOVERY_WINDOW:        15,
  S2_SERVICE_COLLAPSE_RISK:          30,
  S3_LABOUR_EFFICIENCY_ALERT:        10,
  S4_COMPLIANCE_MAINTENANCE_COMPOUND: 60,
  S6_PRE_SERVICE_LABOUR_SURGE:       10,
  S7_OPS_MAINTENANCE_OVERLOAD:       20,
  S8_UNEXPLAINED_REVENUE_GAP:        20,
};

function getOwnerRole(sig: CrossModuleSignal): "Shift Lead" | "GM" | "Head Office" {
  if (sig.severity === "CRITICAL") return "GM";
  if (sig.id === "S2_SERVICE_COLLAPSE_RISK")          return "Shift Lead";
  if (sig.id === "S3_LABOUR_EFFICIENCY_ALERT")        return "Shift Lead";
  if (sig.id === "S6_PRE_SERVICE_LABOUR_SURGE")       return "Shift Lead";
  if (sig.id === "S7_OPS_MAINTENANCE_OVERLOAD")       return "Shift Lead";
  if (sig.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND") return "GM";
  return "GM";
}

function getEscalateTo(sig: CrossModuleSignal): "GM" | "Head Office" | "Facilities" | null {
  if (sig.severity === "CRITICAL")                     return "Head Office";
  if (sig.id === "S2_SERVICE_COLLAPSE_RISK")           return "GM";
  if (sig.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND") return "Head Office";
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

  if (sig.id === "S1_REVENUE_RECOVERY_WINDOW" || sig.id === "S8_UNEXPLAINED_REVENUE_GAP") {
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
): RecoveryMeter | null {
  // Only during service with a meaningful gap
  if (ctx.meta.timeOfDay === "post-service" || ctx.meta.timeOfDay === "closed") return null;
  const revenueGap = Math.max(0, ctx.revenue.target - ctx.revenue.actual);
  if (revenueGap < 2_000) return null;

  const timeLeftMinutes = minutesRemaining;
  const runRate         = minutesElapsed > 0 ? ctx.revenue.actual / minutesElapsed : 0;
  const projRemaining   = runRate * minutesRemaining;

  const recoverable    = Math.min(revenueGap, projRemaining * 0.4);
  const isOnTrack      = recoverable >= revenueGap;
  const limitedWindow  = timeLeftMinutes < 60 && !isOnTrack;
  const partialOnly    = revenueGap > recoverable * 1.1 && !isOnTrack;

  const topActions: string[] = [];
  if (actionQueue.length > 0) topActions.push(actionQueue[0].impact);
  if (actionQueue.length > 1) topActions.push(actionQueue[1].impact);
  if (topActions.length < 2)  topActions.push("Push walk-in conversion and floor energy.");

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
    impact:           sig.recommendation.split(".")[0] + ".",
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

  const signals = detectSignals(ctx);

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

  // Rank signals (exclude INFO)
  const rankedSignals = signals
    .filter((s) => s.severity !== "INFO")
    .map((sig) => ({ sig, score: scoreSignal(sig, ctx, saHour) }))
    .sort((a, b) => b.score - a.score);

  const topSignal = rankedSignals[0]?.sig;

  const gmOwner: BrainOutput["primaryThreat"]["owner"] = {
    name:   gmData.name,
    role:   "gm",
    userId: gmData.userId,
  };

  // Nominal state when no actionable threats
  const primaryThreat: BrainOutput["primaryThreat"] = topSignal
    ? buildPrimaryThreat(topSignal, ctx, saHour, gmOwner)
    : {
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

  const systemHealth   = computeSystemHealth(ctx, signals, minutesElapsed);
  const actionQueue    = buildActionQueue(rankedSignals, gmData.name, ctx, saHour);
  const doNothingConsequences = buildConsequences(rankedSignals.map((r) => r.sig), ctx, minutesElapsed, minutesRemaining);

  const fcst = forecastToday(
    date,
    ctx.revenue.actual,
    minutesElapsed,
    minutesRemaining,
    ctx.revenue.target > 0 ? ctx.revenue.target : undefined,
    siteId,
    dbEvents,
  );

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
    isDayClosed:       ctx.meta.timeOfDay === "post-service" || ctx.meta.timeOfDay === "closed",
    syncPending:       (ctx.meta.timeOfDay === "post-service" || ctx.meta.timeOfDay === "closed") &&
                       ctx.revenue.actual < 5_000,
    isPreService:      fcst.isPreService,
  };

  // Remove gmSituation's internal userId before returning (it's already in primaryThreat.owner)
  const { userId: _uid, ...gmSituation } = gmData;

  const recoveryMeter = buildRecoveryMeter(ctx, minutesElapsed, minutesRemaining, actionQueue);

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

  brain.voiceLine = generateVoice(brain, ctx);

  return brain;
}
