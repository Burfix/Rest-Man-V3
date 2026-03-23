/**
 * lib/forecast/pacing.ts — Forecast vs actual pacing engine
 *
 * Compares live/current-day actuals against the forecast to
 * produce pacing status and actionable messages.
 */

import type { PacingSnapshot, HourlySlot } from "@/types/forecast";

/**
 * Compare actual sales/covers against forecast for the current hour.
 */
export function compareActualVsForecast(
  hourlyForecast: HourlySlot[],
  actualSales: number,
  actualCovers: number,
  currentHour: number,
): PacingSnapshot {
  // Sum forecast up to current hour
  let forecastSalesToDate = 0;
  let forecastCoversToDate = 0;

  for (const slot of hourlyForecast) {
    if (slot.hour <= currentHour) {
      forecastSalesToDate += slot.forecastSales;
      forecastCoversToDate += slot.forecastCovers;
    }
  }

  const salesVariancePct = forecastSalesToDate > 0
    ? Math.round(((actualSales - forecastSalesToDate) / forecastSalesToDate) * 100)
    : 0;

  const coversVariancePct = forecastCoversToDate > 0
    ? Math.round(((actualCovers - forecastCoversToDate) / forecastCoversToDate) * 100)
    : 0;

  // Determine pacing status
  let pacingStatus: PacingSnapshot["pacingStatus"];
  if (salesVariancePct > 5) pacingStatus = "above_plan";
  else if (salesVariancePct < -5) pacingStatus = "below_plan";
  else pacingStatus = "on_track";

  // Build human message
  const pacingMessage = buildPacingMessage(salesVariancePct, coversVariancePct, pacingStatus, currentHour);

  return {
    currentHour,
    actualSalesToDate: actualSales,
    forecastSalesToDate,
    actualCoversToDate: actualCovers,
    forecastCoversToDate,
    salesVariancePct,
    coversVariancePct,
    pacingStatus,
    pacingMessage,
  };
}

function buildPacingMessage(
  salesVar: number,
  coversVar: number,
  status: PacingSnapshot["pacingStatus"],
  hour: number,
): string {
  const period = hour < 14 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  if (status === "above_plan") {
    return `${period} trade is pacing ${salesVar}% above forecast. Covers are ${coversVar > 0 ? "+" : ""}${coversVar}% vs plan. Strong performance — maintain momentum.`;
  }
  if (status === "below_plan") {
    return `${period} trade is tracking ${Math.abs(salesVar)}% below forecast. ${coversVar < 0 ? `Covers are ${Math.abs(coversVar)}% under plan.` : "Covers are on track but spend is lower than expected."} Consider activating upsell focus or a flash promotion.`;
  }
  return `${period} trade is on track with forecast. Continue monitoring.`;
}
