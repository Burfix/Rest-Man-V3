/**
 * lib/ops/build-risk-vector.ts
 *
 * Converts canonical state components into a RiskSignal[] ready for governing.
 *
 * One signal per domain that has an active risk.
 * Domains with no risk (full score, no issues) produce no signal.
 *
 * impactScore = pts currently lost (domain.max − domain.pts)
 * potentialGain = pts recoverable within this service session
 *
 * Data reliability rules (no fake certainty):
 *   - Revenue missing → skip revenue signal, no recovery projections
 *   - Labour insufficient → skip labour signal
 *   - Compliance not_configured → skip compliance signal (not a failure)
 *   - Forecast insufficient baseline → recoveryLikelihood stays null
 */

import type { RiskSignal, ForecastConfidence, DataReliabilityFlag } from "./risk-vector";
import type {
  CanonicalScore,
  CanonicalRevenue,
  CanonicalLabour,
  CanonicalCompliance,
  CanonicalMaintenance,
} from "@/lib/command-center/types";

// ── Input contract ────────────────────────────────────────────────────────────

export interface RiskVectorInput {
  score:       CanonicalScore;
  revenue:     CanonicalRevenue;
  labour:      CanonicalLabour;
  compliance:  CanonicalCompliance;
  maintenance: CanonicalMaintenance;

  /** Minutes remaining in service window (used for recoveryWindowMinutes). */
  serviceMinutesRemaining: number;

  /** Covers sold this session (used to compute avg spend). */
  covers?: number;

  /** Forecast confidence from brain. */
  forecastConfidence: ForecastConfidence;
}

// ── ZAR formatter (local to this module) ─────────────────────────────────────

function zar(n: number): string {
  return `R${Math.round(Math.abs(n)).toLocaleString("en-ZA")}`;
}

function pct(n: number): string {
  return `${Math.abs(n).toFixed(1)}%`;
}

// ── Individual signal builders ─────────────────────────────────────────────────

function buildRevenueSignal(
  revenue:  CanonicalRevenue,
  score:    CanonicalScore,
  serviceMinutesRemaining: number,
  covers:   number,
): RiskSignal | null {
  // Guard: no signal when revenue data is missing
  if (revenue.reliability === "missing") return null;

  const impactScore = score.breakdown.revenue.max - score.breakdown.revenue.pts;

  // No signal when revenue is on or ahead of target
  if (revenue.gap <= 0 || impactScore <= 0) return null;

  const avgSpend  = covers > 0 ? revenue.actual / covers : null;
  const reqCovers = avgSpend && avgSpend > 0 ? Math.ceil(revenue.gap / avgSpend) : null;

  const severity =
    revenue.status === "critical" ? "critical" :
    revenue.status === "at_risk"  ? "high"     :
    revenue.status === "behind"   ? "medium"   : "low";

  const gapLabel = zar(revenue.gap);
  const pctLabel = pct(Math.abs(revenue.gapPct));

  return {
    id:           "risk-revenue",
    domain:       "revenue",
    severity,
    impactScore,
    potentialGain: impactScore,
    recoverable:   serviceMinutesRemaining > 30,
    recoveryWindowMinutes: serviceMinutesRemaining > 0 ? serviceMinutesRemaining : null,
    reliability:   revenue.reliability,
    confidence:    revenue.reliability === "live" ? "high" : "medium",
    requiredAction: reqCovers
      ? `Push upsell + walk-in capture to gain ${reqCovers} covers`
      : `Push upsell and walk-in capture to close ${gapLabel} gap`,
    consequence:  `Revenue gap of ${gapLabel} locks in as session closes — no recovery path after service ends`,
    owner:        "gm",
    detail:       `Revenue ${pctLabel} behind target. Gap: ${gapLabel}${avgSpend ? `. Avg spend: ${zar(avgSpend)}/cover` : ""}.`,
    revenueGap:   revenue.gap,
    requiredCovers: reqCovers ?? undefined,
    avgSpend:     avgSpend ?? undefined,
  };
}

function buildLabourSignal(
  labour:   CanonicalLabour,
  revenue:  CanonicalRevenue,
  score:    CanonicalScore,
  serviceMinutesRemaining: number,
): RiskSignal | null {
  // Guard: labour is unreliable when revenue data is missing
  if (
    labour.reliability === "missing" ||
    labour.reliability === "insufficient"
  ) return null;

  const impactScore = score.breakdown.labour.max - score.breakdown.labour.pts;

  // No signal when labour is on target
  if (labour.variancePct <= 0 || impactScore <= 0) return null;

  const excessPct   = labour.variancePct;
  const excessCost  = revenue.actual > 0
    ? Math.round((excessPct / 100) * revenue.actual)
    : null;
  const safeReduction = excessPct > 10 ? 2 : 1;

  const severity =
    excessPct > 15 ? "critical" :
    excessPct > 10 ? "high"     :
    excessPct > 5  ? "medium"   : "low";

  return {
    id:           "risk-labour",
    domain:       "labour",
    severity,
    impactScore,
    potentialGain: Math.min(impactScore, Math.round(excessPct / labour.targetPct * score.breakdown.labour.max)),
    recoverable:   serviceMinutesRemaining > 15,
    recoveryWindowMinutes: serviceMinutesRemaining > 0 ? serviceMinutesRemaining : null,
    reliability:   labour.reliability,
    confidence:    labour.reliability === "live" ? "high" : "medium",
    requiredAction: `Review roster — consider sending ${safeReduction} staff home${excessCost ? ` to save ${zar(excessCost)}` : ""}`,
    consequence:  `Labour excess continues to erode margin for remainder of service`,
    owner:        "shift_lead",
    detail:       `Labour at ${pct(labour.labourPct)} vs ${pct(labour.targetPct)} target (+${pct(excessPct)} over).${excessCost ? ` Excess cost: ${zar(excessCost)}.` : ""}`,
    safeReductionStaff: safeReduction,
    labourExcessCost:   excessCost ?? undefined,
  };
}

