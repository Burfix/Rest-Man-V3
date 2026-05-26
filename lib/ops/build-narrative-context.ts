/**
 * lib/ops/build-narrative-context.ts
 *
 * Deterministic narrative generator — NO LLM calls, NO AI.
 * Pure conditional logic on GovernedRisks + CanonicalScore.
 *
 * ALL UI copy derives from NarrativeContext.
 * No panel may generate its own headline, subline, or recommendation.
 *
 * Narrative derives from:
 *   1. Top governed risk (governed.critical[0] ?? governed.high[0] ?? governed.medium[0])
 *   2. Overall score + grade
 *   3. Score trajectory (improving, stable, declining)
 *   4. Recovery window
 */

import type { GovernedRisks, NarrativeContext, ForecastConfidence, RiskSignal } from "./risk-vector";
import type { CanonicalScore }  from "@/lib/command-center/types";
import { toCanonicalGrade }     from "@/lib/command-center/types";

// ── ZAR formatter ─────────────────────────────────────────────────────────────

function zar(n: number): string {
  return `R${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

// ── Situation strings per domain ──────────────────────────────────────────────

function situationFromSignal(signal: RiskSignal, score: CanonicalScore): string {
  const grade = score.grade;
  switch (signal.domain) {
    case "revenue":
      return signal.revenueGap
        ? `Revenue is ${zar(signal.revenueGap)} behind target — operating at Grade ${grade}.`
        : `Revenue behind target — operating at Grade ${grade}.`;
    case "labour":
      return `Labour running over target while revenue is below pace — Grade ${grade} and margin under pressure.`;
    case "duties":
      return `Operational duties incomplete — Grade ${grade} with ${signal.impactScore} pts at risk from execution gap.`;
    case "maintenance":
      return `Maintenance issues active — Grade ${grade} with ${signal.impactScore} pts at risk from equipment status.`;
    case "compliance":
      return `Compliance items require attention — Grade ${grade} with regulatory exposure.`;
  }
}

function primaryRiskFromSignal(signal: RiskSignal): string {
  switch (signal.domain) {
    case "revenue":
      return signal.revenueGap
        ? `Revenue gap of ${zar(signal.revenueGap)}${signal.requiredCovers ? ` — need ${signal.requiredCovers} more covers` : ""}.`
        : "Revenue critically behind pace.";
    case "labour":
      return signal.labourExcessCost
        ? `Labour ${signal.labourExcessCost > 0 ? zar(signal.labourExcessCost) : ""} excess cost — overstaffed relative to revenue.`
        : "Labour running over target relative to revenue.";
    case "duties":
      return `Ops duties incomplete — ${signal.impactScore} score points unclaimed.`;
    case "maintenance":
      return signal.urgentMaintenanceCount && signal.urgentMaintenanceCount > 0
        ? `${signal.urgentMaintenanceCount} urgent maintenance issue${signal.urgentMaintenanceCount > 1 ? "s" : ""} active.`
        : "Open maintenance items dragging score.";
    case "compliance":
      return signal.expiredCount && signal.expiredCount > 0
        ? `${signal.expiredCount} expired compliance item${signal.expiredCount > 1 ? "s" : ""} — regulatory exposure.`
        : "Compliance items due soon.";
  }
}

function outcomeFromSignal(signal: RiskSignal, score: CanonicalScore): string {
  const pts = signal.impactScore;
  const nextGrade = toCanonicalGrade(score.value + pts);

  if (!signal.recoverable || signal.recoveryWindowMinutes === null) {
    return signal.consequence;
  }

  const windowLabel =
    signal.recoveryWindowMinutes >= 60
      ? `${Math.round(signal.recoveryWindowMinutes / 60)}h ${signal.recoveryWindowMinutes % 60}m`
      : `${signal.recoveryWindowMinutes}m`;

  if (nextGrade !== score.grade) {
    return `${windowLabel} remaining to recover ${pts} pts and reach Grade ${nextGrade}.`;
  }

  return `${windowLabel} remaining in service window — ${signal.consequence.toLowerCase()}`;
}

function outcomeFromNoRisks(score: CanonicalScore): string {
  if (score.grade === "A") return "Strong execution across all modules. Maintain pace.";
  if (score.grade === "B") return "Good performance — close remaining gaps to reach Grade A.";
  return "No active risks requiring immediate action.";
}

// ── Escalation logic ──────────────────────────────────────────────────────────

function escalationReason(governed: GovernedRisks, score: CanonicalScore): string | undefined {
  // Escalate if critical revenue risk exists and score is below C
  const revCritical = governed.critical.find((s) => s.domain === "revenue");
  if (revCritical && score.value < 55) {
    return "Revenue critically behind and operating score below Grade C — head office visibility required.";
  }

  // Escalate if score is F with multiple active risks
  if (score.grade === "F" && governed.critical.length > 0) {
    return `Grade F with ${governed.critical.length} critical risk${governed.critical.length > 1 ? "s" : ""} — escalation threshold met.`;
  }

  // Escalate if compliance is expired
  const compCritical = governed.critical.find((s) => s.domain === "compliance");
  if (compCritical) {
    return "Expired compliance items create regulatory exposure — head office sign-off required.";
  }

  return undefined;
}

// ── Confidence from top signal ────────────────────────────────────────────────

function narrativeConfidence(governed: GovernedRisks): ForecastConfidence {
  const top = governed.critical[0] ?? governed.high[0] ?? governed.medium[0];
  if (!top) return "high";
  return top.confidence;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a deterministic NarrativeContext from governed risks + canonical score.
 * Call this AFTER governSeverity().
 */
export function buildNarrativeContext(
  governed: GovernedRisks,
  score:    CanonicalScore,
): NarrativeContext {
  const topSignal = governed.critical[0] ?? governed.high[0] ?? governed.medium[0];

  if (!topSignal) {
    // No active risks — positive narrative
    return {
      currentSituation:        `All operational modules tracking well — Grade ${score.grade} (${score.value}/100).`,
      primaryRisk:             "No critical risks active this session.",
      likelyOutcome:           outcomeFromNoRisks(score),
      recommendedIntervention: "Maintain current pace and execution standard.",
      confidence:              "high",
    };
  }

  return {
    currentSituation:        situationFromSignal(topSignal, score),
    primaryRisk:             primaryRiskFromSignal(topSignal),
    likelyOutcome:           outcomeFromSignal(topSignal, score),
    recommendedIntervention: topSignal.requiredAction,
    confidence:              narrativeConfidence(governed),
    escalationReason:        escalationReason(governed, score),
  };
}
