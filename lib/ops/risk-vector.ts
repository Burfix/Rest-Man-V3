/**
 * lib/ops/risk-vector.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CANONICAL OPERATIONAL RISK TYPES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Every panel on the Command Center MUST derive its display values from
 * OperationalRiskVector — never from independent calculations.
 *
 * Data model:
 *   RiskSignal[]          — one signal per operational domain that is at risk
 *   GovernedRisks         — severity-capped buckets (MAX_CRITICAL=2, MAX_HIGH=4)
 *   NarrativeContext      — deterministic copy (no LLM) from top governed risk
 *   OperationalRiskVector — the single root object consumed by all UI panels
 *
 * Severity governor caps:
 *   critical ≤ 2   — prevents operator alert fatigue
 *   high     ≤ 4   — same
 *   Excess signals are downgraded one tier by impact score.
 */

// ── Primitive types ────────────────────────────────────────────────────────────

export type RiskDomain =
  | "revenue"
  | "labour"
  | "duties"
  | "maintenance"
  | "compliance";

export type RiskSeverity = "critical" | "high" | "medium" | "low";

export type ForecastConfidence = "high" | "medium" | "low";

export type DataReliabilityFlag = "live" | "stale" | "missing" | "insufficient";

export type RiskOwner = "gm" | "head_office" | "shift_lead";

// ── Score model constants ─────────────────────────────────────────────────────

/** Canonical maximum pts per domain (must sum to 100). */
export const DOMAIN_MAX: Record<RiskDomain, number> = {
  revenue:     30,
  labour:      20,
  duties:      20,
  maintenance: 15,
  compliance:  15,
} as const;

// ── Severity governor caps ────────────────────────────────────────────────────

export const MAX_CRITICAL = 2;
export const MAX_HIGH     = 4;

// ── Core signal type ──────────────────────────────────────────────────────────

/**
 * One operational risk — one domain, one severity, one action.
 *
 * `impactScore`   — score points currently being lost (0 = no loss).
 * `potentialGain` — score points recoverable if this risk is resolved.
 * `governedSeverity` — severity AFTER the governor runs (may differ from `severity`).
 */
export interface RiskSignal {
  /** Stable string ID for deduplication and action_events FK. */
  id: string;

  domain: RiskDomain;

  /** Raw severity before governor. */
  severity: RiskSeverity;

  /** Severity after governor (set by governSeverity, absent before). */
  governedSeverity?: RiskSeverity;

  /** Points currently lost in the operating score. */
  impactScore: number;

  /** Points recoverable if this risk is fully resolved. */
  potentialGain: number;

  /** True if there is still time / ability to recover this session. */
  recoverable: boolean;

  /** Minutes remaining in service window to act. null = session closed. */
  recoveryWindowMinutes: number | null;

  /** Reliability of underlying data — drives display confidence. */
  reliability: DataReliabilityFlag;

  /** Confidence in the assessment (degrades with stale data). */
  confidence: ForecastConfidence;

  /** One-line GM action directive. */
  requiredAction: string;

  /** Consequence if ignored through end of service. */
  consequence: string;

  /** Recommended owner for this action. */
  owner: RiskOwner;

  /** Supporting detail for drilldown (shown in Command Feed). */
  detail: string;

  // ── Domain-specific fields (optional) ──────────────────────────────────────

  /** Revenue gap in ZAR. */
  revenueGap?: number;
  /** Covers needed to close the gap at current avg spend. */
  requiredCovers?: number;
  /** Average spend per cover (ZAR). */
  avgSpend?: number;

  /** Number of staff that can safely be sent home. */
  safeReductionStaff?: number;
  /** Cost of excess labour in ZAR. */
  labourExcessCost?: number;

  /** Number of expired compliance items. */
  expiredCount?: number;
  /** Number of items due soon. */
  dueSoonCount?: number;

  /** Number of urgent maintenance items. */
  urgentMaintenanceCount?: number;

  /** Duty completion percentage (0–100). */
  dutyCompletionPct?: number;
}

// ── Governed risk buckets ─────────────────────────────────────────────────────

export interface GovernedRisks {
  /** ≤ MAX_CRITICAL signals. These must be actioned this session. */
  critical: RiskSignal[];

  /** ≤ MAX_HIGH signals. These are important but not session-critical. */
  high: RiskSignal[];

  /** Remaining signals (downgraded from critical/high or naturally medium/low). */
  medium: RiskSignal[];

  /** All governed signals in priority order (governedSeverity set on each). */
  all: RiskSignal[];
}

// ── Narrative context ─────────────────────────────────────────────────────────

/**
 * Deterministic narrative derived from the top governed risk.
 * ALL copy in the UI derives from this — no panel generates its own strings.
 * No LLM calls. Pure conditional logic on RiskSignal data.
 */
export interface NarrativeContext {
  /** One-sentence description of current operational state. */
  currentSituation: string;

  /** The single biggest risk right now. */
  primaryRisk: string;

  /** What happens end-of-service if nothing changes. */
  likelyOutcome: string;

  /** The one intervention with highest leverage. */
  recommendedIntervention: string;

  /** Confidence in this narrative ("high" = live data, "low" = stale/missing). */
  confidence: ForecastConfidence;

  /** Why this would escalate to head office (only present when warranted). */
  escalationReason?: string;
}

// ── Operational risk vector ───────────────────────────────────────────────────

/**
 * OperationalRiskVector — the single root object for ALL Command Center panels.
 *
 * Every panel reads from this. Nothing is computed in a component.
 *
 * Field reading contract:
 *   Hero              → narrative.primaryRisk + governed.critical[0]
 *   Requires Action   → governed.critical + governed.high
 *   Recommended Action → narrative.recommendedIntervention
 *   Business Status   → risks (one per domain, using governedSeverity)
 *   System Pulse      → overallScore + grade + score breakdown (in CommandCenterState)
 *   Command Feed      → governed.all
 *   Performance Momentum → projections.projectedGrade + projections.minutesToNextGrade
 *   Service Pulse     → projections.projectedClose + projections.recoveryLikelihood
 */
export interface OperationalRiskVector {
  /** ISO timestamp when this vector was generated. */
  generatedAt: string;

  /** Canonical operating score (0–100). Same value as CommandCenterState.score.value. */
  overallScore: number;

  /** Canonical grade (A–F). Same value as CommandCenterState.score.grade. */
  grade: "A" | "B" | "C" | "D" | "F";

  /**
   * Raw risk signals sorted by impactScore desc, BEFORE severity governing.
   * Used for analytics and AI training layer (future).
   */
  risks: RiskSignal[];

  /**
   * Severity-governed buckets.
   * These are what the UI displays — not `risks` directly.
   */
  governed: GovernedRisks;

  /**
   * Deterministic narrative derived from top governed risk.
   * All display copy derives from here.
   */
  narrative: NarrativeContext;

  /** Forward-looking projections. null values = insufficient data (never fake). */
  projections: {
    /** Projected end-of-service revenue (ZAR). null if revenue data missing. */
    projectedClose: number | null;

    /**
     * Recovery likelihood 0–100.
     * null if insufficient historical data (< 30 days of service data).
     * NEVER synthesize — show null until real baseline exists.
     */
    recoveryLikelihood: number | null;

    /** Confidence in projections. "low" = stale data, "missing" = no data. */
    forecastConfidence: ForecastConfidence;

    /** Grade projected at end of service if current pace continues. */
    projectedGrade: "A" | "B" | "C" | "D" | "F" | null;

    /** Minutes until next grade threshold is reachable. null = not calculable. */
    minutesToNextGrade: number | null;
  };
}
