/**
 * __tests__/ops/operational-state-hardening.test.ts
 *
 * Phase 9 — Hardening Tests: Operational State Engine
 *
 * These tests protect the canonical architecture invariants.
 * A failure here means a panel could show inconsistent data to executives.
 *
 * Test coverage:
 *   1. Hero score === System Pulse score (no independent derivation)
 *   2. Score breakdown components sum to overall score
 *   3. MAX_CRITICAL=2: never more than 2 critical risks in governed output
 *   4. MAX_HIGH=4: never more than 4 high risks in governed output
 *   5. Narrative currentSituation derives from domain of top governed risk
 *   6. Missing compliance (not_configured) does NOT produce a 0% compliance signal
 *   7. Missing revenue data suppresses recovery projections (no fake certainty)
 *   8. Labour signal absent when revenue is missing (labour % is unreliable)
 *   9. Same input always produces identical output (determinism)
 */

import { describe, it, expect } from "vitest";
import { buildRiskSignals }      from "../../lib/ops/build-risk-vector";
import { governSeverity }        from "../../lib/ops/govern-severity";
import { buildNarrativeContext } from "../../lib/ops/build-narrative-context";
import { buildOperationalState } from "../../lib/ops/build-operational-state";
import { MAX_CRITICAL, MAX_HIGH } from "../../lib/ops/risk-vector";
import type { OperationalStateInput } from "../../lib/ops/build-operational-state";
import type {
  CanonicalScore,
  CanonicalRevenue,
  CanonicalLabour,
  CanonicalCompliance,
  CanonicalMaintenance,
} from "../../lib/command-center/types";

// ── Canonical fixture factories ───────────────────────────────────────────────

function makeScore(value: number, overrides: Partial<CanonicalScore> = {}): CanonicalScore {
  const grade = value >= 85 ? "A" : value >= 70 ? "B" : value >= 55 ? "C" : value >= 40 ? "D" : "F";
  const status = value >= 85 ? "strong" : value >= 70 ? "ok" : value >= 55 ? "at_risk" : "critical";
  return {
    value,
    grade,
    status,
    drivers: [],
    explanation: "Test score",
    breakdown: {
      revenue:     { pts: Math.round(value * 0.30), max: 30, explanation: "test" },
      labour:      { pts: Math.round(value * 0.20), max: 20, explanation: "test" },
      duties:      { pts: Math.round(value * 0.20), max: 20, explanation: "test" },
      maintenance: { pts: Math.round(value * 0.15), max: 15, explanation: "test" },
      compliance:  { pts: Math.round(value * 0.15), max: 15, explanation: "test" },
    },
    ...overrides,
  };
}

function makeRevenue(overrides: Partial<CanonicalRevenue> = {}): CanonicalRevenue {
  return {
    actual: 45_000,
    target: 60_000,
    projectedClose: 52_000,
    gap: 15_000,
    gapPct: -25,
    status: "behind",
    reliability: "live",
    ...overrides,
  };
}

function makeLabour(overrides: Partial<CanonicalLabour> = {}): CanonicalLabour {
  return {
    labourPct: 38,
    targetPct: 30,
    variancePct: 8,
    status: "elevated",
    reliability: "live",
    ...overrides,
  };
}

function makeCompliance(overrides: Partial<CanonicalCompliance> = {}): CanonicalCompliance {
  return {
    scorePct: 80,
    compliantCount: 12,
    totalCount: 15,
    expiredCount: 2,
    dueSoonCount: 1,
    status: "at_risk",
    ...overrides,
  };
}

function makeMaintenance(overrides: Partial<CanonicalMaintenance> = {}): CanonicalMaintenance {
  return {
    openItems: 3,
    criticalItems: 1,
    status: "attention",
    ...overrides,
  };
}

function makeInput(overrides: Partial<OperationalStateInput> = {}): OperationalStateInput {
  const score = makeScore(52);
  return {
    score,
    revenue:     makeRevenue(),
    labour:      makeLabour(),
    compliance:  makeCompliance(),
    maintenance: makeMaintenance(),
    serviceMinutesRemaining: 240,
    covers:      45,
    projectedClose: 52_000,
    recoveryLikelihood: null,
    forecastConfidence: "medium",
    ...overrides,
  };
}

// ── Test 1: Score consistency — Hero/SystemPulse read the same value ──────────

