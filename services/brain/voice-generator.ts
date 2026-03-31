/**
 * Brain Voice Generator
 *
 * Pure function — no async, no side effects.
 * Assembles a single-sentence intelligent briefing from BrainOutput.
 *
 * No AI API call — pure logic-driven string assembly.
 */

import type { BrainOutput } from "./operating-brain";
import type { OperationsContext } from "@/services/intelligence/context-builder";

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function pct(n: number, showPlus = false): string {
  const sign = n >= 0 && showPlus ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function generateVoice(brain: BrainOutput, ctx: OperationsContext): string {
  const { primaryThreat, forecastSummary, gmSituation, systemHealth } = brain;
  const sev = primaryThreat.severity;

  // ── Sports event uplift ───────────────────────────────────────────────────
  // Proactive: fires whenever an active event is detected. Requires floor
  // preparation — overrides nominal and revenue paths. Yields only to
  // critical MAINTENANCE (that takes priority: fix equipment to serve the crowd).
  if (
    forecastSummary.activeEvent &&
    forecastSummary.eventUplift &&
    forecastSummary.eventUplift > 1.0 &&
    !(sev === "critical" && primaryThreat.modulesInvolved.includes("MAINTENANCE"))
  ) {
    const upliftPct    = Math.round((forecastSummary.eventUplift - 1) * 100);
    const eventDisplay = forecastSummary.activeEvent.split(" —")[0].trim();
    return (
      `${eventDisplay} today. Expect ~${upliftPct}% revenue uplift. ` +
      `Ensure full staffing and stock levels before kickoff.`
    );
  }

  // ── Ramadan suppression ───────────────────────────────────────────────────
  // Contextualise revenue suppression as a known cause — don't alarm the GM.
  // Only yields to MAINTENANCE primary threats (those need separate attention).
  if (
    forecastSummary.isRamadan &&
    !primaryThreat.modulesInvolved.includes("MAINTENANCE")
  ) {
    const revNote =
      forecastSummary.vsTarget < -5
        ? ` Revenue ${pct(forecastSummary.vsTarget)} vs target.`
        : "";
    return `Ramadan period. Revenue suppression expected.${revNote} Focus on dinner recovery and cost control.`;
  }

  // ── All systems nominal ────────────────────────────────────────────────────
  if (sev === "low" && systemHealth.score >= 75) {
    const revNote =
      forecastSummary.vsTarget > 2
        ? `${pct(forecastSummary.vsTarget, true)} ahead of target`
        : forecastSummary.vsTarget < -2
        ? `${pct(forecastSummary.vsTarget)} vs target`
        : "tracking on target";

    return (
      `All systems nominal. ${revNote.charAt(0).toUpperCase() + revNote.slice(1)}.` +
      ` Monitor floor energy and walk-in conversion.`
    );
  }

  // ── Critical: lead with money + cause + directive ─────────────────────────
  if (sev === "critical") {
    const parts: string[] = [];

    if (
      primaryThreat.modulesInvolved.includes("REVENUE") &&
      primaryThreat.moneyAtRisk > 0
    ) {
      parts.push(`Revenue is ${fmt(primaryThreat.moneyAtRisk)} behind`);
    }

    if (primaryThreat.modulesInvolved.includes("MAINTENANCE") && ctx.maintenance.serviceBlocking) {
      parts.push("service maintenance is blocking operations");
    } else if (primaryThreat.modulesInvolved.includes("LABOUR") && ctx.labour.variance > 8) {
      parts.push(`labour is ${pct(ctx.labour.variance, true)} over target`);
    }

    if (
      primaryThreat.timeWindowMinutes > 0 &&
      primaryThreat.timeWindowMinutes <= 120
    ) {
      const hrs = Math.round(primaryThreat.timeWindowMinutes / 60);
      parts.push(hrs <= 1 ? "with less than an hour left" : `with ${hrs} hours left`);
    }

    // Add a directive from the recommendation (first sentence only)
    const directive = primaryThreat.recommendedAction.split(".")[0];
    if (directive && directive.length > 10) {
      return parts.join(" — ") + ". " + directive + ".";
    }

    if (parts.length > 0) return parts.join(" — ") + ".";
  }

  // ── Revenue focus (high/medium) ────────────────────────────────────────────
  if (primaryThreat.modulesInvolved.includes("REVENUE")) {
    const moneyNote =
      primaryThreat.moneyAtRisk > 0
        ? `${fmt(primaryThreat.moneyAtRisk)} at risk`
        : `revenue ${pct(forecastSummary.vsTarget)} vs target`;

    const windowNote =
      primaryThreat.timeWindowMinutes > 0 && primaryThreat.timeWindowMinutes <= 240
        ? ` with ${Math.round(primaryThreat.timeWindowMinutes / 60)} hour${
            Math.round(primaryThreat.timeWindowMinutes / 60) > 1 ? "s" : ""
          } left`
        : "";

    const directive = primaryThreat.recommendedAction.split(".")[0];

    return `${moneyNote}${windowNote}. ${directive}.`;
  }

  // ── Maintenance compound ───────────────────────────────────────────────────
  if (primaryThreat.modulesInvolved.includes("MAINTENANCE")) {
    const maintNote =
      ctx.maintenance.urgentCount > 1
        ? `${ctx.maintenance.urgentCount} unresolved maintenance items are compounding`
        : ctx.maintenance.serviceBlocking
        ? "service-blocking maintenance is unresolved"
        : "maintenance items are accumulating";

    const compNote =
      ctx.compliance.overdueCount === 0 ? " No compliance risk today." : "";

    const gmNote = gmSituation.alertNeeded
      ? ` GM performance declining — score at ${gmSituation.score}/100.`
      : "";

    return `${maintNote}.${compNote}${gmNote}`;
  }

  // ── Labour only ────────────────────────────────────────────────────────────
  if (
    primaryThreat.modulesInvolved.includes("LABOUR") &&
    !primaryThreat.modulesInvolved.includes("REVENUE")
  ) {
    return `Labour running ${pct(ctx.labour.variance, true)} over target. ${
      primaryThreat.recommendedAction.split(".")[0]
    }.`;
  }

  // ── GM declining ──────────────────────────────────────────────────────────
  if (gmSituation.alertNeeded) {
    return `GM performance at ${gmSituation.score}/100 — review task completion and escalation patterns.`;
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return `${primaryThreat.title}. ${primaryThreat.recommendedAction.split(".")[0]}.`;
}
