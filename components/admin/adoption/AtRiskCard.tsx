"use client";

import type { AtRiskUser } from "@/lib/adoption/types";
import { cn } from "@/lib/utils";

interface Props {
  atRiskUsers: AtRiskUser[];
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function riskLevel(score: number, daysSince: number | null): "high" | "medium" | "low" {
  if (score < 15 || (daysSince !== null && daysSince >= 14)) return "high";
  if (score < 30 || (daysSince !== null && daysSince >= 7))  return "medium";
  return "low";
}

const RISK_STYLES = {
  high:   "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40",
  medium: "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40",
  low:    "bg-stone-50 dark:bg-stone-800/40 border-stone-200 dark:border-stone-700",
};

const RISK_DOT = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-stone-400",
};

export default function AtRiskCard({ atRiskUsers }: Props) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">⚠️</span>
        <div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            At-Risk Users
          </h3>
          <p className="text-xs text-stone-400 dark:text-stone-600">
            Low engagement · Inactive users · Churn risk
          </p>
        </div>
        {atRiskUsers.length > 0 && (
          <span className="ml-auto inline-flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 w-5 h-5 text-[10px] font-bold text-red-600 dark:text-red-400">
            {atRiskUsers.length}
          </span>
        )}
      </div>

      {atRiskUsers.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30">
          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            ✓ All users are engaged
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {atRiskUsers.map((user) => {
            const level = riskLevel(user.score, user.daysSinceLogin);

            return (
              <div
                key={user.userId}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  RISK_STYLES[level],
                )}
              >
                {/* Risk dot */}
                <div className="mt-0.5 shrink-0">
                  <span className={cn("inline-block h-2 w-2 rounded-full", RISK_DOT[level])} />
                </div>

                {/* Avatar */}
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700 text-[10px] font-bold text-stone-600 dark:text-stone-300">
                  {getInitials(user.fullName, user.email)}
                </div>

                {/* Identity + reasons */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                    {user.fullName ?? user.email}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {user.riskReasons.map((reason) => (
                      <span
                        key={reason}
                        className="inline-block rounded bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 text-[9px] text-stone-500 dark:text-stone-400"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Score */}
                <div className="shrink-0 text-right">
                  <p className="text-xs font-bold text-red-500 dark:text-red-400">{user.score}</p>
                  <p className="text-[9px] text-stone-400">/100</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
