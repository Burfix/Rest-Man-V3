/**
 * __tests__/engine/recoveryEngine.test.ts
 *
 * Unit tests for calculateRecoveryOpportunity()
 *
 * Test cases:
 *   1. Full recovery possible (wide window, sufficient capacity)
 *   2. Partial recovery only (insufficient capacity to close gap)
 *   3. Closed window (minutesRemaining = 0)
 *   4. Missing avgSpend → confidence low
 *   5. Labour over target adds staffing action
 *   6. On target — gap = 0
 *   7. Narrow window (≤ 60 min)
 *   8. serviceCapacityCovers constraint respected
 *   9. Explanation contains cover count and recoverable amount
 */

import { describe, it, expect } from "vitest";
import {
  calculateRecoveryOpportunity,
  type RecoveryInput,
} from "../../lib/engine/recoveryEngine";

const BASE: RecoveryInput = {
  revenueActual:       20_000,
  revenueTarget:       25_000,
  avgSpend:            270,
  coversActual:        74,
  coversTarget:        93,
  minutesRemaining:    120,
  avgTurnMinutes:      45,
  availableTables:     6,
  serviceCapacityCovers: 100,   // plenty of capacity so engine can fully recover the gap
  labourPct:           28,
  targetLabourPct:     30,
};

describe("calculateRecoveryOpportunity", () => {

  // ── TC1: Full recovery possible ───────────────────────────────────────────
  it("TC1: full recovery — gap smaller than capacity → recoverablePct = 1", () => {
    // Gap = 5,000; coversGap = ceil(5000/270) = 19; capacity = 30 covers available
    const result = calculateRecoveryOpportunity(BASE);
    expect(result.revenueGap).toBe(5_000);
    expect(result.coversGap).toBe(Math.ceil(5_000 / 270));
    expect(result.recoverablePct).toBe(1);
    expect(result.recoverableRevenue).toBeLessThanOrEqual(result.revenueGap);
    expect(result.window).toBe("wide");
    expect(result.confidence).toBe("high");
  });

  // ── TC2: Partial recovery only ────────────────────────────────────────────
  it("TC2: partial recovery — capacity < coversGap → recoverablePct < 1", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      revenueActual:          5_000,
      revenueTarget:          25_000,
      serviceCapacityCovers:  10,   // only 10 covers left vs 75 needed
      coversActual:           74,
    });
    expect(result.revenueGap).toBe(20_000);
    expect(result.recoverablePct).toBeLessThan(1);
    expect(result.recoverableCovers).toBeLessThanOrEqual(10);
    expect(result.actions).toContain("Focus on high-value upsell");
  });

  // ── TC3: Closed window ────────────────────────────────────────────────────
  it("TC3: closed window — no recovery possible", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      minutesRemaining: 0,
    });
    expect(result.window).toBe("closed");
    expect(result.recoverableRevenue).toBe(0);
    expect(result.recoverableCovers).toBe(0);
    expect(result.actions[0]).toContain("Service window closed");
    expect(result.explanation).toContain("no further recovery");
  });

  // ── TC4: Missing avgSpend ─────────────────────────────────────────────────
  it("TC4: missing avgSpend (0) → confidence low", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      avgSpend: 0,
    });
    expect(result.confidence).toBe("low");
    expect(result.recoverableRevenue).toBe(0);
    expect(result.coversGap).toBe(0);
    expect(result.explanation).toContain("missing data");
  });

  // ── TC5: Labour over target adds staffing action ──────────────────────────
  it("TC5: labour over target appends staffing action", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      labourPct:       38,
      targetLabourPct: 30,
    });
    expect(result.actions).toContain("Review staffing before next service window");
  });

  // ── TC6: On target — gap = 0 ──────────────────────────────────────────────
  it("TC6: on target — revenueGap = 0, explanation says on target", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      revenueActual: 25_000,
      revenueTarget: 25_000,
    });
    expect(result.revenueGap).toBe(0);
    expect(result.recoverablePct).toBe(1);
    expect(result.explanation).toContain("On target");
  });

  // ── TC7: Narrow window ────────────────────────────────────────────────────
  it("TC7: narrow window (≤60 min remaining)", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      minutesRemaining: 45,
    });
    expect(result.window).toBe("narrow");
    expect(result.explanation).toContain("narrow window");
  });

  // ── TC8: serviceCapacityCovers constraint ────────────────────────────────
  it("TC8: recoverableCovers never exceeds serviceCapacityCovers - coversActual", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      serviceCapacityCovers: 80,
      coversActual:          70,  // only 10 slots remain in capacity
    });
    expect(result.recoverableCovers).toBeLessThanOrEqual(10);
  });

  // ── TC9: Explanation format ───────────────────────────────────────────────
  it("TC9: explanation contains 'Recoverable' with amount and covers", () => {
    const result = calculateRecoveryOpportunity(BASE);
    expect(result.explanation).toMatch(/Recoverable:/);
    expect(result.explanation).toMatch(/R\d/);      // has a Rand amount
    expect(result.explanation).toMatch(/\+\d+ cover/); // has cover count
  });

  // ── TC10: Missing target → confidence low ────────────────────────────────
  it("TC10: missing revenueTarget (0) → confidence low", () => {
    const result = calculateRecoveryOpportunity({
      ...BASE,
      revenueTarget: 0,
    });
    expect(result.confidence).toBe("low");
    expect(result.revenueGap).toBe(0);
  });

});