function buildDutiesSignal(
  score:    CanonicalScore,
  serviceMinutesRemaining: number,
): RiskSignal | null {
  const impactScore = score.breakdown.duties.max - score.breakdown.duties.pts;

  if (impactScore <= 0) return null;

  const completionPct = Math.round((score.breakdown.duties.pts / score.breakdown.duties.max) * 100);

  const severity =
    completionPct === 0 ? "high"   :
    completionPct < 50  ? "medium" : "low";

  return {
    id:           "risk-duties",
    domain:       "duties",
    severity,
    impactScore,
    potentialGain: impactScore,
    recoverable:   serviceMinutesRemaining > 0,
    recoveryWindowMinutes: serviceMinutesRemaining > 0 ? serviceMinutesRemaining : null,
    reliability:   "live",
    confidence:    "high",
    requiredAction: `Complete outstanding ops duties (${completionPct}% done — ${impactScore} pts at risk)`,
    consequence:   `Incomplete duties reduce operating score by ${impactScore} pts and trigger accountability flag`,
    owner:         "gm",
    detail:        score.breakdown.duties.explanation,
    dutyCompletionPct: completionPct,
  };
}

function buildMaintenanceSignal(
  maintenance: CanonicalMaintenance,
  score:       CanonicalScore,
  serviceMinutesRemaining: number,
): RiskSignal | null {
  const impactScore = score.breakdown.maintenance.max - score.breakdown.maintenance.pts;

  if (impactScore <= 0 || maintenance.status === "ok") return null;

  const severity = maintenance.status === "critical" ? "critical" : "medium";

  return {
    id:           "risk-maintenance",
    domain:       "maintenance",
    severity,
    impactScore,
    potentialGain: impactScore,
    recoverable:   serviceMinutesRemaining > 30,
    recoveryWindowMinutes: serviceMinutesRemaining > 0 ? serviceMinutesRemaining : null,
    reliability:   "live",
    confidence:    "high",
    requiredAction: maintenance.criticalItems > 0
      ? `Address ${maintenance.criticalItems} critical maintenance issue${maintenance.criticalItems > 1 ? "s" : ""} immediately`
      : `Action ${maintenance.openItems} open maintenance item${maintenance.openItems > 1 ? "s" : ""}`,
    consequence:  maintenance.status === "critical"
      ? "Critical equipment failure risk — potential service disruption"
      : "Deferred maintenance compounds into larger issues and score drag",
    owner:        "head_office",
    detail:       score.breakdown.maintenance.explanation,
    urgentMaintenanceCount: maintenance.criticalItems,
  };
}

function buildComplianceSignal(
  compliance: CanonicalCompliance,
  score:      CanonicalScore,
): RiskSignal | null {
  // Guard: not_configured is not a compliance failure
  if (compliance.status === "not_configured") return null;

  const impactScore = score.breakdown.compliance.max - score.breakdown.compliance.pts;

  if (impactScore <= 0 || compliance.status === "ok") return null;

  const severity = compliance.status === "critical" ? "critical" : "medium";

  return {
    id:           "risk-compliance",
    domain:       "compliance",
    severity,
    impactScore,
    potentialGain: impactScore,
    recoverable:   false, // compliance renewals take time — not same-session recoverable
    recoveryWindowMinutes: null,
    reliability:   "live",
    confidence:    "high",
    requiredAction: compliance.expiredCount > 0
      ? `Renew ${compliance.expiredCount} expired item${compliance.expiredCount > 1 ? "s" : ""} — escalate to head office`
      : `Review ${compliance.dueSoonCount} item${compliance.dueSoonCount > 1 ? "s" : ""} due soon`,
    consequence:  "Operating with expired compliance items creates regulatory and legal exposure",
    owner:        "head_office",
    detail:       score.breakdown.compliance.explanation,
    expiredCount:  compliance.expiredCount,
    dueSoonCount:  compliance.dueSoonCount,
  };
}

// ── Main builder ───────────────────────────────────────────────────────────────

/**
 * Build an array of RiskSignals from canonical state.
 * Signals are sorted by impactScore desc (highest loss first).
 * The severity governor has NOT yet been applied — call governSeverity() next.
 */
export function buildRiskSignals(input: RiskVectorInput): RiskSignal[] {
  const signals: Array<RiskSignal | null> = [
    buildRevenueSignal(input.revenue, input.score, input.serviceMinutesRemaining, input.covers ?? 0),
    buildLabourSignal(input.labour, input.revenue, input.score, input.serviceMinutesRemaining),
    buildDutiesSignal(input.score, input.serviceMinutesRemaining),
    buildMaintenanceSignal(input.maintenance, input.score, input.serviceMinutesRemaining),
    buildComplianceSignal(input.compliance, input.score),
  ];

  return signals
    .filter((s): s is RiskSignal => s !== null)
    .sort((a, b) => b.impactScore - a.impactScore);
}
