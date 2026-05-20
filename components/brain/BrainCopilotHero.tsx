/**
 * BrainCopilotHero — GM Co-Pilot hero card driven by BrainOutput.
 *
 * Replaces the original CopilotHero (which drew from GMBrief).
 * Matches the Command Center design language exactly.
 */

import { cn } from "@/lib/utils";
import type { BrainOutput } from "@/services/brain/operating-brain";

type Props = {
  brain: BrainOutput;
};

const SEV_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  high:     "border-l-amber-500",
  medium:   "border-l-yellow-500",
  low:      "border-l-stone-700",
};

const SEV_LABEL_COLOR: Record<string, string> = {
  critical: "text-red-400",
  high:     "text-amber-400",
  medium:   "text-yellow-400",
  low:      "text-stone-500 dark:text-stone-400",
};

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function MetricCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "warning" | "critical" | "neutral";
}) {
  const colors = {
    positive: "text-emerald-400",
    warning:  "text-amber-400",
    critical: "text-red-400",
    neutral:  "text-stone-500 dark:text-stone-400",
  };
  return (
    <div className="bg-[#0f0f0f] px-3 py-2.5">
      <span className="text-[9px] uppercase tracking-[0.15em] text-stone-600 font-semibold block">{label}</span>
      <span className={cn("text-sm font-bold font-mono", colors[tone])}>{value}</span>
    </div>
  );
}

export default function BrainCopilotHero({ brain }: Props) {
  const { primaryThreat, forecastSummary, systemHealth, voiceLine } = brain;
  const sev = primaryThreat.severity;

  const issueCount = systemHealth.criticalCount + systemHealth.highCount;

  return (
    <div className="space-y-2">
      {/* Threat bar */}
      <div className={cn(
        "border border-[#1a1a1a] border-l-[3px] bg-[#0f0f0f] px-4 py-3",
        SEV_BORDER[sev],
      )}>
        <div className="flex items-center gap-4 font-mono text-[11px] flex-wrap">
          <span className={cn("font-bold tracking-wider uppercase", SEV_LABEL_COLOR[sev])}>
            {sev}
          </span>
          <span className="text-stone-500">·</span>
          <span className="text-stone-600 dark:text-stone-300">
            {issueCount > 0 ? `${issueCount} issue${issueCount > 1 ? "s" : ""} active` : "no active issues"}
          </span>
          {primaryThreat.title !== "All Systems Nominal" && (
            <>
              <span className="text-stone-600">·</span>
              <span className="text-stone-500">
                Top risk:{" "}
                <span className="text-stone-600 dark:text-stone-300">{primaryThreat.title}</span>
              </span>
            </>
          )}
          <span className="ml-auto text-stone-600 text-[10px] tracking-widest uppercase font-mono">
            {primaryThreat.timeWindowLabel !== "No active window" ? primaryThreat.timeWindowLabel : "NOMINAL"}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-[#1a1a1a]">
        <MetricCell
          label="MONEY AT RISK"
          value={primaryThreat.moneyAtRisk > 0 ? fmt(primaryThreat.moneyAtRisk) : "None"}
          tone={
            primaryThreat.moneyAtRisk > 10_000 ? "critical"
            : primaryThreat.moneyAtRisk > 1_000 ? "warning"
            : "positive"
          }
        />
        <MetricCell
          label={forecastSummary.isDayClosed ? "TODAY'S REV" : forecastSummary.isPreService ? "BASELINE" : "PROJ CLOSE"}
          value={
            forecastSummary.syncPending
              ? "Sync pending"
              : forecastSummary.projectedClose > 0 ? fmt(forecastSummary.projectedClose) : "—"
          }
          tone={
            forecastSummary.syncPending ? "warning"
            : forecastSummary.isPreService ? "neutral"
            : (forecastSummary.vsTarget ?? 0) >= 0 ? "positive"
            : (forecastSummary.vsTarget ?? 0) > -15 ? "warning"
            : "critical"
          }
        />
        <MetricCell
          label="HEALTH SCORE"
          value={String(systemHealth.score)}
          tone={
            systemHealth.score >= 80 ? "positive"
            : systemHealth.score >= 60 ? "warning"
            : "critical"
          }
        />
        <MetricCell
          label="GRADE"
          value={systemHealth.grade}
          tone={
            "A,B".includes(systemHealth.grade) ? "positive"
            : "C,D".includes(systemHealth.grade) ? "warning"
            : systemHealth.grade === "?" ? "neutral"
            : "critical"
          }
        />
      </div>

      {/* Voice briefing line */}
      {voiceLine && (
        <div className="px-4 py-2.5 border border-[#1a1a1a] bg-[#0f0f0f]">
          <p className="text-[11px] font-mono text-stone-500 dark:text-stone-400 leading-relaxed">{voiceLine}</p>
        </div>
      )}

      {/* If ignored — faded until hover */}
      {sev !== "low" && primaryThreat.ifIgnored && (
        <div className="px-4 py-2 border border-[#1a1a1a] opacity-40 hover:opacity-100 transition-opacity duration-200">
          <span className="text-[10px] uppercase tracking-wider text-red-400/80 font-mono">
            If ignored →{" "}
          </span>
          <span className="text-[11px] text-red-300/80">{primaryThreat.ifIgnored}</span>
        </div>
      )}
    </div>
  );
}
