"use client";

import { cn } from "@/lib/utils";

type ScoreColor = "emerald" | "blue" | "violet";

interface Props {
  label:       string;
  description: string;
  score:       number;
  trend:       number;
  detail:      string;
  color:       ScoreColor;
}

const COLOR_MAP: Record<ScoreColor, {
  ring:       string;
  fill:       string;
  badge:      string;
  scoreText:  string;
}> = {
  emerald: {
    ring:      "stroke-emerald-500 dark:stroke-emerald-400",
    fill:      "stroke-emerald-100 dark:stroke-emerald-900/30",
    badge:     "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    scoreText: "text-emerald-600 dark:text-emerald-400",
  },
  blue: {
    ring:      "stroke-blue-500 dark:stroke-blue-400",
    fill:      "stroke-blue-100 dark:stroke-blue-900/30",
    badge:     "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    scoreText: "text-blue-600 dark:text-blue-400",
  },
  violet: {
    ring:      "stroke-violet-500 dark:stroke-violet-400",
    fill:      "stroke-violet-100 dark:stroke-violet-900/30",
    badge:     "bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
    scoreText: "text-violet-600 dark:text-violet-400",
  },
};

function scoreToGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

/**
 * Circular SVG progress ring — no external dependency.
 * radius=40, circumference ≈ 251.3
 */
function ScoreRing({
  score,
  color,
}: {
  score: number;
  color: ScoreColor;
}) {
  const radius      = 40;
  const circumference = 2 * Math.PI * radius;
  const progress    = circumference - (score / 100) * circumference;
  const c           = COLOR_MAP[color];

  return (
    <svg width="100" height="100" viewBox="0 0 100 100" className="rotate-[-90deg]">
      {/* Track */}
      <circle
        cx="50" cy="50" r={radius}
        strokeWidth="8"
        fill="none"
        className={c.fill}
        stroke="currentColor"
      />
      {/* Progress arc */}
      <circle
        cx="50" cy="50" r={radius}
        strokeWidth="8"
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={progress}
        strokeLinecap="round"
        className={c.ring}
        stroke="currentColor"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

export default function AdoptionScoreCard({ label, description, score, trend, detail, color }: Props) {
  const c       = COLOR_MAP[color];
  const grade   = scoreToGrade(score);
  const trendUp = trend > 0;
  const trendEq = trend === 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            {label}
          </p>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-600 truncate">
            {description}
          </p>
        </div>

        {/* Grade badge */}
        <span className={cn("ml-2 rounded-md px-2 py-0.5 text-sm font-bold", c.badge)}>
          {grade}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        {/* Ring */}
        <div className="relative shrink-0">
          <ScoreRing score={score} color={color} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn("text-xl font-bold", c.scoreText)}>{score}</span>
          </div>
        </div>

        {/* Meta */}
        <div>
          <p className="text-stone-500 dark:text-stone-400 text-xs">{detail}</p>
          {!trendEq && (
            <p
              className={cn(
                "mt-1 text-xs font-medium",
                trendUp
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400",
              )}
            >
              {trendUp ? "▲" : "▼"} {Math.abs(trend)}% vs last period
            </p>
          )}
          {trendEq && (
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-600">
              — Building baseline
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
