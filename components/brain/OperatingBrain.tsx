/**
 * OperatingBrain — Command Center top section.
 *
 * Server Component. Receives pre-computed BrainOutput from the page.
 * Renders 3-column layout:
 *   LEFT  (50%) — Primary Threat
 *   MIDDLE(30%) — Action Queue
 *   RIGHT (20%) — System Pulse
 *
 * Voice line appears in a full-width bar above the columns.
 */

import { cn } from "@/lib/utils";
import type { BrainOutput } from "@/services/brain/operating-brain";
import ActionTakenButton from "./ActionTakenButton";

type Props = {
  brain: BrainOutput;
};

// ── Colour maps ───────────────────────────────────────────────────────────────

const SEV_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high:     "border-l-amber-500",
  medium:   "border-l-yellow-500",
  low:      "border-l-stone-700",
};

const SEV_BADGE: Record<string, string> = {
  critical: "bg-[#fef2f2] text-[#991b1b] border-[#fca5a5] dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50",
  high:     "bg-[#fffbeb] text-[#92400e] border-[#fcd34d] dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50",
  medium:   "bg-[#fefce8] text-[#713f12] border-[#fde047] dark:bg-yellow-950/20 dark:text-yellow-400 dark:border-yellow-900/50",
  low:      "bg-[#f9fafb] text-[#6b7280] border-[#d1d5db] dark:bg-stone-900/20 dark:text-stone-500 dark:border-stone-700",
};

const SEV_MONEY: Record<string, string> = {
  critical: "text-red-400",
  high:     "text-amber-400",
  medium:   "text-yellow-400",
  low:      "text-stone-400",
};

const GRADE_COLOR: Record<string, string> = {
  A:   "text-emerald-600 dark:text-emerald-400",
  B:   "text-emerald-700 dark:text-emerald-500",
  C:   "text-amber-600 dark:text-amber-400",
  D:   "text-amber-700 dark:text-amber-500",
  F:   "text-red-600 dark:text-red-400",
  "?": "text-stone-600",
};

const TREND_ARROW: Record<string, string> = {
  improving: "↑",
  stable:    "→",
  declining: "↓",
};

const TREND_COLOR: Record<string, string> = {
  improving: "text-emerald-600 dark:text-emerald-400",
  stable:    "text-stone-500",
  declining: "text-red-600 dark:text-red-400",
};

