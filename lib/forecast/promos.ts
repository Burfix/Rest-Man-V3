/**
 * lib/forecast/promos.ts — Promotion insight generator
 */

import type { ForecastInput, PromoInsight, DemandSnapshot } from "@/types/forecast";

/**
 * Generate promo insights. When no active promos exist,
 * produce a recommendation based on the day's forecast.
 */
export function generatePromoInsights(
  input: ForecastInput,
  demand: DemandSnapshot,
): PromoInsight[] {
  const insights: PromoInsight[] = [];

  // Map any active promos from input
  for (const promo of input.activePromos) {
    insights.push({
      promoName: promo.name,
      expectedSalesUpliftPct: promo.expectedSalesUpliftPct,
      expectedCoverUpliftPct: promo.expectedCoverUpliftPct,
      expectedMarginImpactPct: promo.expectedMarginImpactPct,
      recommendation: buildPromoRecommendation(promo.name, promo.expectedSalesUpliftPct, promo.expectedMarginImpactPct),
    });
  }

  // Event-driven insight
  if (input.eventName) {
    const uplift = Math.round((input.eventMultiplier - 1) * 100);
    insights.push({
      promoName: input.eventName,
      expectedSalesUpliftPct: uplift,
      expectedCoverUpliftPct: Math.round(uplift * 0.8),
      expectedMarginImpactPct: Math.round(uplift * -0.1), // Events generally compress margin slightly
      recommendation: `${input.eventName} is expected to lift sales by ~${uplift}%. Ensure stock levels match the increased demand and brief staff on event-specific menu items.`,
    });
  }

  // If it looks like a slow day, suggest a promo
  if (
    insights.length === 0 &&
    input.salesTarget != null &&
    demand.totalForecastSales < input.salesTarget * 0.85
  ) {
    insights.push({
      promoName: "Suggested: Lunch Special",
      expectedSalesUpliftPct: 12,
      expectedCoverUpliftPct: 15,
      expectedMarginImpactPct: -3,
      recommendation: "Forecast is below target with no active promotion. Consider activating a lunch special or happy hour to drive walk-in covers during the quiet period.",
    });
  }

  return insights;
}

function buildPromoRecommendation(
  name: string,
  salesUplift: number,
  marginImpact: number,
): string {
  if (marginImpact < -5) {
    return `${name} is expected to lift sales by ${salesUplift}% but compresses margin by ${Math.abs(marginImpact)}%. Monitor food cost closely and push high-margin add-ons.`;
  }
  return `${name} should lift sales by ~${salesUplift}%. Ensure kitchen prep matches the expected demand increase.`;
}
