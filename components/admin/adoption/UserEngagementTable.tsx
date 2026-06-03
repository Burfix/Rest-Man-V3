"use client";

import { useState } from "react";
import type { UserEngagementScore } from "@/lib/adoption/types";
import { cn } from "@/lib/utils";

interface Props {
  users: UserEngagementScore[];
}

type SortKey = "score" | "lastLogin" | "actions" | "features" | "sessions";

const STATUS_STYLES: Record<UserEngagementScore["status"], string> = {
  champion:   "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  active:     "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  occasional: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  at_risk:    "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400",
  inactive:   "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
};

const STATUS_LABELS: Record<UserEngagementScore["status"], string> = {
  champion:   "Champion",
  active:     "Active",
  occasional: "Occasional",
  at_risk:    "At Risk",
  inactive:   "Inactive",
};

function ScoreMiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400">{value}</span>
    </div>
  );
}

function formatLastLogin(iso: string | null, daysSince: number | null): string {
  if (!iso) return "Never";
  if (daysSince === 0) return "Today";
  if (daysSince === 1) return "Yesterday";
  if (daysSince !== null) return `${daysSince}d ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

export default function UserEngagementTable({ users }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [search,  setSearch]  = useState("");

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      (u.fullName ?? "").toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "score":     return b.score - a.score;
      case "lastLogin": {
        const dA = a.daysSinceLogin ?? 9999;
        const dB = b.daysSinceLogin ?? 9999;
        return dA - dB;
      }
      case "actions":   return b.metrics.actionsCompleted14d - a.metrics.actionsCompleted14d;
      case "features":  return b.metrics.uniqueFeatures14d   - a.metrics.uniqueFeatures14d;
      case "sessions":  return b.metrics.sessionCount14d     - a.metrics.sessionCount14d;
      default:          return 0;
    }
  });

  function SortButton({ k, label }: { k: SortKey; label: string }) {
    return (
      <button
        onClick={() => setSortKey(k)}
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap",
          sortKey === k
            ? "text-stone-900 dark:text-stone-100"
            : "text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400",
        )}
      >
        {label} {sortKey === k && "↓"}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700/60 bg-white dark:bg-stone-900 shadow-sm">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            User Engagement
          </h3>
          <p className="text-xs text-stone-400 dark:text-stone-600">
            {users.length} tracked users · last 14 days
          </p>
        </div>
        <input
          type="search"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            "w-48 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800",
            "px-3 py-1.5 text-xs text-stone-700 dark:text-stone-300",
            "placeholder:text-stone-400 dark:placeholder:text-stone-600",
            "focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-600",
          )}
        />
      </div>

      {/* ── Sort bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 border-b border-stone-100 dark:border-stone-800 px-5 py-2.5">
        <span className="text-[10px] text-stone-400 dark:text-stone-600 uppercase tracking-wider">
          Sort:
        </span>
        <SortButton k="score"     label="Score"    />
        <SortButton k="lastLogin" label="Last Login" />
        <SortButton k="actions"   label="Actions"  />
        <SortButton k="features"  label="Features" />
        <SortButton k="sessions"  label="Sessions" />
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-xs text-stone-400">
            {search ? "No users match your search" : "No user engagement data yet"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {sorted.map((user) => {
            const avg = Math.round(user.metrics.avgSessionSeconds / 60);
            const daysSince = user.daysSinceLogin;

            return (
              <div
                key={user.userId}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors"
              >
                {/* Identity */}
                <div className="w-48 min-w-0">
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                    {user.fullName ?? user.email}
                  </p>
                  <p className="text-[10px] text-stone-400 dark:text-stone-600 truncate">
                    {user.email}
                  </p>
                </div>

                {/* Status badge */}
                <div className="w-20 shrink-0">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold",
                      STATUS_STYLES[user.status],
                    )}
                  >
                    {STATUS_LABELS[user.status]}
                  </span>
                </div>

                {/* Score */}
                <div className="w-20 shrink-0">
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
                      {user.score}
                    </span>
                    <span className="text-[10px] text-stone-400">/100</span>
                  </div>
                  {/* Component mini-bars */}
                  <div className="mt-0.5 space-y-0.5">
                    <ScoreMiniBar value={user.components.loginFrequency}   max={30} color="bg-emerald-400" />
                    <ScoreMiniBar value={user.components.actionCompletion} max={25} color="bg-blue-400" />
                    <ScoreMiniBar value={user.components.featureBreadth}   max={25} color="bg-violet-400" />
                  </div>
                </div>

                {/* Last login */}
                <div className="w-24 shrink-0">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      daysSince !== null && daysSince >= 7
                        ? "text-red-500 dark:text-red-400"
                        : daysSince === 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-stone-600 dark:text-stone-400",
                    )}
                  >
                    {formatLastLogin(user.lastLoginAt, daysSince)}
                  </p>
                  <p className="text-[10px] text-stone-400">
                    {user.metrics.loginDays7d}/7 days
                  </p>
                </div>

                {/* Actions */}
                <div className="w-20 shrink-0 text-center">
                  <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    {user.metrics.actionsCompleted14d}
                  </p>
                  <p className="text-[10px] text-stone-400">actions</p>
                </div>

                {/* Features */}
                <div className="w-20 shrink-0 text-center">
                  <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    {user.metrics.uniqueFeatures14d}
                  </p>
                  <p className="text-[10px] text-stone-400">features</p>
                </div>

                {/* Sessions */}
                <div className="w-20 shrink-0 text-center">
                  <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    {user.metrics.sessionCount14d}
                  </p>
                  <p className="text-[10px] text-stone-400">sessions</p>
                </div>

                {/* Avg session */}
                <div className="hidden xl:block w-20 shrink-0 text-center">
                  <p className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                    {avg > 0 ? `${avg}m` : "—"}
                  </p>
                  <p className="text-[10px] text-stone-400">avg session</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3">
        <p className="text-[10px] text-stone-400 dark:text-stone-600">
          Score bars: <span className="text-emerald-500">■</span> Login freq (30pts) &nbsp;
          <span className="text-blue-400">■</span> Actions (25pts) &nbsp;
          <span className="text-violet-400">■</span> Feature breadth (25pts) &nbsp;
          + Session depth (20pts) &nbsp;·&nbsp; 14-day window
        </p>
      </div>
    </div>
  );
}
