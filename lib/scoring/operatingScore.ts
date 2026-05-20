/**
 * lib/scoring/operatingScore.ts
 *
 * ══ SINGLE SOURCE OF TRUTH for operating score ══
 *
 * System Pulse = weighted score out of 100
 *   Revenue      40 pts  (weight 0.40)
 *   Labour       25 pts  (weight 0.25)
 *   Service      15 pts  (weight 0.15) — optional; neutral 75 when not available
 *   Compliance   10 pts  (weight 0.10)
 *   Maintenance  10 pts  (weight 0.10)
 *
 * Grade:
 *   90–100 → A   75–89 → B   60–74 → C   40–59 → D   0–39 → F
 *
 * ALL scoring modules must import from this file — no inline weight definitions.
 */

// ── Canonical weights (import these, never redefine) ──────────────────────────
export const WEIGHTS = {
  revenue:     0.40,
  labour:      0.25,
  service:     0.15,
  compliance:  0.10,
  maintenance: 0.10,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type PulseGrade = "A" | "B" | "C" | "D" | "F";
export type ScoreConfidence = "high" | "medium" | "low";

export interface OperatingScoreInput {
  // Revenue
  actualRevenue: number | null;
  targetRevenue: number | null;
  /** Minutes remaining in the current service window (optional — enables urgency penalty). */
  serviceWindowRemainingMinutes?: number | null;

  // Labour
  labourPct: number | null;
  /** Site-specific target; defaults to 30 if omitted. */
  targetLabourPct?: number | null;
  /** Total labour cost in Rand (optional — used for excess-cost explanation). */
  labourCost?: number | null;

  // Service (optional — in-service context only; defaults to neutral 75 when absent)
  serviceScore?: number | null;  // 0–100 raw score

  // Compliance
  totalComplianceItems?: number | null;
  compliantItems?: number | null;
  expiredItems?: number | null;
  dueSoonItems?: number | null;

  // Maintenance
  totalMaintenanceItems?: number | null;
  openIssues?: number | null;
  criticalIssues?: number | null;
}

export interface ScoreComponent {
  /** Raw score 0–100 before weighting. */
  rawScore: number;
  /** Points actually earned toward the total (rawScore × weight, clamped to maxPoints). */
  weightedScore: number;
  /** Maximum points this component contributes to the 100-point total. */
  maxPoints: number;
  /** Human-readable explanation suitable for display in the UI. */
  explanation: string;
}

export interface OperatingScoreResult {
  /** Final score 0–100, clamped. */
  score: number;
  grade: PulseGrade;
  confidence: ScoreConfidence;
  components: {
    revenue:     ScoreComponent & { maxPoints: 40 };
    labour:      ScoreComponent & { maxPoints: 25 };
    service:     ScoreComponent & { maxPoints: 15 };
    compliance:  ScoreComponent & { maxPoints: 10 };
    maintenance: ScoreComponent & { maxPoints: 10 };
  };
  /** Up to 2 lowest-scoring component labels — the main drag on the score. */
  drivers: string[];
  /** One-sentence summary suitable for a sub-headline. */
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

/** Format a Rand value as "R1,234" with ZA locale separators. */
function fmt(value: number): string {
  return `R${Math.round(value).toLocaleString("en-ZA")}`;
}

// ── Grade ─────────────────────────────────────────────────────────────────────

export function toGrade(score: number): PulseGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ── Revenue ───────────────────────────────────────────────────────────────────

export function calcRevenueScore(
  actualRevenue: number | null,
  targetRevenue: number | null,
  serviceWindowRemainingMinutes?: number | null,
): { rawScore: number; explanation: string } {
  if (actualRevenue === null || targetRevenue === null || targetRevenue === 0) {
    return { rawScore: 0, explanation: "No revenue data available" };
  }

  const revenuePacePct = actualRevenue / targetRevenue;
  const revenueGap = Math.max(targetRevenue - actualRevenue, 0);
  const pacePct = +(revenuePacePct * 100).toFixed(1);

  if (actualRevenue >= targetRevenue) {
    return {
      rawScore: 100,
      explanation: `Revenue ${fmt(actualRevenue)} vs ${fmt(targetRevenue)} target (${pacePct}% of target — on target)`,
    };
  }

  // Base score = pace percentage (0–100)
  let baseScore = clamp(revenuePacePct * 100);

  // Service urgency penalty — only applied when remaining window is known
  let urgencyPenalty = 0;
  const remaining = serviceWindowRemainingMinutes ?? null;
  if (remaining !== null) {
    if      (remaining <= 60  && revenuePacePct < 0.75) urgencyPenalty = 20;
    else if (remaining <= 120 && revenuePacePct < 0.60) urgencyPenalty = 15;
    else if (remaining <= 180 && revenuePacePct < 0.50) urgencyPenalty = 10;
  }

  // Severe gap penalty
  let gapPenalty = 0;
  if      (revenuePacePct < 0.30) gapPenalty = 20;
  else if (revenuePacePct < 0.50) gapPenalty = 10;

  const rawScore = clamp(baseScore - urgencyPenalty - gapPenalty);

  return {
    rawScore,
    explanation: `Revenue ${fmt(actualRevenue)} vs ${fmt(targetRevenue)} target (${pacePct}% of target, ${fmt(revenueGap)} gap)`,
  };
}

// ── Labour ────────────────────────────────────────────────────────────────────

export function calcLabourScore(
  labourPct: number | null,
  actualRevenue: number | null,
  targetRevenue: number | null,
  targetLabourPct: number,
  labourCost?: number | null,
): { rawScore: number; explanation: string } {
  if (labourPct === null) {
    return { rawScore: 0, explanation: "No labour data available" };
  }

  const labourDelta = labourPct - targetLabourPct;

  // Base score: on or under target = 100; over target degrades 4 pts per % over
  let labourScore = labourDelta <= 0 ? 100 : clamp(100 - labourDelta * 4);

  // Revenue interaction penalty: high labour is more dangerous when revenue is also behind
  if (actualRevenue !== null && targetRevenue !== null && targetRevenue > 0) {
    if (actualRevenue < targetRevenue * 0.4 && labourPct > targetLabourPct) {
      labourScore = clamp(labourScore - 25);
    } else if (actualRevenue < targetRevenue * 0.6 && labourPct > targetLabourPct) {
      labourScore = clamp(labourScore - 15);
    }
  }

  // Build excess cost string if we have both labour cost and revenue data
  let excessCostStr = "";
  if (labourCost != null && actualRevenue != null) {
    const idealCost  = actualRevenue * (targetLabourPct / 100);
    const excessCost = Math.max(labourCost - idealCost, 0);
    if (excessCost > 0) {
      excessCostStr = `, ${fmt(excessCost)} excess cost`;
    }
  }

  const deltaStr = labourDelta > 0
    ? `${labourDelta.toFixed(1)}% over`
    : "on target";

  return {
    rawScore: labourScore,
    explanation: `Labour ${labourPct.toFixed(1)}% vs ${targetLabourPct}% target (${deltaStr}${excessCostStr})`,
  };
}

// ── Compliance ────────────────────────────────────────────────────────────────

export function calcComplianceScore(
  totalComplianceItems: number | null | undefined,
  compliantItems: number | null | undefined,
  expiredItems: number | null | undefined,
  dueSoonItems: number | null | undefined,
): { rawScore: number; explanation: string; hasData: boolean } {
  const total    = totalComplianceItems ?? null;
  const expired  = expiredItems  ?? 0;
  const dueSoon  = dueSoonItems  ?? 0;
  const compliant = compliantItems ?? null;

  if (total === null || compliant === null) {
    return { rawScore: 70, explanation: "Compliance data unavailable — using default", hasData: false };
  }
  if (total === 0) {
    return { rawScore: 70, explanation: "No compliance items tracked", hasData: false };
  }

  const compliancePct = compliant / total;
  let rawScore = clamp(compliancePct * 100);
  rawScore = clamp(rawScore - expired * 15 - dueSoon * 5);

  return {
    rawScore,
    explanation: `Compliance ${compliant}/${total} current, ${expired} expired, ${dueSoon} due soon`,
    hasData: true,
  };
}

// ── Maintenance ───────────────────────────────────────────────────────────────

export function calcMaintenanceScore(
  totalMaintenanceItems: number | null | undefined,
  openIssues: number | null | undefined,
  criticalIssues: number | null | undefined,
): { rawScore: number; explanation: string; hasData: boolean } {
  const total    = totalMaintenanceItems ?? null;
  const open     = openIssues    ?? null;
  const critical = criticalIssues ?? 0;

  if (total === null || open === null) {
    return { rawScore: 80, explanation: "Maintenance data unavailable — using default", hasData: false };
  }
  if (total === 0) {
    return { rawScore: 100, explanation: "No maintenance items tracked", hasData: true };
  }

  const clearPct = (total - open) / total;
  let rawScore = clamp(clearPct * 100);
  rawScore = clamp(rawScore - critical * 20);

  return {
    rawScore,
    explanation: `Maintenance ${open} open issues, ${critical} critical`,
    hasData: true,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export function calcServiceScore(
  serviceScore: number | null | undefined,
): { rawScore: number; explanation: string } {
  if (serviceScore === null || serviceScore === undefined) {
    return { rawScore: 75, explanation: "Service data unavailable — using neutral score" };
  }
  const raw = Math.max(0, Math.min(100, serviceScore));
  return {
    rawScore:    raw,
    explanation: `Service score ${raw}/100`,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function calculateOperatingScore(input: OperatingScoreInput): OperatingScoreResult {
  const targetLabourPct = input.targetLabourPct ?? 30;

  // ── Raw scores (0–100 each) ────────────────────────────────────────────────
  const { rawScore: revRaw,   explanation: revExpl  } = calcRevenueScore(
    input.actualRevenue,
    input.targetRevenue,
    input.serviceWindowRemainingMinutes,
  );
  const { rawScore: labRaw,   explanation: labExpl  } = calcLabourScore(
    input.labourPct,
    input.actualRevenue,
    input.targetRevenue,
    targetLabourPct,
    input.labourCost,
  );
  const { rawScore: svcRaw,   explanation: svcExpl  } = calcServiceScore(
    input.serviceScore,
  );
  const { rawScore: compRaw,  explanation: compExpl,  hasData: compHasData  } = calcComplianceScore(
    input.totalComplianceItems,
    input.compliantItems,
    input.expiredItems,
    input.dueSoonItems,
  );
  const { rawScore: maintRaw, explanation: maintExpl } = calcMaintenanceScore(
    input.totalMaintenanceItems,
    input.openIssues,
    input.criticalIssues,
  );

  // ── Weighted scores → points toward total (canonical weights — do NOT redefine elsewhere) ──
  const revWeighted   = Math.round(revRaw   * WEIGHTS.revenue);
  const labWeighted   = Math.round(labRaw   * WEIGHTS.labour);
  const svcWeighted   = Math.round(svcRaw   * WEIGHTS.service);
  const compWeighted  = Math.round(compRaw  * WEIGHTS.compliance);
  const maintWeighted = Math.round(maintRaw * WEIGHTS.maintenance);

  const total = clamp(revWeighted + labWeighted + svcWeighted + compWeighted + maintWeighted);
  const grade = toGrade(total);

  // ── Debug log — full input so bad values are immediately visible ──────────
  console.log("SCORE INPUT:", {
    actualRevenue:    input.actualRevenue,
    targetRevenue:    input.targetRevenue,
    labourPct:        input.labourPct,
    targetLabourPct,
    serviceScore:     input.serviceScore ?? null,
    expiredItems:     input.expiredItems ?? null,
    dueSoonItems:     input.dueSoonItems ?? null,
    openIssues:       input.openIssues ?? null,
    criticalIssues:   input.criticalIssues ?? null,
    // derived weighted scores
    revWeighted,
    labWeighted,
    svcWeighted,
    compWeighted,
    maintWeighted,
    total,
  });

  // ── Confidence ─────────────────────────────────────────────────────────────
  const hasRevenue = input.actualRevenue !== null && input.targetRevenue !== null;
  const hasLabour  = input.labourPct !== null;

  let confidence: ScoreConfidence;
  if (hasRevenue && hasLabour && compHasData) {
    confidence = "high";
  } else if (hasRevenue && hasLabour) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // ── Drivers — threshold-based critical messages, then below-60 fallbacks ──
  // Order matters: most critical issues first.
  const drivers: string[] = [];

  if (revWeighted <= 10) {
    drivers.push("Revenue critically behind target");
  } else if (revRaw < 60) {
    drivers.push("Revenue behind target");
  }

  if (labWeighted <= 10) {
    drivers.push("Labour significantly over target");
  } else if (labRaw < 60) {
    drivers.push("Labour over target");
  }

  if (input.serviceScore != null && svcWeighted <= 5) {
    drivers.push("Service performance weak");
  } else if (input.serviceScore != null && svcRaw < 60) {
    drivers.push("Service below standard");
  }

  if (compRaw < 60) {
    drivers.push("Compliance gaps");
  }

  if (maintRaw < 60) {
    drivers.push("Maintenance issues");
  }

  // Keep at most 2 (highest-priority are already first in the array)
  drivers.splice(2);

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = drivers.length === 0
    ? "All systems operating well"
    : `Driven by ${drivers.join(" and ")}`;

  return {
    score: total,
    grade,
    confidence,
    components: {
      revenue: {
        rawScore:      revRaw,
        weightedScore: revWeighted,
        maxPoints:     40,
        explanation:   revExpl,
      },
      labour: {
        rawScore:      labRaw,
        weightedScore: labWeighted,
        maxPoints:     25,
        explanation:   labExpl,
      },
      service: {
        rawScore:      svcRaw,
        weightedScore: svcWeighted,
        maxPoints:     15,
        explanation:   svcExpl,
      },
      compliance: {
        rawScore:      compRaw,
        weightedScore: compWeighted,
        maxPoints:     10,
        explanation:   compExpl,
      },
      maintenance: {
        rawScore:      maintRaw,
        weightedScore: maintWeighted,
        maxPoints:     10,
        explanation:   maintExpl,
      },
    },
    drivers,
    summary,
  };
}
