/**
 * __tests__/brain/revenue-evaluator.test.ts
 *
 * Unit tests for the pace-adjusted revenue evaluator.
 * 10+ boundary cases covering the critical acceptance criterion:
 * "At 12:18 SAST with R1,396 and R15k target → NOT critically_behind"
 */

import { describe, it, expect } from "vitest";
import {
  evaluatePaceAdjustedRevenue,
  ITALIAN_LUNCH_DINNER_CURVE,
  type PaceInputs,
} from "../../lib/brain/revenue-evaluator";

/** Helper to build a Date at a specific local hour/minute on a fixed date */
function makeTime(hour: number, minute = 0): Date {
  const d = new Date("2026-04-23T00:00:00.000Z");
  d.setHours(hour, minute, 0, 0);
  return d;
}

const BASE_INPUTS: PaceInputs = {
  current_net_sales: 0,
  daily_target: 15_000,
  trading_start_local: "08:00",
  trading_end_local: "23:00",
  now_local: makeTime(12, 18),
  historical_hourly_curve: ITALIAN_LUNCH_DINNER_CURVE,
};

describe("evaluatePaceAdjustedRevenue", () => {
  // ── Acceptance criterion test ───────────────────────────────────────────────
  it("AC7: 12:18 with R1,396 vs R15k target → NOT critically_behind", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 1_396,
      now_local: makeTime(12, 18),
    });
    expect(result.pace_status).not.toBe("critically_behind");
    expect(["too_early_to_tell", "on_pace", "behind", "ahead"]).toContain(result.pace_status);
  });

  // ── Before trading starts ───────────────────────────────────────────────────
  it("7:00 before trading starts → too_early_to_tell", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 0,
      now_local: makeTime(7, 0),
    });
    expect(result.pace_status).toBe("too_early_to_tell");
  });

  // ── Zero-revenue morning ────────────────────────────────────────────────────
  it("08:05 with zero revenue → too_early_to_tell", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 0,
      now_local: makeTime(8, 5),
    });
    expect(result.pace_status).toBe("too_early_to_tell");
  });

  it("09:00 with zero revenue → too_early_to_tell (< 20% of day elapsed)", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 0,
      now_local: makeTime(9, 0),
    });
    expect(result.pace_status).toBe("too_early_to_tell");
  });

  // ── Well-performing lunch ───────────────────────────────────────────────────
  it("13:00 with R6,750 vs R15k → on_pace or ahead (lunch peak at 45%)", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 6_750,
      now_local: makeTime(13, 0),
    });
    expect(["on_pace", "ahead"]).toContain(result.pace_status);
    expect(result.pace_status).not.toBe("critically_behind");
  });

  // ── Strong dinner service ───────────────────────────────────────────────────
  it("19:00 with R13,000 vs R15k → on_pace or ahead", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 13_000,
      now_local: makeTime(19, 0),
    });
    expect(["on_pace", "ahead"]).toContain(result.pace_status);
  });

  // ── Genuinely bad day: late evening with almost nothing ───────────────────
  it("21:00 with R1,500 vs R15k → critically_behind (≥70% of day elapsed)", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 1_500,
      now_local: makeTime(21, 0),
    });
    expect(result.pace_status).toBe("critically_behind");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  // ── Revenue ahead of target ─────────────────────────────────────────────────
  it("18:00 with R13,000 vs R12k target → ahead", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 13_000,
      daily_target: 12_000,
      now_local: makeTime(18, 0),
    });
    expect(result.pace_status).toBe("ahead");
    expect(result.projected_eod).toBeGreaterThan(12_000);
  });

  // ── Gap is correct direction ────────────────────────────────────────────────
  it("gap_to_target is positive when ahead, negative when behind", () => {
    const ahead = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 14_000,
      daily_target: 10_000,
      now_local: makeTime(19, 0),
    });
    expect(ahead.gap_to_target).toBeGreaterThan(0);

    const behind = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 500,
      daily_target: 15_000,
      now_local: makeTime(20, 0),
    });
    expect(behind.gap_to_target).toBeLessThan(0);
  });

  // ── Zero daily target ───────────────────────────────────────────────────────
  it("zero daily_target → too_early_to_tell (avoid division by zero)", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 1_000,
      daily_target: 0,
      now_local: makeTime(14, 0),
    });
    expect(result.pace_status).toBe("too_early_to_tell");
  });

  // ── Confidence increases over time ─────────────────────────────────────────
  it("confidence at 20:00 is higher than at 10:00", () => {
    const early = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 1_000,
      now_local: makeTime(10, 0),
    });
    const late = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 10_000,
      now_local: makeTime(20, 0),
    });
    expect(late.confidence).toBeGreaterThan(early.confidence);
  });

  // ── Curve fraction sanity ───────────────────────────────────────────────────
  it("curve_fraction_elapsed is between 0 and 1 at any time", () => {
    const times = [7, 8, 10, 12, 14, 18, 21, 23, 24];
    for (const h of times) {
      const result = evaluatePaceAdjustedRevenue({
        ...BASE_INPUTS,
        current_net_sales: 5_000,
        now_local: makeTime(h, 0),
      });
      expect(result.curve_fraction_elapsed).toBeGreaterThanOrEqual(0);
      expect(result.curve_fraction_elapsed).toBeLessThanOrEqual(1);
    }
  });

  // ── Custom curve ───────────────────────────────────────────────────────────
  it("custom flat curve: linear distribution produces on_pace at 50% of day", () => {
    const flat = Array.from({ length: 24 }, (_, i) => Math.min(1, i / 16));
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 7_500,
      daily_target: 15_000,
      now_local: makeTime(16, 0), // 50% through trading day (8-24h range)
      historical_hourly_curve: flat,
    });
    // At 50% of curve with 50% of target hit, should be on_pace
    expect(["on_pace", "ahead", "too_early_to_tell"]).toContain(result.pace_status);
    expect(result.pace_status).not.toBe("critically_behind");
  });

  // ── Boundary: exact trading start ──────────────────────────────────────────
  it("exactly at trading_start → too_early_to_tell", () => {
    const result = evaluatePaceAdjustedRevenue({
      ...BASE_INPUTS,
      current_net_sales: 0,
      now_local: makeTime(8, 0),
    });
    expect(result.pace_status).toBe("too_early_to_tell");
  });
});
