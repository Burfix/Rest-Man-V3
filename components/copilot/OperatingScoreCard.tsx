/**
 * OperatingScoreCard — Service-weighted operating score with breakdown ring.
 *
 * Shows total score, grade, ring visualization, and 6-component breakdown.
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

const RING_COLOR: Record<ScoreGrade, string> = {
  A: "stroke-emerald-500",
  B: "stroke-emerald-500",
  C: "stroke-amber-500",
  D: "stroke-orange-500",
  F: "stroke-red-500",
};

const COMPONENTS: { key: keyof CopilotOperatingScore["breakdown"]; label: string; max: number }[] = [
  { key: "service",     label: "Service",     max: 25 },
  { key: "revenue",     label: "Revenue",     max: 25 },
  { key: "labour",      label: "Labour",      max: 20 },
  { key: "inventory",   label: "Inventory",   max: 10 },
  { key: "maintenance", label: "Maintenance", max: 10 },
  { key: "compliance",  label: "Compliance",  max: 10 },
];

function barColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export default function OperatingScoreCard({ score }: Props) {
  const pct = Math.min(100, Math.round(score.totalScore));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Operating Score
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 p-4 space-y-4">
        {/* Score ring */}
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 flex-shrink-0">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-stone-800/60" />
              <circle
                cx="60" cy="60" r={radius} fill="none" strokeWidth="6" strokeLinecap="round"
                className={cn(RING_COLOR[score.grade], "transition-all duration-700")}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-2xl font-bold", GRADE_COLOR[score.grade])}>
                {score.totalScore}
              </span>
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                Grade {score.grade}
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-xs text-stone-400 leading-relaxed">
              {score.scoreSummary}
            </p>
          </div>
        </div>

        {/* Breakdown bars */}
        <div className="space-y-2 border-t border-stone-800/30 pt-3">
          {COMPONENTS.map(({ key, label, max }) => {
            const val = score.breakdown[key];
            const barPct = max > 0 ? (val / max) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-stone-500 w-20 flex-shrink-0">{label}</span>
                <div className="flex-1 h-1.5 bg-stone-800/60 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", barColor(barPct))}
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
    </div>
  );
}
