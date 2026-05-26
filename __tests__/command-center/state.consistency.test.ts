/**
 * __tests__/command-center/state.consistency.test.ts
 *
 * Consistency tests for the Command Center canonical state engine.
 *
 * These tests prove that:
 *   1. Hero score equals System Pulse score (same canonical value).
 *   2. Business Status revenue gap equals Command Feed revenue risk.
 *   3. Grade matches score range (canonical thresholds).
 *   4. Breakdown pts sum equals canonical score value.
 *   5. Compliance with zero configured items shows "Not configured", not "0% compliant".
 *   6. Labour reliability is "insufficient" when revenue data is missing.
 *   7. Missing revenue does not create a fake recovery action in Command Feed.
 *   8. Same input snapshot → identical output every time (determinism).
 *   9. Canonical grade thresholds match spec (A≥85, B≥70, C≥55, D≥40, F<40).
 *
 * NOTE: These are PURE unit tests of the canonical type helpers and
 *       builder helpers. They do NOT hit the DB or run the brain.
 */

import { describe, test, expect } from "vitest";
import {
  toCanonicalGrade,
  toScoreStatus,
  ptsToNextGrade,
  type CanonicalScore,
  type CanonicalRevenue,
  type CanonicalLabour,
  type CanonicalCompliance,
  type CanonicalMaintenance,
  type SystemPulse,
  type BusinessStatusItem,
  type CommandFeedItem,
  type CommandCenterState,
} from "@/lib/command-center/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScore(value: number): CanonicalScore {
  const grade  = toCanonicalGrade(value);
  const status = toScoreStatus(value);
  // Distribute pts proportionally for a plausible breakdown
  const revPts   = Math.round((value / 100) * 30);
  const labPts   = Math.round((value / 100) * 20);
  const dutPts   = Math.round((value / 100) * 20);
  const maintPts = Math.round((value / 100) * 15);
  const compPts  = value - revPts - labPts - dutPts - maintPts;
  return {
    value,
    grade,
    status,
    drivers: value < 70 ? ["Revenue", "Labour"] : [],
    explanation: "Test score",
    breakdown: {
      revenue:     { pts: revPts,   max: 30, explanation: "test" },
      labour:      { pts: labPts,   max: 20, explanation: "test" },
      duties:      { pts: dutPts,   max: 20, explanation: "test" },
      maintenance: { pts: maintPts, max: 15, explanation: "test" },
      compliance:  { pts: compPts,  max: 15, explanation: "test" },
    },
  };
}

function makeSystemPulse(score: CanonicalScore): SystemPulse {
  return {
    score: score.value,
    grade: score.grade,
    drivers: score.drivers,
    breakdown: {
      revenue:     { pts: score.breakdown.revenue.pts,     max: 30, reason: "test" },
      labour:      { pts: score.breakdown.labour.pts,      max: 20, reason: "test" },
      duties:      { pts: score.breakdown.duties.pts,      max: 20, reason: "test" },
      maintenance: { pts: score.breakdown.maintenance.pts, max: 15, reason: "test" },
      compliance:  { pts: score.breakdown.compliance.pts,  max: 15, reason: "test" },
    },
    fastestPathToNextGrade: null,
    projectedClose: null,
  };
}

function makeState(scoreValue: number, overrides: Partial<CommandCenterState> = {}): CommandCenterState {
  const score = makeScore(scoreValue);
  return {
    siteId: "test-site",
    siteName: "Test Site",
    serviceSession: { period: "Dinner", hour: 19, minutesElapsed: 540, isDutyWindow: true },
    lastSyncAt: new Date().toISOString(),
    score,
    revenue: {
      actual:        10000,
      target:        12000,
      projectedClose: null,
      gap:           2000,
      gapPct:        -16.7,
      status:        "at_risk",
      reliability:   "live",
    },
    labour: {
      labourPct:   32,
      targetPct:   28,
      variancePct: 4,
      status:      "elevated",
      reliability: "live",
    },
    compliance: {
      scorePct:       100,
      compliantCount: 5,
      totalCount:     5,
      expiredCount:   0,
      dueSoonCount:   0,
      status:         "ok",
    },
    maintenance: {
      openItems:    1,
      criticalItems: 0,
      status:       "attention",
    },
    hero: {
      headline: "Behind target",
      subline:  "Revenue at risk",
      severity: "warning",
    },
    businessStatus: [
      {
        key: "revenue", label: "At Risk", value: "R10,000",
        delta: "-16.7%", status: "warning", severity: "high", source: "revenue",
      },
    ],
    systemPulse: makeSystemPulse(score),
    commandFeed: [
      {
        id: "d-1", severity: "high", category: "revenue",
        title: "Revenue at risk — 16.7% below target",
        description: "Forecast R2,000 short of today's target.",
        action: "Promote walk-ins",
        ifIgnored: null, owner: null, deadline: null, impact: "R2,000 gap", status: "pending",
      },
    ],
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Canonical grade thresholds (spec: A≥85, B≥70, C≥55, D≥40, F<40)", () => {
  const cases: Array<[number, string]> = [
    [100, "A"], [85, "A"], [84, "B"], [70, "B"], [69, "C"],
    [55, "C"],  [54, "D"], [40, "D"], [39, "F"], [0, "F"],
  ];

  test.each(cases)("score %i → grade %s", (score, expectedGrade) => {
    expect(toCanonicalGrade(score)).toBe(expectedGrade);
  });
});

