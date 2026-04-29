/**
 * __tests__/scoring/operatingScore.test.ts
 *
 * Unit tests for the pure operating-score calculator.
 *
 * Test cases:
 *   1. Revenue on target + labour on target → high score / grade A
 *   2. Revenue 25% of target + labour 48% → grade D or F
 *   3. Compliance expired items reduce score
 *   4. Missing labour data sets confidence to low
 *   5. Score is clamped 0–100
 *   6. Service window urgency penalty applies
 *   7. Revenue interaction penalty for labour
 *   8. Maintenance critical issue penalty
 */

import { describe, it, expect } from "vitest";
import {
  calculateOperatingScore,
  calcRevenueScore,
  calcLabourScore,
  calcComplianceScore,
  calcMaintenanceScore,
  toGrade,
  type OperatingScoreInput,
} from "../../lib/scoring/operatingScore";

// ── toGrade ───────────────────────────────────────────────────────────────────

describe("toGrade", () => {
  it("maps 90–100 to A", () => {
    expect(toGrade(100)).toBe("A");
    expect(toGrade(90)).toBe("A");
  });
  it("maps 75–89 to B", () => {
    expect(toGrade(89)).toBe("B");
    expect(toGrade(75)).toBe("B");
  });
  it("maps 60–74 to C", () => {
    expect(toGrade(74)).toBe("C");
    expect(toGrade(60)).toBe("C");
  });
  it("maps 40–59 to D", () => {
    expect(toGrade(59)).toBe("D");
    expect(toGrade(40)).toBe("D");
  });
  it("maps 0–39 to F", () => {
    expect(toGrade(39)).toBe("F");
    expect(toGrade(0)).toBe("F");
  });
});

// ── calcRevenueScore ──────────────────────────────────────────────────────────

describe("calcRevenueScore", () => {
  it("returns rawScore 100 when actual >= target", () => {
    const { rawScore } = calcRevenueScore(10_000, 10_000);
    expect(rawScore).toBe(100);
  });

  it("returns rawScore 0 when data is missing", () => {
    const { rawScore } = calcRevenueScore(null, null);
    expect(rawScore).toBe(0);
  });

  it("applies gap penalty for revenue < 30% of target", () => {
    // 25% of target → base = 25, gap penalty = 20 → 5
    const { rawScore } = calcRevenueScore(2_500, 10_000);
    expect(rawScore).toBeLessThan(10);
  });

  it("applies urgency penalty when window <= 60 min and pace < 75%", () => {
    const noUrgency = calcRevenueScore(5_000, 10_000);             // 50% pace
    const withUrgency = calcRevenueScore(5_000, 10_000, 59);        // 59 min remaining
    expect(withUrgency.rawScore).toBeLessThan(noUrgency.rawScore);
  });

  it("explanation mentions actual, target and gap", () => {
    const { explanation } = calcRevenueScore(8_940, 35_437);
    expect(explanation).toContain("R8");
    expect(explanation).toContain("R35");
    expect(explanation).toContain("gap");
  });
});

// ── calcLabourScore ───────────────────────────────────────────────────────────

describe("calcLabourScore", () => {
  it("returns rawScore 100 when labour is on target", () => {
    const { rawScore } = calcLabourScore(28, null, null, 30);
    expect(rawScore).toBe(100);
  });

  it("returns rawScore 0 when labour data is missing", () => {
    const { rawScore } = calcLabourScore(null, null, null, 30);
    expect(rawScore).toBe(0);
  });

  it("degrades score by 4 pts per % over target", () => {
    // 35% labour, 30% target → delta=5 → 100 - 5*4 = 80
    const { rawScore } = calcLabourScore(35, null, null, 30);
    expect(rawScore).toBe(80);
  });

  it("scores labour 48% vs target 30% as low (delta=18 → 28)", () => {
    const { rawScore } = calcLabourScore(48, null, null, 30);
    expect(rawScore).toBe(28);
  });

  it("applies revenue interaction penalty when revenue is also low", () => {
    // Revenue < 60% of target + labour over target → extra -15
    const baseScore    = calcLabourScore(35, 6_001, 10_000, 30);  // 60.01% — no penalty
    const penaltyScore = calcLabourScore(35, 5_999, 10_000, 30);  // 59.99% — penalty applies
    expect(penaltyScore.rawScore).toBeLessThan(baseScore.rawScore);
  });

  it("applies stronger penalty when revenue < 40% of target", () => {
    const mild  = calcLabourScore(35, 5_999, 10_000, 30);  // < 60%
    const harsh = calcLabourScore(35, 3_999, 10_000, 30);  // < 40%
    expect(harsh.rawScore).toBeLessThan(mild.rawScore);
  });
});

// ── calcComplianceScore ───────────────────────────────────────────────────────

