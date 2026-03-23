/**
 * lib/forecast/mock.ts — Realistic mock data generator
 *
 * Produces a complete GMBriefing with realistic restaurant data
 * when live integrations are incomplete. Used as fallback.
 */

import { todayISO, getDayName } from "@/lib/utils";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import type { ForecastInput, GMBriefing } from "@/types/forecast";
import { buildGMBriefing } from "./briefing";

/**
 * Generate a realistic mock ForecastInput for today.
 * Simulates a typical Wednesday evening with moderate bookings,
 * one compliance item due soon, and no major maintenance issues.
 */
export function getMockForecastInput(date: string = todayISO()): ForecastInput {
  const dayName = getDayName(date);

  // Scale by day of week
  const dayScales: Record<string, number> = {
    monday: 0.7, tuesday: 0.75, wednesday: 0.85,
    thursday: 0.9, friday: 1.2, saturday: 1.3, sunday: 0.95,
  };
  const scale = dayScales[dayName] ?? 0.85;

  // Simulate a quiz night on Fridays
  const isFriday = dayName === "friday";
  const eventName = isFriday ? "Quiz Night" : null;
  const eventMultiplier = isFriday ? 1.15 : 1.0;

  return {
    storeId: DEFAULT_ORG_ID,
    date,
    dayName,
    confirmedCovers: Math.round(45 * scale),
    recentWeekdayAvgSales: Math.round(38000 * scale),
    sameDayLastYearSales: Math.round(35000 * scale),
    recentWeekdayAvgCovers: Math.round(85 * scale),
    sameDayLastYearCovers: Math.round(78 * scale),
    historicalAvgSpend: 280,
    eventMultiplier,
    eventName,
    latestLabourPct: 23.5,
    latestMarginPct: 14.2,
    outOfServiceCount: isFriday ? 1 : 0,
    salesTarget: Math.round(42000 * scale),
    complianceDueSoon: 1,
    complianceExpired: 0,
    maintenanceOverdue: isFriday ? 1 : 0,
    maintenanceUrgent: 0,
    activePromos: [],
  };
}

/**
 * Generate a complete mock GMBriefing.
 */
export function getMockGMBriefing(date: string = todayISO()): GMBriefing {
  const input = getMockForecastInput(date);
  return buildGMBriefing(input);
}
