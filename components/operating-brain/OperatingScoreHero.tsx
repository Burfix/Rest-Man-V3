/**
 * OperatingScoreHero — Dominant visual element at center of dashboard.
 *
 * Large animated score ring with grade, status label, and
 * 3-word consequence summary. This IS the dashboard anchor.
 */

"use client";

import { cn } from "@/lib/utils";

type Props = {
  score: number;
  maxScore?: number;
  status: "healthy" | "needs_attention" | "critical";
  issueCount: number;
  topRisk?: string;
};

function getGrade(pct: number): { letter: string; color: string } {
  if (pct >= 85) return { letter: "A", color: "text-emerald-400" };
  if (pct >= 70) return { letter: "B", color: "text-emerald-400" };
  if (pct >= 55) return { letter: "C", color: "text-amber-400" };
  if (pct >= 40) return { letter: "D", color: "text-orange-400" };
  return { letter: "F", color: "text-red-400" };
}

function getRingColor(pct: number): string {
  if (pct >= 70) return "stroke-emerald-500";
  if (pct >= 55) return "stroke-amber-500";
  if (pct >= 40) return "stroke-orange-500";
  return "stroke-red-500";
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  healthy:         { text: "Operations On Track",       cls: "text-emerald-400" },
  needs_attention: { text: "Attention Required",        cls: "text-amber-400" },
  critical:        { text: "Immediate Action Needed",   cls: "text-red-400" },
};

export default function OperatingScoreHero({
  score,
  maxScore = 100,
  status,
  issueCount,
  topRisk,
}: Props) {
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const grade = getGrade(pct);
  const ringColor = getRingColor(pct);
  const statusCfg = STATUS_LABEL[status] ?? STATUS_LABEL.healthy;

  // SVG ring math
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center py-5">
      {/* Score Ring */}
      <div className="relative h-40 w-40">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128">
          {/* Background ring */}
          <circle
            cx="64" cy="64" r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-stone-800/60"
          />
          {/* Score ring */}
          <circle
            cx="64" cy="64" r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className={cn(ringColor, "transition-all duration-1000")}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-4xl font-black font-mono", grade.color)}>
            {score}
          </span>
          <span className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">
            / {maxScore}
          </span>
        </div>
      </div>

      {/* Grade + Status */}
      <div className="mt-3 flex items-center gap-2">
        <span className={cn("text-lg font-bold", grade.color)}>
          Grade {grade.letter}
        </span>
        <span className="text-stone-700">·</span>
        <span className={cn("text-sm font-semibold", statusCfg.cls)}>
          {statusCfg.text}
        </span>
      </div>

      {/* Issue count + top risk */}
      <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
        {issueCount > 0 && (
          <span className="rounded-full bg-red-500/10 text-red-400 px-2.5 py-0.5 font-medium">
            {issueCount} issue{issueCount !== 1 ? "s" : ""} active
          </span>
        )}
        {topRisk && (
          <span className="text-stone-400">
            Top risk: <span className="text-stone-300 font-medium">{topRisk}</span>
          </span>
        )}
      </div>
    </div>
  );
}
