/**
 * OperatingScoreCard — Horizontal threat bar + breakdown bars.
 * Matches Command Center design language — no ring, no rounded corners > 4px.
 */

"use client";

import { cn } from "@/lib/utils";
import type { CopilotOperatingScore, ScoreGrade } from "@/lib/copilot/types";

type Props = {
  score: CopilotOperatingScore;
};

const GRADE_COLOR: Record<ScoreGrade, string> = {
  A: "text-emerald-400",
  B: "text-emerald-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const GRADE_BORDER: Record<ScoreGrade, string> = {
  A: "border-l-emerald-500",
  B: "border-l-emerald-500",
  C: "border-l-amber-500",
  D: "border-l-orange-500",
  F: "border-l-red-500",
};

const BAR_COLOR: Record<ScoreGrade, string> = {
  A: "bg-emerald-500/60",
  B: "bg-emerald-500/60",
  C: "bg-amber-500/60",
  D: "bg-orange-500/60",
  F: "bg-red-500/60",
};

const COMPONENTS: { key: keyof CopilotOperatingScore["breakdown"]; label: string; max: number }[] = [
  { key: "service",     label: "Service",     max: 25 },
  { key: "revenue",     label: "Revenue",     max: 25 },
  { key: "labour",      label: "Labour",      max: 20 },
  { key: "maintenance", label: "Maintenance", max: 10 },
  { key: "compliance",  label: "Compliance",  max: 10 },
];

function segmentColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-500/60";
  if (pct >= 40) return "bg-amber-500/60";
  return "bg-red-500/60";
}

export default function OperatingScoreCard({ score }: Props) {
  const pct = Math.min(100, Math.round(score.totalScore));

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        Operating Score
      </h2>

      {/* Threat bar */}
      <div className={cn(
        "border border-[#1a1a1a] border-l-[3px] bg-[#0f0f0f] px-4 py-3",
        GRADE_BORDER[score.grade],
      )}>
        <div className="flex items-center gap-3 font-mono text-[11px] mb-2">
          <span className={cn("font-bold text-sm", GRADE_COLOR[score.grade])}>
            {score.totalScore}
            <span className="text-stone-600 text-[11px] font-normal">/90</span>
          </span>
          <span className="text-stone-600">·</span>
          <span className={cn("font-bold tracking-wider uppercase text-[10px]", GRADE_COLOR[score.grade])}>
            Grade {score.grade}
          </span>
        </div>
        {/* Fill bar */}
        <div className="h-1 bg-[#1a1a1a] w-full">
          <div
            className={cn("h-full transition-all duration-700", BAR_COLOR[score.grade])}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[10px] text-stone-600 mt-1.5 leading-snug">{score.scoreSummary}</p>
      </div>

      {/* Breakdown bars */}
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
        {COMPONENTS.map(({ key, label, max }) => {
          const val = score.breakdown[key];
          const barPct = max > 0 ? (val / max) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-2">
              <span className="text-[9px] uppercase tracking-wider text-stone-600 w-20 flex-shrink-0">{label}</span>
              <div className="flex-1 h-0.5 bg-[#1a1a1a]">
                <div
                  className={cn("h-full transition-all duration-500", segmentColor(barPct))}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <span className="text-[10px] text-stone-500 w-8 text-right font-mono">
                {val}/{max}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