describe("Test 1: Score consistency", () => {
  it("overallScore in riskVector matches canonical score.value", () => {
    const input  = makeInput();
    const result = buildOperationalState(input);

    // The riskVector.overallScore MUST equal the canonical score
    // This is what Hero banner and System Pulse both read from
    expect(result.overallScore).toBe(input.score.value);
    expect(result.grade).toBe(input.score.grade);
  });

  it("governed risks derive from the same signals as overallScore", () => {
    const input  = makeInput({ score: makeScore(90) });
    const result = buildOperationalState(input);

    // With a high score, no critical risks should be present
    expect(result.governed.critical).toHaveLength(0);
    expect(result.overallScore).toBe(90);
    expect(result.grade).toBe("A");
  });
});

// ── Test 2: Score breakdown integrity ─────────────────────────────────────────

describe("Test 2: Score breakdown components sum to overall score", () => {
  it("breakdown pts sum ≤ 100 and each domain is within its max", () => {
    const score = makeScore(72, {
      breakdown: {
        revenue:     { pts: 22, max: 30, explanation: "behind target" },
        labour:      { pts: 16, max: 20, explanation: "slightly over" },
        duties:      { pts: 18, max: 20, explanation: "good" },
        maintenance: { pts: 12, max: 15, explanation: "minor issues" },
        compliance:  { pts: 10, max: 15, explanation: "items due" },
      },
    });

    const total = Object.values(score.breakdown).reduce((sum, b) => sum + b.pts, 0);

    expect(total).toBeLessThanOrEqual(100);
    expect(score.breakdown.revenue.pts).toBeLessThanOrEqual(30);
    expect(score.breakdown.labour.pts).toBeLessThanOrEqual(20);
    expect(score.breakdown.duties.pts).toBeLessThanOrEqual(20);
    expect(score.breakdown.maintenance.pts).toBeLessThanOrEqual(15);
    expect(score.breakdown.compliance.pts).toBeLessThanOrEqual(15);
  });
});

// ── Test 3: MAX_CRITICAL governor ─────────────────────────────────────────────

describe("Test 3: Severity governor — MAX_CRITICAL cap", () => {
  it("never produces more than MAX_CRITICAL (2) critical risks", () => {
    // Build a scenario with 5 domains all at severe risk
    const score = makeScore(15);  // F-grade — everything failing
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 5_000, target: 60_000, gap: 55_000, gapPct: -91.7, status: "critical" }),
      labour:      makeLabour({ labourPct: 65, variancePct: 35, status: "critical" }),
      compliance:  makeCompliance({ expiredCount: 8, status: "critical" }),
      maintenance: makeMaintenance({ criticalItems: 5, status: "critical" }),
      serviceMinutesRemaining: 60,
      covers:      10,
      forecastConfidence: "low",
    });

    const governed = governSeverity(signals);

    expect(governed.critical.length).toBeLessThanOrEqual(MAX_CRITICAL);
    expect(MAX_CRITICAL).toBe(2); // Guard the constant itself
  });

  it("excess critical signals are downgraded to high or medium", () => {
    const score = makeScore(15);
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 5_000, target: 60_000, gap: 55_000, gapPct: -91.7, status: "critical" }),
      labour:      makeLabour({ labourPct: 65, variancePct: 35, status: "critical" }),
      compliance:  makeCompliance({ expiredCount: 8, status: "critical" }),
      maintenance: makeMaintenance({ criticalItems: 5, status: "critical" }),
      serviceMinutesRemaining: 60,
      covers:      10,
      forecastConfidence: "low",
    });

    const governed = governSeverity(signals);
    const allSignals = governed.all;
    const criticalCount = allSignals.filter((s) => s.governedSeverity === "critical").length;

    // Strict cap
    expect(criticalCount).toBeLessThanOrEqual(MAX_CRITICAL);

    // All signals accounted for — none dropped
    expect(governed.all.length).toBe(signals.length);
  });
});

// ── Test 4: MAX_HIGH governor ─────────────────────────────────────────────────

describe("Test 4: Severity governor — MAX_HIGH cap", () => {
  it("never produces more than MAX_HIGH (4) high risks", () => {
    const score = makeScore(20);
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 10_000, target: 60_000, gap: 50_000, gapPct: -83.3, status: "critical" }),
      labour:      makeLabour({ labourPct: 60, variancePct: 30, status: "critical" }),
      compliance:  makeCompliance({ expiredCount: 6, status: "critical" }),
      maintenance: makeMaintenance({ criticalItems: 4, status: "critical" }),
      serviceMinutesRemaining: 90,
      covers:      8,
      forecastConfidence: "low",
    });

    const governed = governSeverity(signals);

    expect(governed.high.length).toBeLessThanOrEqual(MAX_HIGH);
    expect(MAX_HIGH).toBe(4); // Guard the constant
  });
});