const TIER_COLOR: Record<string, string> = {
  Elite:    "text-emerald-600 dark:text-emerald-400",
  Strong:   "text-emerald-700 dark:text-emerald-500",
  Average:  "text-amber-600 dark:text-amber-400",
  "At Risk":"text-red-600 dark:text-red-400",
  Unknown:  "text-stone-600",
};

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperatingBrain({ brain }: Props) {
  const { primaryThreat, actionQueue, systemHealth, forecastSummary, gmSituation, voiceLine } = brain;
  const sev = primaryThreat.severity;

  return (
    <div className="border border-[#e2e2e0] dark:border-[#1a1a1a] bg-white dark:bg-[#060606]">

      {/* ── Voice line — full width bar ── */}
      {voiceLine && (
        <div className="border-b border-[#e2e2e0] dark:border-[#1a1a1a] px-4 py-2 bg-[#f8f8f6] dark:bg-[#0a0a0a]">
          <p className="text-[11px] text-[#52524e] dark:text-stone-400 font-mono leading-relaxed">{voiceLine}</p>
        </div>
      )}

      {/* ── 3-column grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr_2fr] divide-y lg:divide-y-0 lg:divide-x divide-[#e2e2e0] dark:divide-[#1a1a1a]">

        {/* ════════════ LEFT — Primary Threat ════════════ */}
        <div className={cn("border-l-[6px] p-4 space-y-3 bg-white dark:bg-[#0f0f0f]", SEV_BORDER[sev])}>

          {/* Section label */}
          <span className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-medium block">
            BIGGEST RISK RIGHT NOW
          </span>

          {/* Severity + Module badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              "text-[10px] font-black uppercase tracking-wider border px-1.5 py-0.5",
              SEV_BADGE[sev],
            )}>
              {sev}
            </span>
            {primaryThreat.modulesInvolved.map((mod) => (
              <span
                key={mod}
                className="text-[9px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-600 border border-[#e2e2e0] dark:border-[#2a2a2a] px-1.5 py-0.5"
              >
                {mod}
              </span>
            ))}
          </div>

          {/* Title + description */}
          <div>
            <p className="text-sm font-bold text-[#0a0a0a] dark:text-stone-100 leading-snug">{primaryThreat.title}</p>
            {primaryThreat.description && (
              <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">{primaryThreat.description}</p>
            )}
          </div>

          {/* Key facts grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
            <div>
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">OWNER</span>
              <span className="text-[#0a0a0a] dark:text-stone-300">{primaryThreat.owner.name}</span>
            </div>
            {primaryThreat.moneyAtRisk > 0 && (
              <div>
                <span className="text-[9px] uppercase tracking-wider text-stone-600 block">MONEY AT RISK</span>
                <span className={cn("font-bold", SEV_MONEY[sev])}>{fmt(primaryThreat.moneyAtRisk)}</span>
              </div>
            )}
            <div>
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">TIME WINDOW</span>
              <span className="text-[#0a0a0a] dark:text-stone-300">{primaryThreat.timeWindowLabel}</span>
            </div>
            <div>
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">CONFIDENCE</span>
              <span className="text-stone-500 uppercase">{primaryThreat.confidence}</span>
            </div>
          </div>

          {/* Do this first */}
          <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3">
            <span className="text-[9px] uppercase tracking-wider text-stone-500 font-semibold block mb-1">
              DO THIS FIRST
            </span>
            <p className="text-[11px] text-[#0a0a0a] dark:text-stone-300 leading-relaxed">{primaryThreat.recommendedAction}</p>
          </div>

          {/* If you do nothing */}
          {sev !== "low" && (
            <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3">
              <span className="text-[9px] uppercase tracking-wider text-red-500/70 font-semibold block mb-1">
                IF YOU DO NOTHING
              </span>
              <p className="text-[11px] text-red-700/80 dark:text-red-300/70 leading-relaxed opacity-60 hover:opacity-100 transition-opacity duration-200">
                {primaryThreat.ifIgnored}
              </p>
            </div>
          )}

          {/* Action button */}
          {sev !== "low" && (
            <ActionTakenButton
              signalId={primaryThreat.title}
              siteId={brain.siteId}
              severity={sev}
              category={primaryThreat.modulesInvolved[0] ?? "unknown"}
              title={primaryThreat.title}
            />
          )}
        </div>

        {/* ════════════ MIDDLE — Action Queue ════════════ */}
        <div className="p-4 bg-[#fafafa] dark:bg-[#0c0c0c]">
          <span className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-medium block mb-3">
            DO NEXT
          </span>
          {actionQueue.length === 0 ? (
            <p className="text-[11px] text-stone-600 font-mono">No pending actions.</p>
          ) : (
            <div className="space-y-3">
              {actionQueue.map((action) => (
                <div key={action.priority} className="flex gap-2.5">
                  <span className="text-[10px] font-black font-mono text-stone-600 w-4 shrink-0 mt-[1px]">
                    {action.priority}.
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#0a0a0a] dark:text-stone-300 leading-snug">
                      {action.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-mono text-stone-500">{action.ownerRole}</span>
                      <span className="text-stone-700">·</span>
                      <span className="text-[10px] font-mono text-stone-600">~{action.estimatedMinutes} min</span>
                      {action.deadline && (
                        <>
                          <span className="text-stone-700">·</span>
                          <span className="text-[10px] font-mono text-stone-700">{action.deadline}</span>
                        </>
                      )}
                    </div>
                    {action.financialImpact && (
                      <span className="text-[10px] font-mono text-amber-700 dark:text-amber-500/70 mt-0.5 block">
                        {action.financialImpact}
                      </span>
                    )}
                    {action.escalateTo && (
                      <span className="text-[9px] font-mono text-stone-600 uppercase tracking-wider mt-0.5 block">
                        Escalate → {action.escalateTo}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ════════════ RIGHT — System Pulse ════════════ */}
        <div className="p-4 bg-[#f8f8f6] dark:bg-[#0a0a0a] space-y-4">
          <span className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-medium block">
            SYSTEM PULSE
          </span>

          {/* Score + Grade + Trend */}
          <div className="font-mono">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-[#0a0a0a] dark:text-stone-100">{systemHealth.score}</span>
              {systemHealth.isDayStarting ? (
                <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                  DAY STARTING
                </span>
              ) : (
                <span className={cn("text-xl font-black", GRADE_COLOR[systemHealth.grade] ?? "text-stone-500")}>
                  {systemHealth.grade}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn("text-base font-bold leading-none", TREND_COLOR[systemHealth.trend])}>
                {TREND_ARROW[systemHealth.trend]}
              </span>
              <span className="text-[10px] text-stone-600 uppercase tracking-wider">
                {systemHealth.criticalCount > 0
                  ? `${systemHealth.criticalCount} critical`
                  : systemHealth.highCount > 0
                  ? `${systemHealth.highCount} high`
                  : "nominal"}
              </span>
            </div>
            {!systemHealth.isDutyWindow && !systemHealth.isDayStarting && (
              <p className="text-[9px] text-stone-500 dark:text-stone-600 font-mono mt-0.5">
                Score reflects revenue + labour only · Duties scored from noon
              </p>
            )}
          </div>

          {/* Score Drivers */}
          {systemHealth.scoreDrivers.length > 0 && (
            <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 space-y-1.5 font-mono">
              <span className="text-[9px] uppercase tracking-wider text-stone-600 block">SCORE DRIVERS</span>
              {systemHealth.scoreDrivers.map((driver) => (
                <div key={driver.module} className="flex items-start gap-1.5">
                  <span className={cn(
                    "text-[10px] font-bold leading-tight shrink-0",
                    driver.direction === "up" ? "text-emerald-700 dark:text-emerald-500" : "text-red-600 dark:text-red-400",
                  )}>
                    {driver.direction === "up" ? "+" : "−"}
                  </span>
                  <div className="min-w-0">
                    <span className={cn(
                      "text-[9px] font-bold uppercase tracking-wider block leading-tight",
                      driver.direction === "up" ? "text-emerald-700 dark:text-emerald-600" : "text-red-700/80 dark:text-red-400/70",
                    )}>
                      {driver.module}
                    </span>
                    <span className="text-[9px] text-stone-600 leading-snug">
                      {driver.reason}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Forecast */}
          <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono space-y-0.5">
            <span className="text-[9px] uppercase tracking-wider text-stone-600 block">
              {forecastSummary.isDayClosed
                ? "TODAY'S REVENUE"
                : forecastSummary.isPreService
                ? "FORECAST · BASELINE"
                : "PROJECTED CLOSE"}
            </span>
            {forecastSummary.syncPending ? (
              <span className="text-[11px] text-amber-500 font-medium">Sync pending</span>
            ) : (
              <span className="text-base font-bold text-[#0a0a0a] dark:text-stone-200">
                {forecastSummary.projectedClose > 0 ? fmt(forecastSummary.projectedClose) : "—"}
              </span>
            )}
            {/* Show ±% vs target for live projection and closed day; suppress for pre-service baseline */}
            {forecastSummary.projectedClose > 0 && !forecastSummary.isPreService && !forecastSummary.syncPending && (
              <span className={cn(
                "text-[11px] font-bold block",
                (forecastSummary.vsTarget ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
              )}>
                {(forecastSummary.vsTarget ?? 0) >= 0 ? "+" : ""}
                {(forecastSummary.vsTarget ?? 0).toFixed(1)}% vs target
              </span>
            )}
          </div>

          {/* GM Situation */}
          <div className="border-t border-[#e2e2e0] dark:border-[#1a1a1a] pt-3 font-mono">
            <span className="text-[9px] uppercase tracking-wider text-stone-600 block mb-1">GM</span>
            <span className="text-[11px] text-[#0a0a0a] dark:text-stone-300 block">{gmSituation.name}</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {gmSituation.tier !== "Unknown" && (
                <span className={cn("text-[10px] font-bold", TIER_COLOR[gmSituation.tier] ?? "text-stone-500")}>
                  {gmSituation.tier}
                </span>
              )}
              {gmSituation.score > 0 && (
                <span className="text-[10px] text-stone-600">{gmSituation.score}/100</span>
              )}
            </div>
            {gmSituation.alertNeeded && (
              <span className="text-[9px] text-red-700/80 dark:text-red-400/70 block mt-0.5 leading-snug">
                {gmSituation.alertReason}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
