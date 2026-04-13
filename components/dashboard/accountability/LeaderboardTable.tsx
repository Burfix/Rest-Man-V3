"use client";

import { useState } from "react";
import SiteTrendPanel from "./SiteTrendPanel";
import type { PerformanceTier } from "@/services/accountability/score-calculator";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LeaderboardEntry = {
  userId: string;
  name: string;
  site: string;
  siteId: string;
  avgScore: number;
  tier: PerformanceTier;
  daysActive: number;
  completionRate: number;
  totalBlocked: number;
  totalEscalated: number;
};

// ── Helpers (mirrored from page.tsx) ─────────────────────────────────────────

function tierBg(tier: PerformanceTier): string {
  switch (tier) {
    case "Elite":   return "bg-emerald-950/60 text-emerald-400 border border-emerald-900";
    case "Strong":  return "bg-sky-950/60 text-sky-400 border border-sky-900";
    case "Average": return "bg-amber-950/60 text-amber-400 border border-amber-900";
    case "At Risk": return "bg-red-950/60 text-red-400 border border-red-900";
  }
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-400";
  if (score >= 75) return "text-sky-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LeaderboardTable({
  entries,
  currentUserId,
}: {
  entries: LeaderboardEntry[];
  currentUserId: string;
}) {
  const [selectedSiteId, setSelectedSiteId]     = useState<string | null>(null);
  const [selectedSiteName, setSelectedSiteName] = useState("");
  const [selectedUserId, setSelectedUserId]     = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState("");

  function handleRowClick(entry: LeaderboardEntry) {
    if (!entry.siteId) return;
    setSelectedSiteId(entry.siteId);
    setSelectedSiteName(entry.site);
    setSelectedUserId(entry.userId);
    setSelectedUserName(entry.name);
  }

  return (
    <>
      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1a1a1a]">
              <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500 w-8">#</th>
              <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">GM</th>
              <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Site</th>
              <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Avg Score</th>
              <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Tier</th>
              <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Completion</th>
              <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Days</th>
              <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Blocks</th>
              <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Escalations</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr
                key={entry.userId}
                onClick={() => handleRowClick(entry)}
                className={`border-b border-[#141414] hover:bg-[#141414] cursor-pointer ${
                  entry.tier === "At Risk" ? "border-l-[3px] border-l-red-800" : ""
                } ${selectedSiteId === entry.siteId ? "bg-[#141414]" : ""}`}
              >
                <td className="px-3 py-2 font-mono text-stone-500 text-center">{i + 1}</td>
                <td className="px-3 py-2">
                  <span
                    className={`font-medium ${
                      entry.userId === currentUserId
                        ? "text-amber-400"
                        : "text-stone-700 dark:text-stone-200"
                    }`}
                  >
                    {entry.name}
                    {entry.userId === currentUserId && (
                      <span className="ml-1.5 text-[9px] text-amber-600 font-mono">(you)</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-stone-500 dark:text-stone-400">
                  <span className="flex items-center gap-1.5">
                    {entry.site}
                    {entry.siteId && (
                      <svg
                        className="w-2.5 h-2.5 text-stone-600 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </span>
                </td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${scoreColor(entry.avgScore)}`}>
                  {entry.avgScore}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${tierBg(entry.tier)}`}>
                    {entry.tier}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-stone-600 dark:text-stone-300">
                  {pct(entry.completionRate)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-stone-500 dark:text-stone-400">
                  {entry.daysActive}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${
                    entry.totalBlocked > 0 ? "text-red-400" : "text-stone-500"
                  }`}
                >
                  {entry.totalBlocked}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${
                    entry.totalEscalated > 0 ? "text-amber-400" : "text-stone-500"
                  }`}
                >
                  {entry.totalEscalated}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedSiteId && selectedUserId && (
        <SiteTrendPanel
          siteId={selectedSiteId}
          siteName={selectedSiteName}
          userId={selectedUserId}
          userName={selectedUserName}
          onClose={() => { setSelectedSiteId(null); setSelectedUserId(null); }}
        />
      )}
    </>
  );
}