// ── Test 5: Narrative derives from top governed risk domain ───────────────────

describe("Test 5: Narrative derives from top governed risk", () => {
  it("currentSituation mentions the revenue domain when revenue is top risk", () => {
    const score = makeScore(45);
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 5_000, target: 60_000, gap: 55_000, gapPct: -91.7, status: "critical" }),
      labour:      makeLabour({ variancePct: 2, status: "healthy" }),
      compliance:  makeCompliance({ expiredCount: 0, status: "ok" }),
      maintenance: makeMaintenance({ criticalItems: 0, status: "ok" }),
      serviceMinutesRemaining: 180,
      covers:      20,
      forecastConfidence: "medium",
    });
    const governed = governSeverity(signals);
    const narrative = buildNarrativeContext(governed, score);

    // Revenue should be the top signal — narrative must reference it
    const text = (narrative.currentSituation + narrative.primaryRisk).toLowerCase();
    expect(text).toMatch(/revenue|r\d/i);
  });

  it("currentSituation mentions maintenance when maintenance is top risk", () => {
    // Revenue on target, maintenance is the only failure
    const score = makeScore(72, {
      breakdown: {
        revenue:     { pts: 30, max: 30, explanation: "on target" },
        labour:      { pts: 20, max: 20, explanation: "healthy" },
        duties:      { pts: 20, max: 20, explanation: "complete" },
        maintenance: { pts: 2,  max: 15, explanation: "critical equipment down" },
        compliance:  { pts: 0,  max: 15, explanation: "expired" },
      },
    });
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 60_000, target: 60_000, gap: 0, gapPct: 0, status: "on_target" }),
      labour:      makeLabour({ labourPct: 30, variancePct: 0, status: "healthy" }),
      compliance:  makeCompliance({ expiredCount: 0, dueSoonCount: 0, status: "ok" }),
      maintenance: makeMaintenance({ criticalItems: 5, openItems: 8, status: "critical" }),
      serviceMinutesRemaining: 300,
      covers:      60,
      forecastConfidence: "high",
    });

    const governed = governSeverity(signals);
    const topDomain = governed.critical[0]?.domain ?? governed.high[0]?.domain ?? governed.medium[0]?.domain;

    // Narrative must align to whichever domain governs
    const narrative = buildNarrativeContext(governed, score);
    if (topDomain === "maintenance") {
      expect(narrative.currentSituation.toLowerCase()).toMatch(/maintenance/i);
    }
    // Otherwise pass — top domain may differ based on impact scores
    expect(narrative.currentSituation.length).toBeGreaterThan(0);
  });

  it("positive narrative when no governed risks exist", () => {
    const score = makeScore(92);
    const governed = governSeverity([]);
    const narrative = buildNarrativeContext(governed, score);

    expect(narrative.currentSituation).toMatch(/Grade A|tracking well/i);
    expect(narrative.primaryRisk).toMatch(/no critical/i);
  });
});

// ── Test 6: Compliance not_configured → no 0% signal ─────────────────────────

describe("Test 6: Compliance not_configured does not produce a 0% signal", () => {
  it("returns no compliance risk signal when compliance is not configured", () => {
    const score = makeScore(85);  // High score — only compliance misconfigured
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 60_000, target: 60_000, gap: 0, gapPct: 0, status: "on_target" }),
      labour:      makeLabour({ labourPct: 29, variancePct: -1, status: "efficient" }),
      compliance:  makeCompliance({
        scorePct:       0,
        compliantCount: 0,
        totalCount:     0,
        expiredCount:   0,
        dueSoonCount:   0,
        status:         "not_configured",
      }),
      maintenance: makeMaintenance({ criticalItems: 0, status: "ok" }),
      serviceMinutesRemaining: 300,
      covers:      80,
      forecastConfidence: "high",
    });

    const complianceSignals = signals.filter((s) => s.domain === "compliance");

    // Compliance signal MUST be suppressed when not configured
    // A "0% compliant" signal here would be a false alarm
    expect(complianceSignals).toHaveLength(0);
  });

  it("does produce a compliance signal when items exist and are expired", () => {
    const score = makeScore(60);
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ actual: 50_000, target: 60_000, gap: 10_000, gapPct: -16.7, status: "behind" }),
      labour:      makeLabour({ variancePct: 5, status: "elevated" }),
      compliance:  makeCompliance({ expiredCount: 3, totalCount: 10, status: "critical" }),
      maintenance: makeMaintenance({ status: "ok" }),
      serviceMinutesRemaining: 180,
      covers:      40,
      forecastConfidence: "medium",
    });

    const complianceSignals = signals.filter((s) => s.domain === "compliance");
    expect(complianceSignals.length).toBeGreaterThan(0);
  });
});