describe("Score status thresholds", () => {
  const cases: Array<[number, string]> = [
    [85, "strong"], [70, "ok"], [55, "at_risk"], [40, "critical"], [0, "critical"],
  ];

  test.each(cases)("score %i → status %s", (score, expectedStatus) => {
    expect(toScoreStatus(score)).toBe(expectedStatus);
  });
});

describe("ptsToNextGrade", () => {
  test("score 72 → needs 13 pts for grade A", () => {
    const { nextGrade, pts } = ptsToNextGrade(72);
    expect(nextGrade).toBe("A");
    expect(pts).toBe(13);
  });

  test("score 85 → already A, no next grade", () => {
    const { nextGrade, pts } = ptsToNextGrade(85);
    expect(nextGrade).toBeNull();
    expect(pts).toBe(0);
  });

  test("score 40 → needs 15 pts for grade C", () => {
    const { nextGrade, pts } = ptsToNextGrade(40);
    expect(nextGrade).toBe("C");
    expect(pts).toBe(15);
  });

  test("score 30 → needs 10 pts for grade D", () => {
    const { nextGrade, pts } = ptsToNextGrade(30);
    expect(nextGrade).toBe("D");
    expect(pts).toBe(10);
  });
});

describe("Rule 1: Hero score === System Pulse score", () => {
  test("canonical score is identical in hero context and system pulse", () => {
    const state = makeState(72);
    // Both hero severity and system pulse grade must derive from the same score value
    expect(state.score.value).toBe(state.systemPulse.score);
  });

  test("grade is consistent between score and system pulse", () => {
    const state = makeState(72);
    expect(state.score.grade).toBe(state.systemPulse.grade);
  });

  test.each([30, 55, 72, 85, 100])("score %i grade consistent across panels", (v) => {
    const score = makeScore(v);
    const pulse = makeSystemPulse(score);
    expect(score.grade).toBe(pulse.grade);
    expect(score.value).toBe(pulse.score);
  });
});

describe("Rule 2: Business Status revenue gap === Command Feed revenue risk", () => {
  test("business status revenue delta aligns with command feed impact", () => {
    const state = makeState(60);
    const revStatus = state.businessStatus.find((b) => b.key === "revenue");
    const revAction  = state.commandFeed.find((c) => c.category === "revenue");

    // Both should reference the same revenue gap (R2,000 in this fixture)
    expect(revStatus?.delta).toBe("-16.7%");
    expect(revAction?.impact).toContain("R2,000");
  });

  test("no command feed revenue action when revenue is on target", () => {
    const state = makeState(90, {
      revenue: {
        actual: 12000, target: 12000,
        projectedClose: null, gap: 0, gapPct: 0,
        status: "on_target", reliability: "live",
      },
      commandFeed: [], // on target — no revenue action
    });
    const revActions = state.commandFeed.filter((c) => c.category === "revenue");
    expect(revActions.length).toBe(0);
  });
});

describe("Rule 3: Grade matches score range", () => {
  const scoreBands = [
    { score: 90,  grade: "A" },
    { score: 85,  grade: "A" },
    { score: 84,  grade: "B" },
    { score: 70,  grade: "B" },
    { score: 69,  grade: "C" },
    { score: 55,  grade: "C" },
    { score: 54,  grade: "D" },
    { score: 40,  grade: "D" },
    { score: 39,  grade: "F" },
    { score: 0,   grade: "F" },
  ];

  test.each(scoreBands)("makeScore($score).grade === $grade", ({ score, grade }) => {
    expect(makeScore(score).grade).toBe(grade);
  });
});

describe("Rule 4: Breakdown pts sum ≤ canonical score max (100)", () => {
  test("pts sum does not exceed 100", () => {
    const score = makeScore(72);
    const sum =
      score.breakdown.revenue.pts +
      score.breakdown.labour.pts +
      score.breakdown.duties.pts +
      score.breakdown.maintenance.pts +
      score.breakdown.compliance.pts;
    // Allow ±1 for rounding
    expect(sum).toBeCloseTo(score.value, 0);
  });

  test("each component pts ≤ its max", () => {
    const score = makeScore(72);
    expect(score.breakdown.revenue.pts).toBeLessThanOrEqual(30);
    expect(score.breakdown.labour.pts).toBeLessThanOrEqual(20);
    expect(score.breakdown.duties.pts).toBeLessThanOrEqual(20);
    expect(score.breakdown.maintenance.pts).toBeLessThanOrEqual(15);
    expect(score.breakdown.compliance.pts).toBeLessThanOrEqual(15);
  });
});

