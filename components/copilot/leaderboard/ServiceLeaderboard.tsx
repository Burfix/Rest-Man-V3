/**
 * ServiceLeaderboard — Service gamification leaderboard for Head Office.
 *
 * Sections:
 *   1. Top Performers (rank 1-5 by service score)
 *   2. Most Improved (biggest positive movement)
 *   3. At Risk / Repeat Low Score (score < 55)
 *   4. Shift Awards (best lunch, dinner, recovery)
 *
 * Uses the leaderboard engine from lib/copilot/leaderboard.ts
 */

"use client";

import { cn } from "@/lib/utils";
import type { LeaderboardEntry, ShiftLeaderboardEntry } from "@/lib/copilot/leaderboard";
import type { ShiftAward } from "@/lib/copilot/shift-performance";

type Props = {
  topPerformers: LeaderboardEntry[];
  mostImproved: LeaderboardEntry[];
  atRisk: LeaderboardEntry[];
  shiftAwards?: ShiftAward[];
};

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-blue-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const RISK_COLOR: Record<string, { bg: string; text: string }> = {
  none:     { bg: "bg-emerald-950/30", text: "text-emerald-400" },
  low:      { bg: "bg-emerald-950/30", text: "text-emerald-400" },
  moderate: { bg: "bg-amber-950/30",   text: "text-amber-400" },
  high:     { bg: "bg-red-950/30",     text: "text-red-400" },
  critical: { bg: "bg-red-950/40",     text: "text-red-400" },
};

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

export default function ServiceLeaderboard({ topPerformers, mostImproved, atRisk, shiftAwards }: Props) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">Service Leaderboard</h2>
          <p className="text-xs text-stone-500 mt-0.5">Competitive service performance across all stores</p>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-stone-500 bg-stone-100 dark:bg-stone-800/50 px-2 py-1 rounded">
          Live
        </span>
      </div>

      {/* Top Performers */}
      {topPerformers.length > 0 && (
        <Section title="Top Performers">
          <div className="space-y-1.5">
            {topPerformers.slice(0, 5).map((entry, i) => (
              <LeaderboardRow key={entry.storeId} entry={entry} index={i} showMedal />
            ))}
          </div>
        </Section>
      )}

      {/* Most Improved */}
      {mostImproved.length > 0 && (
        <Section title="Most Improved">
          <div className="space-y-1.5">
            {mostImproved.slice(0, 3).map((entry, i) => (
              <LeaderboardRow key={entry.storeId} entry={entry} index={i} showMovement />
            ))}
          </div>
        </Section>
      )}

      {/* At Risk */}
      {atRisk.length > 0 && (
        <Section title="At Risk" variant="danger">
          <div className="space-y-1.5">
            {atRisk.slice(0, 5).map((entry, i) => (
              <LeaderboardRow key={entry.storeId} entry={entry} index={i} showRisk />
            ))}
          </div>
        </Section>
      )}

      {/* Shift Awards */}
      {shiftAwards && shiftAwards.length > 0 && (
        <Section title="Shift Awards">
          <div className="space-y-2">
            {shiftAwards.map((award, i) => (
              <div
                key={`${award.type}-${i}`}
                className="flex items-center justify-between rounded-lg bg-stone-100 dark:bg-stone-800/30 border border-stone-300 dark:border-stone-700/30 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">🏆</span>
                  <div>
                    <span className="text-xs text-stone-600 dark:text-stone-300 font-medium">{award.storeName}</span>
                    <p className="text-[11px] text-stone-500">{award.label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title, variant, children,
}: {
  title: string;
  variant?: "danger";
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-3",
      variant === "danger"
        ? "border-red-800/30 bg-red-950/10"
        : "border-stone-200 dark:border-stone-800/40 bg-stone-50 dark:bg-stone-900/50",
    )}>
      <h3 className={cn(
        "text-xs uppercase tracking-widest font-medium",
        variant === "danger" ? "text-red-400" : "text-stone-500",
      )}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function LeaderboardRow({
  entry, index, showMedal, showMovement, showRisk,
}: {
  entry: LeaderboardEntry;
  index: number;
  showMedal?: boolean;
  showMovement?: boolean;
  showRisk?: boolean;
}) {
  const risk = RISK_COLOR[entry.serviceRisk] ?? RISK_COLOR.moderate;

  return (
    <div className="flex items-center justify-between rounded-lg bg-stone-100 dark:bg-stone-800/20 border border-stone-300 dark:border-stone-700/20 px-3 py-2.5">
      {/* Left: rank + name */}
      <div className="flex items-center gap-2.5 min-w-0">
        {showMedal && index < 3 ? (
          <span className="text-base flex-shrink-0">{RANK_MEDAL[index]}</span>
        ) : (
          <span className="text-xs text-stone-500 font-mono w-5 text-center flex-shrink-0">
            {entry.rank}
          </span>
        )}
        <div className="min-w-0">
          <span className="text-sm text-stone-700 dark:text-stone-200 font-medium truncate block">
            {entry.storeName}
          </span>
          {entry.labels.length > 0 && (
            <div className="flex gap-1 mt-0.5">
              {entry.labels.slice(0, 2).map((l) => (
                <span key={l} className="text-[9px] text-emerald-400 bg-emerald-950/30 rounded-full px-1.5 py-0">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: score + detail */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Strength / weakness */}
        <div className="hidden sm:flex flex-col items-end text-[10px]">
          {entry.biggestStrength && (
            <span className="text-emerald-400">↑ {entry.biggestStrength}</span>
          )}
          {entry.biggestWeakness && (
            <span className="text-red-400">↓ {entry.biggestWeakness}</span>
          )}
        </div>

        {/* Movement */}
        {showMovement && entry.movement != null && entry.movement !== 0 && (
          <span className={cn(
            "text-xs font-mono",
            entry.movement > 0 ? "text-emerald-400" : "text-red-400",
          )}>
            {entry.movement > 0 ? "+" : ""}{entry.movement}
          </span>
        )}

        {/* Risk badge */}
        {showRisk && (
          <span className={cn(
            "text-[10px] uppercase font-bold rounded-full px-2 py-0.5",
            risk.bg, risk.text,
          )}>
            {entry.serviceRisk}
          </span>
        )}

        {/* Score + grade */}
        <div className="flex items-center gap-1">
          <span className={cn(
            "text-base font-bold font-mono",
            GRADE_COLOR[entry.serviceGrade] ?? "text-stone-600 dark:text-stone-300",
          )}>
            {entry.serviceScore}
          </span>
          <span className={cn(
            "text-[10px] font-bold",
            GRADE_COLOR[entry.serviceGrade] ?? "text-stone-500 dark:text-stone-400",
          )}>
            {entry.serviceGrade}
          </span>
        </div>
      </div>
    </div>
  );
}