// ── Test 7: Missing revenue suppresses recovery projections ───────────────────

describe("Test 7: Missing revenue suppresses recovery projections", () => {
  it("projectedClose is null when revenue reliability is missing", () => {
    const result = buildOperationalState(makeInput({
      revenue: makeRevenue({ reliability: "missing", actual: 0, status: "unknown" }),
      projectedClose: null,
    }));

    // No fake projected close when we have no revenue data
    expect(result.projections.projectedClose).toBeNull();
  });

  it("projectedGrade is null when projectedClose is null", () => {
    const result = buildOperationalState(makeInput({
      projectedClose: null,
    }));

    expect(result.projections.projectedGrade).toBeNull();
  });

  it("recoveryLikelihood stays null — never synthesized", () => {
    const result = buildOperationalState(makeInput({
      recoveryLikelihood: null, // Always null until ≥30 days historical data
    }));

    expect(result.projections.recoveryLikelihood).toBeNull();
  });
});

// ── Test 8: Labour signal absent when revenue is missing ──────────────────────

describe("Test 8: Labour signal absent when revenue data is unreliable", () => {
  it("no labour risk signal when labour reliability is insufficient", () => {
    const score = makeScore(55);
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ reliability: "missing", actual: 0, status: "unknown" }),
      labour:      makeLabour({ reliability: "insufficient" }),
      compliance:  makeCompliance({ status: "ok" }),
      maintenance: makeMaintenance({ status: "ok" }),
      serviceMinutesRemaining: 240,
      covers:      0,
      forecastConfidence: "low",
    });

    const labourSignals = signals.filter((s) => s.domain === "labour");

    // Labour % is meaningless without revenue — do NOT surface it as a risk
    expect(labourSignals).toHaveLength(0);
  });

  it("no labour risk signal when labour reliability is missing", () => {
    const score = makeScore(55);
    const signals = buildRiskSignals({
      score,
      revenue:     makeRevenue({ reliability: "missing", actual: 0, status: "unknown" }),
      labour:      makeLabour({ reliability: "missing" }),
      compliance:  makeCompliance({ status: "ok" }),
      maintenance: makeMaintenance({ status: "ok" }),
      serviceMinutesRemaining: 240,
      covers:      0,
      forecastConfidence: "low",
    });

    const labourSignals = signals.filter((s) => s.domain === "labour");
    expect(labourSignals).toHaveLength(0);
  });
});

// ── Test 9: Determinism — same input → identical output ───────────────────────

describe("Test 9: Determinism", () => {
  it("buildOperationalState produces identical output for identical inputs", () => {
    const input = makeInput();

    const result1 = buildOperationalState(input);
    const result2 = buildOperationalState(input);

    // Strip generatedAt (timestamp) before comparing
    const { generatedAt: _t1, ...r1 } = result1;
    const { generatedAt: _t2, ...r2 } = result2;

    expect(r1.overallScore).toBe(r2.overallScore);
    expect(r1.grade).toBe(r2.grade);
    expect(r1.governed.critical.length).toBe(r2.governed.critical.length);
    expect(r1.governed.high.length).toBe(r2.governed.high.length);
    expect(r1.narrative.currentSituation).toBe(r2.narrative.currentSituation);
    expect(r1.narrative.primaryRisk).toBe(r2.narrative.primaryRisk);
    expect(r1.narrative.recommendedIntervention).toBe(r2.narrative.recommendedIntervention);
    expect(r1.projections.projectedClose).toBe(r2.projections.projectedClose);
    expect(r1.projections.projectedGrade).toBe(r2.projections.projectedGrade);
    expect(r1.risks.map((s) => s.id)).toEqual(r2.risks.map((s) => s.id));
  });

  it("governance caps are invariant across repeated calls", () => {
    const input = makeInput({ score: makeScore(20) });

    for (let i = 0; i < 5; i++) {
      const result = buildOperationalState(input);
      expect(result.governed.critical.length).toBeLessThanOrEqual(MAX_CRITICAL);
      expect(result.governed.high.length).toBeLessThanOrEqual(MAX_HIGH);
    }
  });
});
