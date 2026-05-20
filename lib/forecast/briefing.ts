/**
 * lib/forecast/briefing.ts — GM Co-Pilot orchestrator
 *
 * Assembles the complete GM Briefing from all sub-engines:
 * forecast, hourly demand, labour, prep, promos, risk, recommendations.
 */

import type { ForecastInput, GMBriefing, ForecastConfidence } from "@/types/forecast";
import {
  generateSalesForecast,
  generateCoversForecast,
  generateHourlyForecast,
  generateLabourGuidance,
  calculateConfidenceScore,
} from "./engine";
import { generateRecommendations } from "./recommendations";
import { generateRiskAssessment } from "./risks";
import { generatePrepGuidance } from "./prep";
import { generatePromoInsights } from "./promos";
import { formatCurrency, getDayName } from "@/lib/utils";

/**
 * Generate the full GM Briefing for a given date.
 * This is the primary entry point for the GM Co-Pilot engine.
 */
export function buildGMBriefing(input: ForecastInput, targetLabourPct?: number): GMBriefing {
  // Core forecasts
  const salesResult = generateSalesForecast(input);
  const coversForecast = generateCoversForecast(input);

  // Hourly demand curve
  const demand = generateHourlyForecast(input, salesResult.total, coversForecast);

  // Labour guidance (target from site config or default)
  const labour = generateLabourGuidance(input, salesResult.total, targetLabourPct);

  // Risk assessment
  const riskAssessment = generateRiskAssessment(input, demand);

  // Recommendations
  const recommendations = generateRecommendations(input, demand, labour);

  // Prep guidance
  const prepGuidance = generatePrepGuidance(input, demand);

  // Promo insights
  const promoInsights = generatePromoInsights(input, demand);

  // Confidence
  const { score: confidenceScore, confidence } = calculateConfidenceScore(input);

  // Build headline
  const headline = buildHeadline(input, salesResult.total, coversForecast, demand.peakWindow, confidence);

  return {
    forecastDate: input.date,
    generatedAt: new Date().toISOString(),
    headline,

    salesForecast: salesResult.total,
    coversForecast,
    avgSpendForecast: demand.forecastAvgSpend,
    labourForecastPct: input.latestLabourPct,
    peakWindow: demand.peakWindow,
    riskLevel: riskAssessment.overallLevel,
    confidenceScore,
    confidence,
    signalCount: salesResult.signalCount,

    eventName: input.eventName,

    salesTarget: input.salesTarget,
    salesGap: input.salesTarget != null ? salesResult.total - input.salesTarget : null,

    hourlyBreakdown: demand.hourlyBreakdown,
    recommendations,
    prepGuidance,
    riskAssessment,
    labourGuidance: labour,
    promoInsights,

    pacing: null, // Populated during the day via compareActualVsForecast
  };
}

function buildHeadline(
  input: ForecastInput,
  salesForecast: number,
  coversForecast: number,
  peakWindow: string,
  confidence: ForecastConfidence,
): string {
  const dayLabel = capitalize(input.dayName);
  const salesStr = formatCurrency(salesForecast);

  const parts: string[] = [];

  // Sales context
  if (input.salesTarget != null) {
    const gap = salesForecast - input.salesTarget;
    if (gap >= 0) {
      parts.push(`${dayLabel} forecast of ${salesStr} is on or above target.`);
    } else {
      parts.push(`${dayLabel} forecast of ${salesStr} is ${Math.abs(Math.round((gap / input.salesTarget) * 100))}% below target.`);
    }
  } else {
    parts.push(`${dayLabel} sales forecast: ${salesStr} with ${coversForecast} expected covers.`);
  }

  // Event
  if (input.eventName) {
    parts.push(`${input.eventName} tonight will lift demand.`);
  }

  // Peak
  parts.push(`Peak service window is ${peakWindow}.`);

  // Confidence
  if (confidence === "low") {
    parts.push("Limited historical data — monitor actuals closely.");
  }

  return parts.join(" ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
