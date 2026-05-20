/**
 * OperatingScoreHero — Full-width THREAT BAR replacing the SVG ring.
 *
 * [GRADE F] | [28/100] [████░░░░] | [5 ISSUES ACTIVE] | [TOP RISK: ...]
 * All on one line, monospace, no circle.
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

function getBarColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 55) return "bg-amber-500";
  if (pct >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function getBorderColor(pct: number): string {
  if (pct >= 70) return "border-emerald-800/40";
  if (pct >= 55) return "border-amber-800/40";
  if (pct >= 40) return "border-orange-800/40";
  return "border-red-800/40";
}

export default function OperatingScoreHero({
  score,
  maxScore = 100,
  status,
  issueCount,
  topRisk,
}: Props) {
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const grade = getGrade(pct);
  const barColor = getBarColor(pct);
  const borderColor = getBorderColor(pct);

  return (
    <div className={cn("w-full rounded border bg-stone-950/80 overflow-hidden", borderColor)}>
      <div className="flex items-stretch divide-x divide-stone-200 dark:divide-stone-800/60">

        {/* Grade */}
        <div className="flex items-center px-4 py-2.5 shrink-0">
          <span className={cn("font-mono font-black text-sm uppercase tracking-widest", grade.color)}>
            GRADE {grade.letter}
          </span>
        </div>

        {/* Score + fill bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 shrink-0">
          <span className="font-mono">
            <span className={cn("font-black text-xl", grade.color)}>{score}</span>
            <span className="text-stone-700 text-xs">/100</span>
          </span>
          <div className="w-24 h-1 bg-stone-100 dark:bg-stone-800 rounded-sm overflow-hidden">
            <div
              className={cn("h-full transition-all duration-1000", barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Issues active */}
        {issueCount > 0 && (
          <div className="flex items-center px-4 py-2.5 shrink-0">
            <span className="font-mono text-[11px] text-red-400 font-semibold uppercase tracking-wider">
              {issueCount} ISSUE{issueCount !== 1 ? "S" : ""} ACTIVE
            </span>
          </div>
        )}

        {/* Top risk — fills remaining space */}
        {topRisk && (
          <div className="flex items-center px-4 py-2.5 flex-1 min-w-0">
            <span className="font-mono text-[11px] text-stone-600 uppercase tracking-wider truncate">
              TOP RISK:{" "}
              <span className="text-stone-500 dark:text-stone-400">{topRisk.toUpperCase()}</span>
            </span>
          </div>
        )}

        {/* Status label — right edge */}
        <div className="flex items-center px-4 py-2.5 shrink-0 ml-auto">
          <span className={cn(
            "font-mono text-[10px] uppercase tracking-widest",
            status === "healthy" ? "text-emerald-500/60" :
            status === "needs_attention" ? "text-amber-500/60" :
            "text-red-500/60"
          )}>
            {status === "healthy" ? "NOMINAL" : status === "needs_attention" ? "ATTENTION" : "CRITICAL"}
          </span>
        </div>
      </div>
    </div>
  );
}
