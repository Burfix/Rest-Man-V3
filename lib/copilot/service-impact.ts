/**
 * Service Impact Engine
 *
 * mapServiceToRevenue(serviceState, revenueState) → ServiceRevenueImpact
 *
 * Explicitly connects service quality to revenue.
 * CORE PRINCIPLE: Revenue follows service quality.
 */

import type {
  ServiceState,
  ServiceRevenueImpact,
  ServiceRevenueDriver,
} from "./types";

export interface RevenueContext {
  actualRevenue: number;
  targetRevenue: number;
  avgSpend: number;
  targetAvgSpend: number;
  covers: number;
  forecastCovers: number;
  bookedCovers: number;
}

export function mapServiceToRevenue(
  service: ServiceState,
  revenue: RevenueContext,
): ServiceRevenueImpact {
  const drivers: ServiceRevenueDriver[] = [];
  let totalLoss = 0;

  const { avgSpend, targetAvgSpend, covers, forecastCovers, targetRevenue, actualRevenue } = revenue;
  const gap = Math.max(0, targetRevenue - actualRevenue);

  // ── 1. Upsell weakness → lower average spend ────────────────────────────
  if (service.upsellStrength === "weak" || service.upsellStrength === "none") {
    const spendGap = Math.max(0, targetAvgSpend - avgSpend);
    const lostFromUpsell = spendGap * covers;
    if (lostFromUpsell > 0) {
      drivers.push({
        signal: "Weak upsell execution",
        currentLevel: service.upsellStrength,
        revenueEffect: `Average spend R${avgSpend.toFixed(0)} vs target R${targetAvgSpend.toFixed(0)}`,
        estimatedLoss: Math.round(lostFromUpsell),
      });
      totalLoss += lostFromUpsell;
    }
  }

  // ── 2. Low walk-in conversion → fewer covers ───────────────────────────
  if (service.conversionRate === "low" || service.conversionRate === "critical") {
    const missedCovers = Math.max(0, forecastCovers - covers);
    const lostFromConversion = missedCovers * avgSpend;
    if (lostFromConversion > 0) {
      drivers.push({
        signal: "Low cover conversion",
        currentLevel: service.conversionRate,
        revenueEffect: `${covers} covers vs ${forecastCovers} forecast — ${missedCovers} missed`,
        estimatedLoss: Math.round(lostFromConversion),
      });
      totalLoss += lostFromConversion;
    }
  }

  // ── 3. Low floor energy → weaker engagement → lower spend ──────────────
  if (service.energyLevel === "low" || service.energyLevel === "critical") {
    // Estimate 5-15% engagement drag on spend
    const energyDrag = service.energyLevel === "critical" ? 0.15 : 0.08;
    const lostFromEnergy = covers * avgSpend * energyDrag;
    if (lostFromEnergy > 100) {
      drivers.push({
        signal: "Low floor energy",
        currentLevel: service.energyLevel,
        revenueEffect: "Weak engagement is reducing guest spend and repeat intent",
        estimatedLoss: Math.round(lostFromEnergy),
      });
      totalLoss += lostFromEnergy;
    }
  }

  // ── 4. Slow table turns → reduced volume ───────────────────────────────
  if (service.signals.tableTurnRate < 0.8 && covers > 5) {
    const potentialExtra = Math.round((0.8 - service.signals.tableTurnRate) * covers * 0.3);
    const lostFromTurns = potentialExtra * avgSpend;
    if (lostFromTurns > 100) {
      drivers.push({
        signal: "Slow table turns",
        currentLevel: `${service.signals.tableTurnRate.toFixed(1)} turns/hr`,
        revenueEffect: `~${potentialExtra} additional covers possible with faster turns`,
        estimatedLoss: Math.round(lostFromTurns),
      });
      totalLoss += lostFromTurns;
    }
  }

  // ── 5. Weak booking conversion → fewer arrivals ─────────────────────────
  if (service.signals.bookingConversionRate < 0.65 && revenue.bookedCovers > 0) {
    const missedBooked = Math.round(revenue.bookedCovers * (1 - service.signals.bookingConversionRate));
    const lostFromBookings = missedBooked * avgSpend;
    if (lostFromBookings > 0) {
      drivers.push({
        signal: "Low booking arrival rate",
        currentLevel: `${Math.round(service.signals.bookingConversionRate * 100)}%`,
        revenueEffect: `~${missedBooked} booked covers may not arrive`,
        estimatedLoss: Math.round(lostFromBookings),
      });
      totalLoss += lostFromBookings;
    }
  }

  // ── Cap total loss at actual gap ─────────────────────────────────────────
  totalLoss = Math.min(totalLoss, gap > 0 ? gap : totalLoss);

  // ── Build explanation ───────────────────────────────────────────────────
  let explanation: string;
  if (drivers.length === 0) {
    explanation = "Service performance is not currently suppressing revenue.";
  } else if (drivers.length === 1) {
    explanation = `${drivers[0].signal} is the primary drag on revenue performance.`;
  } else {
    const topTwo = drivers.sort((a, b) => b.estimatedLoss - a.estimatedLoss).slice(0, 2);
    explanation = `${topTwo.map(d => d.signal.toLowerCase()).join(" and ")} are the main service-driven revenue drags.`;
  }

  return {
    revenueImpactExplanation: explanation,
    estimatedRevenueLoss: Math.round(totalLoss),
    likelyDrivers: drivers.sort((a, b) => b.estimatedLoss - a.estimatedLoss),
  };
}
