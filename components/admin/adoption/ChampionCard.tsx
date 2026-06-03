"use client";

import type { ChampionUser } from "@/lib/adoption/types";
import { cn } from "@/lib/utils";

interface Props {
  champions: ChampionUser[];
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

function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH  = Math.floor(diffMs / 3600000);
  if (diffH < 1)  return "Just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "Yesterday";
  return `${diffD}d ago`;
}

export default function ChampionCard({ champions }: Props) {
  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700/60 bg-white dark:bg-stone-900 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🏆</span>
        <div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Champion Users
          </h3>
          <p className="text-xs text-stone-400 dark:text-stone-600">
            Highest engagement · Daily users · Action leaders
          </p>
        </div>
      </div>

      {champions.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg bg-stone-50 dark:bg-stone-800/40">
          <p className="text-xs text-stone-400 dark:text-stone-600">
            No champions identified yet — need more usage data
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {champions.map((user, i) => (
            <div
              key={user.userId}
              className={cn(
                "flex items-center gap-3 rounded-lg p-3",
                i === 0
                  ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40"
                  : "bg-stone-50 dark:bg-stone-800/40",
              )}
            >
              {/* Rank */}
              <div className="shrink-0 w-5 text-center text-xs font-bold text-stone-400">
                {i === 0 ? "★" : `${i + 1}`}
              </div>

              {/* Avatar */}
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  i === 0
                    ? "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200"
                    : "bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300",
                )}
              >
                {getInitials(user.fullName, user.email)}
              </div>

              {/* Identity */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                  {user.fullName ?? user.email}
                </p>
                <p className="text-[10px] text-stone-400 dark:text-stone-500 truncate">
                  {user.email}
                </p>
              </div>

              {/* Stats */}
              <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    {user.score}
                  </span>
                  <span className="text-[9px] text-stone-400">/100</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    title={`${user.loginDays7d}/7 login days`}
                    className="text-[9px] text-stone-400"
                  >
                    📅 {user.loginDays7d}d
                  </span>
                  <span
                    title={`${user.actionsCompleted14d} actions in 14d`}
                    className="text-[9px] text-stone-400"
                  >
                    ⚡ {user.actionsCompleted14d}
                  </span>
                </div>
              </div>

              {/* First-login-today badge */}
              {user.firstLoginToday && (
                <span
                  title="First to log in today"
                  className="shrink-0 rounded-full bg-amber-400 dark:bg-amber-600 w-2 h-2"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {champions.length > 0 && (
        <p className="mt-3 text-[10px] text-stone-400 dark:text-stone-600">
          ★ = First daily login today &nbsp;·&nbsp; Score = composite engagement (0–100)
          &nbsp;·&nbsp; ⚡ = actions completed in last 14 days
        </p>
      )}
    </div>
  );
}
