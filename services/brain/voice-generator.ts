/**
 * Brain Voice Generator
 *
 * Pure function — no async, no side effects.
 * Assembles a single-sentence intelligent briefing from BrainOutput.
 *
 * No AI API call — pure logic-driven string assembly.
 * 15+ situation-specific voice states, priority-ordered.
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
  const { primaryThreat, forecastSummary, gmSituation, systemHealth, recoveryMeter } = brain;
  const sev = primaryThreat.severity;

  // ── 1. After hours — sync pending ─────────────────────────────────────────
  if (forecastSummary.isDayClosed && forecastSummary.syncPending) {
    return "After hours. Revenue sync pending — check again after midnight.";
  }

  // ── 2. After hours — day is closed with actuals ───────────────────────────
  if (forecastSummary.isDayClosed) {
    const closeRevenue = fmt(forecastSummary.projectedClose);
    const vt = forecastSummary.vsTarget ?? 0;

    if (vt >= 0) {
      // Good day
      const labNote = ctx.labour.variance > 0
        ? ` Labour ${pct(ctx.labour.variance, true)} over — review roster before tomorrow.`
        : " Labour on budget.";
      return `Strong close. Today finished at ${closeRevenue}, ${pct(vt, true)} vs target.${labNote}`;
    } else if (vt < -15) {
      // Weak day — flag for tomorrow
      const labNote = ctx.labour.variance > 0
        ? ` Labour ${pct(ctx.labour.variance, true)} over target adds further cost pressure.`
        : "";
      return `Day closed at ${closeRevenue}, ${pct(vt)} vs target. Review covers and conversion gaps before tomorrow's prep.${labNote}`;
    } else {
      // Slightly behind
      const labNote = ctx.labour.variance > 0
        ? ` Labour ${pct(ctx.labour.variance, true)} over target.`
        : "";
      return `After hours. Today closed at ${closeRevenue}, ${pct(vt)} vs target.${labNote} Review roster for tomorrow.`;
    }
  }

  // ── 3. Sports / confirmed event uplift ────────────────────────────────────
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

  // ── 4. Ramadan suppression ────────────────────────────────────────────────
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

  // ── 5. Critical: service-blocking maintenance ─────────────────────────────
  if (sev === "critical" && ctx.maintenance.serviceBlocking) {
    const costNote = primaryThreat.moneyAtRisk > 0
      ? ` ${fmt(primaryThreat.moneyAtRisk)} at risk.`
      : "";
    return `Service-blocking maintenance is unresolved.${costNote} Resolve immediately — escalate to GM if not fixed in 30 minutes.`;
  }

  // ── 6. Critical: revenue collapse + compound signals ─────────────────────
  if (sev === "critical") {
    const parts: string[] = [];

    if (
      primaryThreat.modulesInvolved.includes("REVENUE") &&
      primaryThreat.moneyAtRisk > 0
    ) {
      parts.push(`Revenue is ${fmt(primaryThreat.moneyAtRisk)} behind`);
    }
    if (primaryThreat.modulesInvolved.includes("LABOUR") && ctx.labour.variance > 8) {
      parts.push(`labour is ${pct(ctx.labour.variance, true)} over target`);
    }
    if (
      primaryThreat.timeWindowMinutes > 0 &&
      primaryThreat.timeWindowMinutes <= 120
    ) {
      const hrs = Math.round(primaryThreat.timeWindowMinutes / 60);
      parts.push(hrs <= 1 ? "with less than an hour left" : `with ${hrs} hours left`);
    }
    const directive = primaryThreat.recommendedAction.split(".")[0];
    if (directive && directive.length > 10) {
      return parts.join(" — ") + ". " + directive + ".";
    }
    if (parts.length > 0) return parts.join(" — ") + ".";
  }

  // ── 7. Revenue recovery possible (realistic window, not too far gone) ─────
  if (
    recoveryMeter &&
    !recoveryMeter.isOnTrack &&
    !recoveryMeter.limitedWindow &&
    !recoveryMeter.partialOnly &&
    recoveryMeter.recoverable > 2_000
  ) {
    const gap         = fmt(recoveryMeter.revenueGap);
    const recoverable = fmt(recoveryMeter.recoverable);
    const hoursLeft   = Math.round(recoveryMeter.timeLeftMinutes / 60);
    return `Revenue gap of ${gap}. ${recoverable} recoverable in the next ${hoursLeft}h — push floor conversion now.`;
  }

  // ── 8. Revenue behind + partial recovery only ─────────────────────────────
  if (
    recoveryMeter &&
    recoveryMeter.partialOnly &&
    recoveryMeter.recoverable > 0
  ) {
    const gap         = fmt(recoveryMeter.revenueGap);
    const recoverable = fmt(recoveryMeter.recoverable);
    return `Revenue ${pct(forecastSummary.vsTarget)} vs target. Partial recovery possible — up to ${recoverable} of ${gap} gap.`;
  }

  // ── 9. Limited window — narrow recovery ───────────────────────────────────
  if (recoveryMeter && recoveryMeter.limitedWindow) {
    const gap = fmt(recoveryMeter.revenueGap);
    return `Revenue gap of ${gap} with less than 1 hour left. Limited recovery window — maximise table turn and conversions now.`;
  }

  // ── 10. Pre-service labour surge ──────────────────────────────────────────
  if (
    ctx.meta.timeOfDay === "pre-service" &&
    ctx.labour.variance > 10
  ) {
    return `Labour entering service ${pct(ctx.labour.variance, true)} over budget. Review roster and send home non-essential staff before opening.`;
  }

  // ── 11. Revenue behind + weak duty completion ─────────────────────────────
  if (
    ctx.revenue.variance < -10 &&
    ctx.dailyOps.completionRate < 70
  ) {
    return `Revenue ${pct(ctx.revenue.variance)} vs target with only ${ctx.dailyOps.completionRate}% of duties complete — compound operational risk. Address backlog immediately.`;
  }

  // ── 12. Labour over target only (no revenue alert) ────────────────────────
  if (
    ctx.labour.variance > 8 &&
    ctx.revenue.variance > -5 &&
    !primaryThreat.modulesInvolved.includes("REVENUE")
  ) {
    const suggestion = ctx.meta.timeOfDay === "post-service"
      ? "Adjust tomorrow's roster."
      : "Consider early send-home to bring cost back to target.";
    return `Labour running ${pct(ctx.labour.variance, true)} over target. ${suggestion}`;
  }

  // ── 13. Compliance overdue (S4 compound or compliance primary) ─────────────
  if (
    ctx.compliance.overdueCount > 0 &&
    ctx.revenue.variance > -10 &&
    sev !== "critical"
  ) {
    const itemWord = ctx.compliance.overdueCount === 1 ? "item" : "items";
    const maintNote = ctx.maintenance.urgentCount > 0
      ? ` ${ctx.maintenance.urgentCount} maintenance issues also unresolved.`
      : "";
    return `${ctx.compliance.overdueCount} compliance ${itemWord} overdue.${maintNote} Audit exposure growing — action required today.`;
  }

  // ── 14. Revenue focus (high/medium threat) ────────────────────────────────
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

  // ── 15. Maintenance compound ──────────────────────────────────────────────
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

  // ── 16. GM declining performance ──────────────────────────────────────────
  if (gmSituation.alertNeeded) {
    return `GM performance at ${gmSituation.score}/100 — review task completion and escalation patterns.`;
  }

  // ── 17. Strong pace — all good, ahead of target ───────────────────────────
  if (sev === "low" && systemHealth.score >= 75) {
    const vt = forecastSummary.vsTarget ?? 0;
    if (vt > 5) {
      return `Strong pace. Revenue ${pct(vt, true)} ahead of target. Monitor walk-in conversion for sustained lead.`;
    }
    const revNote =
      vt >= -2
        ? "tracking on target"
        : `${pct(vt)} vs target`;
    return (
      `All systems nominal. ${revNote.charAt(0).toUpperCase() + revNote.slice(1)}.` +
      ` Monitor floor energy and walk-in conversion.`
    );
  }

  // ── 18. Fallback ──────────────────────────────────────────────────────────
  return `${primaryThreat.title}. ${primaryThreat.recommendedAction.split(".")[0]}.`;
}
