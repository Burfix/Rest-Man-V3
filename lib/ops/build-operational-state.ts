/**
 * lib/ops/build-operational-state.ts
 *
 * Single assembler for OperationalRiskVector.
 *
 * Orchestrates:
 *   buildRiskSignals()    → raw RiskSignal[] (one per domain at risk)
 *   governSeverity()      → GovernedRisks (severity capped at MAX_CRITICAL/MAX_HIGH)
 *   buildNarrativeContext() → NarrativeContext (deterministic copy, no LLM)
 *
 * Called from build-command-center-state.ts after all raw data is fetched.
 * Does NOT fetch data — pure transformation layer.
 *
 * Reliability rules enforced here (not in UI):
 *   - Revenue missing → no revenue signal, no recovery projections
 *   - Labour insufficient → no labour signal
 *   - Compliance not_configured → no compliance signal, no "0% compliant"
 *   - Forecast insufficient baseline → recoveryLikelihood stays null
 */

import type {
  OperationalRiskVector,
  ForecastConfidence,
} from "./risk-vector";
import type {
  CanonicalScore,
  CanonicalRevenue,
  CanonicalLabour,
  CanonicalCompliance,
  CanonicalMaintenance,
} from "@/lib/command-center/types";
import { toCanonicalGrade } from "@/lib/command-center/types";
import { buildRiskSignals }      from "./build-risk-vector";
import { governSeverity }        from "./govern-severity";
import { buildNarrativeContext } from "./build-narrative-context";

// ── Input contract ────────────────────────────────────────────────────────────

export interface OperationalStateInput {
  score:       CanonicalScore;
  revenue:     CanonicalRevenue;
  labour:      CanonicalLabour;
  compliance:  CanonicalCompliance;
  maintenance: CanonicalMaintenance;

  /** Minutes remaining in service window (e.g. 480 − minutesElapsed). */
  serviceMinutesRemaining: number;

  /** Covers sold this session (used for avg spend calc). */
  covers?: number;

  /** Projected end-of-service revenue from brain.forecastSummary. */
  projectedClose: number | null;

  /**
   * Recovery likelihood 0–100.
   * Pass null unless you have ≥ 30 days of historical service data.
   * NEVER synthesize — null is the safe default.
   */
  recoveryLikelihood: number | null;

  /** Confidence in the forecast from brain. */
  forecastConfidence: ForecastConfidence;
}

// ── Projected grade from current pace ─────────────────────────────────────────

function projectedGrade(
  projectedClose: number | null,
  revenue:        CanonicalRevenue,
  score:          CanonicalScore,
): "A" | "B" | "C" | "D" | "F" | null {
  if (projectedClose === null || revenue.target === 0) return null;

  const projectedGapPct = ((projectedClose - revenue.target) / revenue.target) * 100;

  // Adjust score by revenue pts delta based on projected close vs target
  const currentRevPts  = score.breakdown.revenue.pts;
  const maxRevPts      = score.breakdown.revenue.max;
  const projectedRevPts = projectedClose >= revenue.target
    ? maxRevPts
    : Math.max(0, Math.round((projectedClose / revenue.target) * maxRevPts));

  const ptsDelta = projectedRevPts - currentRevPts;
  const projectedScore = Math.min(100, Math.max(0, score.value + ptsDelta));

  return toCanonicalGrade(projectedScore);
}

// ── Main assembler ────────────────────────────────────────────────────────────

/**
 * Build the complete OperationalRiskVector from canonical state components.
 *
 * This is the single entry point for the operational state layer.
 * Call from build-command-center-state.ts after all data is resolved.
 */
export function buildOperationalState(
  input: OperationalStateInput,
): OperationalRiskVector {
  // Step 1: Build raw risk signals (one per domain at risk)
  const rawSignals = buildRiskSignals({
    score:       input.score,
    revenue:     input.revenue,
    labour:      input.labour,
    compliance:  input.compliance,
    maintenance: input.maintenance,
    serviceMinutesRemaining: input.serviceMinutesRemaining,
    covers:      input.covers,
    forecastConfidence: input.forecastConfidence,
  });

  // Step 2: Apply severity governor (MAX_CRITICAL=2, MAX_HIGH=4)
  const governed = governSeverity(rawSignals);

  // Step 3: Build deterministic narrative from top governed risk
  const narrative = buildNarrativeContext(governed, input.score);

  // Step 4: Build projections (null-safe — never fake)
  const pg = projectedGrade(input.projectedClose, input.revenue, input.score);

  return {
    generatedAt:  new Date().toISOString(),
    overallScore: input.score.value,
    grade:        input.score.grade,
    risks:        rawSignals,
    governed,
    narrative,
    projections: {
      projectedClose:      input.projectedClose,
      recoveryLikelihood:  input.recoveryLikelihood,
      forecastConfidence:  input.forecastConfidence,
      projectedGrade:      pg,
      minutesToNextGrade:  null, // computed from score momentum — future iteration
    },
  };
}