describe("calcComplianceScore", () => {
  it("returns rawScore 100 when all items compliant", () => {
    const { rawScore } = calcComplianceScore(10, 10, 0, 0);
    expect(rawScore).toBe(100);
  });

  it("returns default 70 when data is missing", () => {
    const { rawScore, hasData } = calcComplianceScore(null, null, null, null);
    expect(rawScore).toBe(70);
    expect(hasData).toBe(false);
  });

  it("deducts 15 pts per expired item", () => {
    // 10/10 compliant (base=100), 1 expired → -15 → 85
    const { rawScore } = calcComplianceScore(10, 10, 1, 0);
    expect(rawScore).toBe(85);
  });

  it("deducts 5 pts per due-soon item", () => {
    // 10/10 compliant, 2 due soon → base=100, -10 → 90
    const { rawScore } = calcComplianceScore(10, 10, 0, 2);
    expect(rawScore).toBe(90);
  });

  it("clamps score at 0 for many expired items", () => {
    const { rawScore } = calcComplianceScore(10, 0, 10, 0);
    expect(rawScore).toBe(0);
  });
});

// ── calcMaintenanceScore ──────────────────────────────────────────────────────

describe("calcMaintenanceScore", () => {
  it("returns rawScore 100 when no open issues", () => {
    const { rawScore } = calcMaintenanceScore(0, 0, 0);
    expect(rawScore).toBe(100);
  });

  it("returns default 80 when data is missing", () => {
    const { rawScore, hasData } = calcMaintenanceScore(null, null, null);
    expect(rawScore).toBe(80);
    expect(hasData).toBe(false);
  });

  it("deducts 20 pts per critical issue", () => {
    // 1 open, 1 critical out of 5 total → clearPct=80 → 80, -20 = 60
    const { rawScore } = calcMaintenanceScore(5, 1, 1);
    expect(rawScore).toBe(60);
  });

  it("clamps at 0 for all critical issues", () => {
    const { rawScore } = calcMaintenanceScore(3, 3, 6); // 6 critical would push to negative
    expect(rawScore).toBe(0);
  });
});

// ── calculateOperatingScore (integration) ────────────────────────────────────

describe("calculateOperatingScore", () => {
  const FULL_TARGET: OperatingScoreInput = {
    actualRevenue:        35_000,
    targetRevenue:        35_000,
    labourPct:            28,
    targetLabourPct:      30,
    totalComplianceItems: 10,
    compliantItems:       10,
    expiredItems:         0,
    dueSoonItems:         0,
    totalMaintenanceItems: 0,
    openIssues:           0,
    criticalIssues:       0,
  };

  it("TC1: on-target revenue + on-target labour → grade A", () => {
    const result = calculateOperatingScore(FULL_TARGET);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe("A");
    expect(result.confidence).toBe("high");
  });

  it("TC2: revenue 25% of target + labour 48% → grade D or F", () => {
    const result = calculateOperatingScore({
      actualRevenue:        2_500,
      targetRevenue:        10_000,
      labourPct:            48,
      targetLabourPct:      30,
      totalComplianceItems: 5,
      compliantItems:       5,
      expiredItems:         0,
      dueSoonItems:         0,
      totalMaintenanceItems: 0,
      openIssues:           0,
      criticalIssues:       0,
    });
    expect(result.grade).toMatch(/^[DF]$/);
    expect(result.score).toBeLessThan(60);
  });

  it("TC3: expired compliance items reduce score", () => {
    const good = calculateOperatingScore(FULL_TARGET);
    const withExpired = calculateOperatingScore({
      ...FULL_TARGET,
      expiredItems: 3,
      compliantItems: 7,
    });
    expect(withExpired.score).toBeLessThan(good.score);
  });

  it("TC4: missing labour data sets confidence to low", () => {
    const result = calculateOperatingScore({
      actualRevenue: 35_000,
      targetRevenue: 35_000,
      labourPct:     null,   // no labour data
    });
    expect(result.confidence).toBe("low");
  });

  it("TC5: score is clamped between 0 and 100", () => {
    const high = calculateOperatingScore(FULL_TARGET);
    expect(high.score).toBeGreaterThanOrEqual(0);
    expect(high.score).toBeLessThanOrEqual(100);

    const low = calculateOperatingScore({
      actualRevenue: 0,
      targetRevenue: 100_000,
      labourPct:     99,
      expiredItems:  10,
      criticalIssues: 5,
    });
    expect(low.score).toBeGreaterThanOrEqual(0);
    expect(low.score).toBeLessThanOrEqual(100);
  });

  it("TC6: component maxPoints sum to 100", () => {
    const result = calculateOperatingScore(FULL_TARGET);
    const total =
      result.components.revenue.maxPoints +
      result.components.labour.maxPoints +
      result.components.compliance.maxPoints +
      result.components.maintenance.maxPoints;
    expect(total).toBe(100);
  });

  it("TC7: weightedScore never exceeds maxPoints", () => {
    const result = calculateOperatingScore(FULL_TARGET);
    expect(result.components.revenue.weightedScore).toBeLessThanOrEqual(45);
    expect(result.components.labour.weightedScore).toBeLessThanOrEqual(30);
    expect(result.components.compliance.weightedScore).toBeLessThanOrEqual(15);
    expect(result.components.maintenance.weightedScore).toBeLessThanOrEqual(10);
  });

  it("TC8: drivers list is populated when components score below 60", () => {
    const result = calculateOperatingScore({
      actualRevenue: 1_000,
      targetRevenue: 10_000,
      labourPct:     50,
    });
    expect(result.drivers.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Driven by");
  });

  it("TC9: no drivers when all components perform well", () => {
    const result = calculateOperatingScore(FULL_TARGET);
    expect(result.drivers).toHaveLength(0);
    expect(result.summary).toBe("All systems operating well");
  });
});
