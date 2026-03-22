/**
 * lib/sales/scoring.ts — Revenue score calculation
 *
 * Pure function: score out of 40 based on target attainment.
 *
 * Bands (gap = how far BELOW target, as %):
 *   gap ≤ 0%   (on target or above) → 40
 *   gap ≤ 5%                        → 30
 *   gap ≤ 10%                       → 20
 *   gap ≤ 20%                       → 10
 *   gap > 20%                       →  0
 */

import type { RevenueScoreResult, NormalizedSalesSnapshot } from "./types";

export function computeRevenueScore(snapshot: NormalizedSalesSnapshot): RevenueScoreResult {
  const { netSales, targetSales } = snapshot;

  if (targetSales == null || targetSales === 0) {
    return {
      score: 0,
      max: 40,
      gapPercent: null,
      detail: netSales > 0
        ? `Sales R${netSales.toLocaleString("en-ZA")} — no target set`
        : "No sales data available",
    };
  }

  // gap > 0 means below target
  const gapPercent = Math.round(((targetSales - netSales) / targetSales) * 1000) / 10;

  let score: number;
  if (gapPercent <= 0) score = 40;
  else if (gapPercent <= 5) score = 30;
  else if (gapPercent <= 10) score = 20;
  else if (gapPercent <= 20) score = 10;
  else score = 0;

  let detail: string;
  if (gapPercent <= 0) {
    detail = `On target (R${netSales.toLocaleString("en-ZA")} vs R${targetSales.toLocaleString("en-ZA")})`;
  } else {
    detail = `${gapPercent.toFixed(1)}% below target (R${netSales.toLocaleString("en-ZA")} vs R${targetSales.toLocaleString("en-ZA")})`;
  }

  return { score, max: 40, gapPercent, detail };
}
