/**
 * Service State Engine
 *
 * getServiceState(storeId, now) → ServiceState
 *
 * Evaluates current service quality from available signals.
 * Service is the LEAD SIGNAL — revenue follows service quality.
 *
 * When direct floor data isn't available, infers service state
 * from revenue metrics (avg spend, covers, conversion patterns).
 */

import type {
  ServiceState,
  ServiceSignals,
  EnergyLevel,
  UpsellStrength,
  ConversionLevel,
  EngagementLevel,
  ServiceRiskLevel,
} from "./types";

// ── Signal inference from revenue data ───────────────────────────────────────

export interface ServiceStateInput {
  avgSpend: number;
  targetAvgSpend: number;           // benchmark for this store
  covers: number;
  forecastCovers: number;
  bookingsToday: number;
  bookedCovers: number;
  walkInCovers: number;             // covers - bookedCovers
  tableTurnEstimate: number | null; // from POS if available
  activeStaff: number | null;
  seatingCapacity: number;
  revenueActual: number;
  revenueTarget: number;
  labourPercent: number;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const AVG_SPEND_STRONG   = 0.95;   // ≥95% of target avg spend → strong
const AVG_SPEND_MODERATE = 0.80;   // ≥80% → moderate
const AVG_SPEND_WEAK     = 0.65;   // ≥65% → weak

const COVER_CONVERSION_HIGH     = 0.7;  // ≥70% of forecast
const COVER_CONVERSION_MODERATE = 0.5;
const COVER_CONVERSION_LOW      = 0.3;

const BOOKING_ARRIVAL_HIGH   = 0.85;
const BOOKING_ARRIVAL_MODERATE = 0.65;

const WALK_IN_RATIO_HIGH    = 0.4;  // ≥40% of covers are walk-ins
const WALK_IN_RATIO_MODERATE = 0.25;

const TABLE_TURN_GOOD = 1.5;   // per hour
const TABLE_TURN_LOW  = 0.8;

export function getServiceState(input: ServiceStateInput): ServiceState {
  const {
    avgSpend, targetAvgSpend, covers, forecastCovers,
    bookingsToday, bookedCovers, walkInCovers,
    tableTurnEstimate, activeStaff, seatingCapacity,
    revenueActual, revenueTarget, labourPercent,
  } = input;

  // ── Calculate signals ────────────────────────────────────────────────────

  const avgSpendRatio = targetAvgSpend > 0 ? avgSpend / targetAvgSpend : 0;
  const coverConversion = forecastCovers > 0 ? covers / forecastCovers : 0;
  const bookingArrivalRate = bookingsToday > 0 ? Math.min(1, bookedCovers / (bookingsToday * 2.5)) : 0;
  const walkInRatio = covers > 0 ? walkInCovers / covers : 0;
  const tableTurn = tableTurnEstimate ?? (covers > 0 && seatingCapacity > 0
    ? covers / seatingCapacity
    : 0);
  const staffCoverRatio = activeStaff != null && activeStaff > 0 ? covers / activeStaff : 0;
  const revenueProgress = revenueTarget > 0 ? revenueActual / revenueTarget : 0;

  // ── Derive energy level ──────────────────────────────────────────────────
  // Floor energy is a composite of: cover pace, staff activity, table turns

  let energyScore = 50; // baseline
  if (coverConversion >= COVER_CONVERSION_HIGH) energyScore += 25;
  else if (coverConversion >= COVER_CONVERSION_MODERATE) energyScore += 10;
  else energyScore -= 15;

  if (tableTurn >= TABLE_TURN_GOOD) energyScore += 15;
  else if (tableTurn < TABLE_TURN_LOW) energyScore -= 15;

  if (staffCoverRatio > 6) energyScore += 10; // busy per server
  else if (staffCoverRatio < 2 && activeStaff != null) energyScore -= 10;

  energyScore = Math.max(0, Math.min(100, energyScore));

  const energyLevel: EnergyLevel =
    energyScore >= 70 ? "high" :
    energyScore >= 50 ? "moderate" :
    energyScore >= 30 ? "low" : "critical";

  // ── Upsell strength ─────────────────────────────────────────────────────
  const upsellStrength: UpsellStrength =
    avgSpendRatio >= AVG_SPEND_STRONG ? "strong" :
    avgSpendRatio >= AVG_SPEND_MODERATE ? "moderate" :
    avgSpendRatio >= AVG_SPEND_WEAK ? "weak" : "none";

  // ── Conversion ───────────────────────────────────────────────────────────
  const conversionRate: ConversionLevel =
    coverConversion >= COVER_CONVERSION_HIGH ? "high" :
    coverConversion >= COVER_CONVERSION_MODERATE ? "moderate" :
    coverConversion >= COVER_CONVERSION_LOW ? "low" : "critical";

  // ── Engagement ───────────────────────────────────────────────────────────
  const engagementScore = Math.round((energyScore * 0.4) + (avgSpendRatio * 100 * 0.3) + (bookingArrivalRate * 100 * 0.3));
  const engagementLevel: EngagementLevel =
    engagementScore >= 70 ? "high" :
    engagementScore >= 50 ? "moderate" :
    engagementScore >= 30 ? "low" : "critical";

  // ── Service risk ─────────────────────────────────────────────────────────
  let riskScore = 0;
  if (energyLevel === "critical") riskScore += 3;
  else if (energyLevel === "low") riskScore += 2;
  if (upsellStrength === "none") riskScore += 2;
  else if (upsellStrength === "weak") riskScore += 1;
  if (conversionRate === "critical") riskScore += 3;
  else if (conversionRate === "low") riskScore += 2;
  if (labourPercent > 40) riskScore += 1;  // overstaffed but underperforming = service issue

  const serviceRiskLevel: ServiceRiskLevel =
    riskScore >= 7 ? "critical" :
    riskScore >= 5 ? "high" :
    riskScore >= 3 ? "moderate" :
    riskScore >= 1 ? "low" : "none";

  // ── Summary ──────────────────────────────────────────────────────────────

  const issues: string[] = [];
  if (energyLevel === "low" || energyLevel === "critical") issues.push("low floor energy");
  if (upsellStrength === "weak" || upsellStrength === "none") issues.push("weak upsell execution");
  if (conversionRate === "low" || conversionRate === "critical") issues.push("low cover conversion");
  if (walkInRatio < WALK_IN_RATIO_MODERATE && covers > 0) issues.push("low walk-in conversion");
  if (tableTurn < TABLE_TURN_LOW) issues.push("slow table turns");

  let serviceSummary: string;
  if (issues.length === 0) {
    serviceSummary = "Service performance is strong. Maintain execution.";
  } else if (issues.length <= 2) {
    serviceSummary = `${capitalize(issues.join(" and "))} ${issues.length === 1 ? "is" : "are"} holding back performance.`;
  } else {
    serviceSummary = `${capitalize(issues.slice(0, 2).join(", "))} and ${issues.length - 2} other signal${issues.length - 2 > 1 ? "s" : ""} are suppressing revenue.`;
  }

  // ── Build signals object ─────────────────────────────────────────────────

  const signals: ServiceSignals = {
    floorEnergyScore: energyScore,
    tableTurnRate: Math.round(tableTurn * 100) / 100,
    upsellRate: Math.round(avgSpendRatio * 100) / 100,
    avgSpend,
    walkInConversionRate: Math.round(walkInRatio * 100) / 100,
    bookingConversionRate: Math.round(bookingArrivalRate * 100) / 100,
    guestEngagementScore: engagementScore,
    tableTouchFrequency: tableTurn > 0 ? Math.round((tableTurn * 2.5) * 100) / 100 : 0,
    serviceSpeedRisk: tableTurn < TABLE_TURN_LOW && covers > 5 ? "high" : tableTurn < TABLE_TURN_GOOD ? "medium" : "none",
  };

  return {
    energyLevel,
    upsellStrength,
    conversionRate,
    engagementLevel,
    serviceRiskLevel,
    serviceSummary,
    signals,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
