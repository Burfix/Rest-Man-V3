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

// ── Types ──────────────────────────────────────────────────────────────────────

export type BrainThreatSeverity = "critical" | "high" | "medium" | "low";
export type BrainConfidence = "high" | "medium" | "low";

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
  };

  forecastSummary: {
    projectedClose: number;
    vsTarget: number;
    vsSameDayLastYear: number | null;
    recoverable: boolean;
    recoveryAction: string | null;
  };

  gmSituation: {
    name: string;
    score: number;
    tier: string;
    alertNeeded: boolean;
    alertReason: string | null;
  };

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
  },
  forecastSummary: {
    projectedClose: 0,
    vsTarget: 0,
    vsSameDayLastYear: null,
    recoverable: true,
    recoveryAction: null,
  },
  gmSituation: {
    name: "Unknown",
    score: 0,
    tier: "Unknown",
    alertNeeded: false,
    alertReason: null,
  },
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
): BrainOutput["systemHealth"] {
  // Revenue: 30 pts (full at target, degrades linearly)
  const revPts = Math.max(0, Math.min(30, 30 * (1 + ctx.revenue.variance / 100)));

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
    score >= 70 ? "C" :
    score >= 60 ? "D" : "F";

  const criticalCount = signals.filter((s) => s.severity === "CRITICAL").length;
  const highCount     = signals.filter((s) => s.severity === "HIGH").length;

  const trend: BrainOutput["systemHealth"]["trend"] =
    ctx.revenue.trend === "recovering" ? "improving" :
    ctx.revenue.trend === "declining"  ? "declining" : "stable";

  return { score, grade, trend, criticalCount, highCount };
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
  hour: number,
): BrainOutput["doNothingConsequences"] {
  const consequences: BrainOutput["doNothingConsequences"] = [];
  const hoursLeft = Math.max(0, 22 - hour);
  const revGap = ctx.revenue.target > 0
    ? Math.abs(ctx.revenue.actual - ctx.revenue.target)
    : 0;

  const runRate    = hour > 0 ? ctx.revenue.actual / hour : 0;
  const projClose  = runRate * 22;
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

function buildActionQueue(
  rankedSignals: Array<{ sig: CrossModuleSignal; score: number }>,
  gmName: string,
  ctx: OperationsContext,
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

// ── Main export ───────────────────────────────────────────────────────────────

export async function runOperatingBrain(
  siteId: string,
  date: string,
): Promise<BrainOutput> {
  const supabase = createServerClient();

  // Run context build + GM lookup in parallel
  const [ctx, gmData] = await Promise.all([
    buildOperationsContext(siteId, date).catch(() => null as OperationsContext | null),
    fetchGmSituation(supabase, siteId),
  ]);

  if (!ctx) {
    return { ...BRAIN_FALLBACK, siteId, timestamp: new Date().toISOString() };
  }

  const signals = detectSignals(ctx);

  // SAST hour
  const saHour = parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Johannesburg",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );

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

  const systemHealth   = computeSystemHealth(ctx, signals);
  const actionQueue    = buildActionQueue(rankedSignals, gmData.name, ctx);
  const doNothingConsequences = buildConsequences(rankedSignals.map((r) => r.sig), ctx, saHour);

  const forecastSummary: BrainOutput["forecastSummary"] = {
    projectedClose:    saHour > 0 ? Math.round(ctx.revenue.actual / saHour * 22) : 0,
    vsTarget:          ctx.revenue.variance,
    vsSameDayLastYear: null,
    recoverable:       ctx.revenue.variance > -30,
    recoveryAction:    ctx.revenue.variance < -10
      ? "Push floor conversion and walk-in capture to close the gap."
      : null,
  };

  // Remove gmSituation's internal userId before returning (it's already in primaryThreat.owner)
  const { userId: _uid, ...gmSituation } = gmData;

  const brain: BrainOutput = {
    timestamp: new Date().toISOString(),
    siteId,
    primaryThreat,
    actionQueue,
    doNothingConsequences,
    systemHealth,
    forecastSummary,
    gmSituation,
    voiceLine: "",
  };

  brain.voiceLine = generateVoice(brain, ctx);

  return brain;
}