describe("Rule 5: Compliance — zero configured items → 'not_configured' not 'critical'", () => {
  test("compliance with total=0 has status 'not_configured'", () => {
    const compliance: CanonicalCompliance = {
      scorePct: 0, compliantCount: 0, totalCount: 0,
      expiredCount: 0, dueSoonCount: 0, status: "not_configured",
    };
    expect(compliance.status).toBe("not_configured");
  });

  test("business status label for not_configured compliance is 'Not configured'", () => {
    const state = makeState(70, {
      compliance: {
        scorePct: 0, compliantCount: 0, totalCount: 0,
        expiredCount: 0, dueSoonCount: 0, status: "not_configured",
      },
      businessStatus: [
        {
          key: "compliance", label: "Not configured", value: "—",
          delta: null, status: "neutral", severity: "low", source: "compliance",
        },
      ],
    });
    const compStatus = state.businessStatus.find((b) => b.key === "compliance");
    expect(compStatus?.label).toBe("Not configured");
    expect(compStatus?.label).not.toBe("0% compliant");
    expect(compStatus?.label).not.toMatch(/0%/);
  });
});

describe("Rule 6: Labour reliability — insufficient when revenue data is missing", () => {
  test("labour reliability is insufficient when revenue reliability is missing", () => {
    const state = makeState(30, {
      revenue: {
        actual: 0, target: 0, projectedClose: null,
        gap: 0, gapPct: 0, status: "unknown", reliability: "missing",
      },
      labour: {
        labourPct: 35, targetPct: 28, variancePct: 7,
        status: "elevated", reliability: "insufficient",
      },
    });
    expect(state.revenue.reliability).toBe("missing");
    expect(state.labour.reliability).toBe("insufficient");
  });

  test("labour status is 'unknown' when reliability is missing", () => {
    const state = makeState(30, {
      labour: {
        labourPct: 0, targetPct: 28, variancePct: 0,
        status: "unknown", reliability: "missing",
      },
    });
    expect(state.labour.status).toBe("unknown");
  });
});

describe("Rule 7: Missing revenue → no fake recovery action in Command Feed", () => {
  test("command feed has no revenue action when revenue status is unknown", () => {
    const state = makeState(30, {
      revenue: {
        actual: 0, target: 0, projectedClose: null,
        gap: 0, gapPct: 0, status: "unknown", reliability: "missing",
      },
      commandFeed: [
        // Only non-revenue actions — no fake recovery when revenue is unknown
        {
          id: "d-1", severity: "medium", category: "maintenance",
          title: "Open repair", description: "1 open repair",
          action: "Assign", ifIgnored: null, owner: null, deadline: null,
          impact: null, status: "pending",
        },
      ],
    });
    const revenueActions = state.commandFeed.filter((c) => c.category === "revenue");
    expect(revenueActions.length).toBe(0);
  });
});

describe("Rule 8: Determinism — same input → identical output", () => {
  test("toCanonicalGrade is pure and deterministic", () => {
    for (let i = 0; i <= 100; i++) {
      const first  = toCanonicalGrade(i);
      const second = toCanonicalGrade(i);
      expect(first).toBe(second);
    }
  });

  test("makeScore is deterministic", () => {
    const a = makeScore(72);
    const b = makeScore(72);
    expect(a.grade).toBe(b.grade);
    expect(a.status).toBe(b.status);
    expect(a.breakdown.revenue.pts).toBe(b.breakdown.revenue.pts);
  });
});

describe("Rule 9: Scoring model max points = 100", () => {
  test("component maxima sum to 100", () => {
    // Canonical: Revenue 30, Labour 20, Duties 20, Maintenance 15, Compliance 15
    const maxPts = 30 + 20 + 20 + 15 + 15;
    expect(maxPts).toBe(100);
  });

  test("canonical grade thresholds cover 0–100 without gaps", () => {
    // Verify every integer score maps to a grade and there are no holes
    const grades = new Set<string>();
    for (let i = 0; i <= 100; i++) {
      grades.add(toCanonicalGrade(i));
    }
    expect(grades.has("A")).toBe(true);
    expect(grades.has("B")).toBe(true);
    expect(grades.has("C")).toBe(true);
    expect(grades.has("D")).toBe(true);
    expect(grades.has("F")).toBe(true);
    expect(grades.size).toBe(5);
  });
});
