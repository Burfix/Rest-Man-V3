/**
 * lib/sales/briefing.ts — Service Brief generator
 *
 * Generates the GM's pre-shift briefing from the unified sales snapshot.
 * Pure function — no DB calls, no side effects.
 */

import type { NormalizedSalesSnapshot } from "./types";
import type { VenueEvent, TodayBookingsSummary } from "@/types";

// ── Output types ────────────────────────────────────────────────────────────

export type BriefUrgency = "critical" | "warning" | "good" | "neutral";

export interface ServiceBriefOutput {
  headline: string;
  revenueStatus: string;
  urgency: BriefUrgency;
  recommendations: string[];
  serviceFocus: string[];
  warnings: string[];
  sourceNote: string;
}

// ── Generator ───────────────────────────────────────────────────────────────

export function generateServiceBrief(
  snapshot: NormalizedSalesSnapshot,
  context: {
    today?: TodayBookingsSummary;
    events?: VenueEvent[];
    businessDate: string;
    servicePeriod: string;
  },
): ServiceBriefOutput {
  const recommendations: string[] = [];
  const serviceFocus: string[] = [];
  const warnings: string[] = [];

  const { netSales, targetSales, targetVarianceAmount, targetVariancePercent, walkInRecoveryNeeded, additionalCoversNeeded, averageSpendPerCover, labourCostPercent, covers, checks, source } = snapshot;
  const todayEvent = context.events?.find(
    (e) => e.event_date === context.businessDate && !e.cancelled,
  );

  // ── Urgency classification ──────────────────────────────────────────────
  let urgency: BriefUrgency = "neutral";

  if (targetSales != null && targetVariancePercent != null) {
    if (targetVariancePercent >= 0) urgency = "good";
    else if (Math.abs(targetVariancePercent) < 20) urgency = "warning";
    else urgency = "critical";
  }

  // ── Headline ────────────────────────────────────────────────────────────
  let headline: string;

  if (source === "forecast" && snapshot.freshnessState === "offline") {
    headline = "Using forecast — connect MICROS or upload sales for live data";
  } else if (targetSales == null) {
    headline = `Sales: R${fmtK(netSales)} — no target set`;
  } else if (targetVariancePercent != null && targetVariancePercent >= 0) {
    headline = `On track to hit target — protect labour and maintain conversion`;
  } else if (walkInRecoveryNeeded != null && walkInRecoveryNeeded > 0) {
    headline = `Behind target by R${fmtK(walkInRecoveryNeeded)} — push walk-ins and upselling`;
  } else {
    headline = `Sales at R${fmtK(netSales)} — monitor through service`;
  }

  // ── Revenue status line ─────────────────────────────────────────────────
  let revenueStatus: string;
  if (targetSales == null) {
    revenueStatus = `R${fmtK(netSales)} (no target)`;
  } else if (targetVarianceAmount != null && targetVarianceAmount >= 0) {
    revenueStatus = `R${fmtK(netSales)} — ahead by R${fmtK(targetVarianceAmount)}`;
  } else if (targetVarianceAmount != null) {
    revenueStatus = `R${fmtK(netSales)} — behind by R${fmtK(Math.abs(targetVarianceAmount))}`;
  } else {
    revenueStatus = `R${fmtK(netSales)}`;
  }

  // ── Recommendations ─────────────────────────────────────────────────────
  if (walkInRecoveryNeeded != null && walkInRecoveryNeeded > 0) {
    recommendations.push(
      `Need R${fmtK(walkInRecoveryNeeded)} more in walk-in sales to close gap`,
    );
    if (additionalCoversNeeded != null && additionalCoversNeeded > 0 && averageSpendPerCover > 0) {
      recommendations.push(
        `That's approximately ${additionalCoversNeeded} more covers at R${Math.round(averageSpendPerCover)} avg spend`,
      );
    }
  }

  if (todayEvent) {
    recommendations.push(
      `Event tonight: "${todayEvent.name}" — ensure floor is prepped and promoted`,
    );
  }

  // ── Service focus ───────────────────────────────────────────────────────
  if (urgency === "critical" || urgency === "warning") {
    serviceFocus.push("Activate walk-in conversion — greet and seat quickly");
    serviceFocus.push("Push high-margin items: cocktails, sharing plates, wine pairings");
  }

  if (averageSpendPerCover > 0 && averageSpendPerCover < 200) {
    serviceFocus.push("Avg spend is low — upsell starters, desserts, and drinks");
  }

  // ── Warnings ────────────────────────────────────────────────────────────
  if (labourCostPercent != null && labourCostPercent > 45) {
    warnings.push(
      `Labour at ${labourCostPercent.toFixed(1)}% — HIGH. Review roster immediately`,
    );
    urgency = "critical";
  } else if (labourCostPercent != null && labourCostPercent > 35) {
    warnings.push(
      `Labour at ${labourCostPercent.toFixed(1)}% — elevated. Monitor hours`,
    );
    if (urgency === "neutral" || urgency === "good") urgency = "warning";
  }

  if (snapshot.isStale) {
    warnings.push(
      `MICROS data is ${snapshot.freshnessMinutes}m old — consider syncing or uploading manually`,
    );
  }

  if (source !== "micros" && source !== "manual") {
    warnings.push("Using forecast data — live POS unavailable");
  }

  // ── Source note ─────────────────────────────────────────────────────────
  let sourceNote: string;
  if (source === "micros" && snapshot.isLive) {
    sourceNote = `MICROS LIVE — ${snapshot.freshnessMinutes ?? 0}m ago`;
  } else if (source === "micros" && snapshot.isStale) {
    sourceNote = `MICROS STALE — ${snapshot.freshnessMinutes}m ago`;
  } else if (source === "manual") {
    sourceNote = `Manual upload — ${snapshot.freshnessMinutes != null ? snapshot.freshnessMinutes + "m ago" : "timestamp unknown"}`;
  } else {
    sourceNote = "Forecast only — no live or uploaded data";
  }

  return {
    headline,
    revenueStatus,
    urgency,
    recommendations,
    serviceFocus,
    warnings,
    sourceNote,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtK(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1_000)}K`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}
