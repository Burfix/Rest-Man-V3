/**
 * /dashboard/accountability
 *
 * My Performance — last 30 days score history for the signed-in GM.
 * Leaderboard     — all GMs ranked (head_office / area_manager only).
 */

import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getPerformanceTier } from "@/services/accountability/score-calculator";
import type { PerformanceTier } from "@/services/accountability/score-calculator";
import DailyScoreChart from "@/components/accountability/DailyScoreChart";
import LeaderboardTable from "@/components/dashboard/accountability/LeaderboardTable";

export const dynamic  = "force-dynamic";
export const revalidate = 0;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Helpers ───────────────────────────────────────────────────────────────────

const ELEVATED = ["super_admin", "head_office", "executive", "area_manager"];

function tierColor(tier: PerformanceTier): string {
  switch (tier) {
    case "Elite":   return "text-emerald-400";
    case "Strong":  return "text-sky-400";
    case "Average": return "text-amber-400";
    case "At Risk": return "text-red-400";
  }
}

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

function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().split("T")[0];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AccountabilityPage({
  searchParams,
}: {
  searchParams?: { period?: string };
}) {
  const ctx = await getUserContext();
  const supabase = createServerClient() as any;

  const isElevated = ELEVATED.includes(ctx.role ?? "");
  const period     = searchParams?.period === "30d" ? "30d" : "7d";
  const lbDays     = period === "30d" ? 30 : 7;
  const since30    = sinceDate(30);
  const sinceLb    = sinceDate(lbDays);

  // ── My Performance (last 30 days) ─────────────────────────────────────────
  const { data: myScoreRows } = await supabase
    .from("manager_performance_scores")
    .select("period_date,score,completion_rate,on_time_rate,tasks_assigned,tasks_completed,tasks_on_time,tasks_late,tasks_blocked,tasks_escalated")
    .eq("user_id", ctx.userId)
    .gte("period_date", since30)
    .order("period_date", { ascending: false });

  const myScores = (myScoreRows ?? []) as any[];
  const hasMyData = myScores.length > 0;

  let myAggregate: any = null;
  if (hasMyData) {
    const totalAssigned  = myScores.reduce((s, r) => s + (r.tasks_assigned  ?? 0), 0);
    const totalCompleted = myScores.reduce((s, r) => s + (r.tasks_completed ?? 0), 0);
    const totalOnTime    = myScores.reduce((s, r) => s + (r.tasks_on_time   ?? 0), 0);
    const totalBlocked   = myScores.reduce((s, r) => s + (r.tasks_blocked   ?? 0), 0);
    const totalEscalated = myScores.reduce((s, r) => s + (r.tasks_escalated ?? 0), 0);
    const avgScore       = myScores.reduce((s, r) => s + r.score, 0) / myScores.length;
    const best = myScores.reduce((a, b) => (a.score >= b.score ? a : b));
    const worst = myScores.reduce((a, b) => (a.score <= b.score ? a : b));
    myAggregate = {
      avgScore: Math.round(avgScore),
      tier: getPerformanceTier(Math.round(avgScore)),
      completionRate: totalAssigned > 0 ? +((totalCompleted / totalAssigned) * 100).toFixed(1) : 0,
      onTimeRate:     totalCompleted > 0 ? +((totalOnTime / totalCompleted) * 100).toFixed(1) : 0,
      totalBlocked,
      totalEscalated,
      best,
      worst,
    };
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────
  let leaderboard: any[] = [];

  if (isElevated) {
    const { data: lbRows } = await supabase
      .from("manager_performance_scores")
      .select("user_id,site_id,period_date,score,completion_rate,on_time_rate,tasks_assigned,tasks_completed,tasks_blocked,tasks_escalated")
      .gte("period_date", sinceLb);

    const lbList = (lbRows ?? []) as any[];

    // Resolve names
    const userIds = Array.from(new Set(lbList.map((r) => r.user_id as string)));
    const { data: profileRows } = await supabase
      .from("user_roles")
      .select("user_id,full_name,site_id")
      .in("user_id", userIds)
      .eq("is_active", true);

    const nameMap = new Map<string, string>(
      (profileRows ?? []).map((p: any) => [p.user_id, p.full_name ?? "Unknown"])
    );

    // Site names
    const siteIds = Array.from(new Set(lbList.map((r) => r.site_id as string)));
    const { data: siteRows } = await supabase
      .from("sites")
      .select("id,name")
      .in("id", siteIds);
    const siteMap = new Map<string, string>(
      (siteRows ?? []).map((s: any) => [s.id, s.name])
    );

    // Group by user_id
    const groups = new Map<string, any[]>();
    for (const r of lbList) {
      if (!groups.has(r.user_id)) groups.set(r.user_id, []);
      groups.get(r.user_id)!.push(r);
    }

    for (const [userId, rows] of Array.from(groups.entries())) {
      const avgScore  = rows.reduce((s, r) => s + r.score, 0) / rows.length;
      const ta        = rows.reduce((s, r) => s + (r.tasks_assigned  ?? 0), 0);
      const tc        = rows.reduce((s, r) => s + (r.tasks_completed ?? 0), 0);
      const tb        = rows.reduce((s, r) => s + (r.tasks_blocked   ?? 0), 0);
      const te        = rows.reduce((s, r) => s + (r.tasks_escalated ?? 0), 0);
      const compRate  = ta > 0 ? +((tc / ta) * 100).toFixed(1) : 0;
      const site      = rows[0]?.site_id;
      leaderboard.push({
        userId,
        name:           nameMap.get(userId) ?? "Unknown",
        site:           siteMap.get(site) ?? "—",
        siteId:         site ?? "",
        avgScore:       Math.round(avgScore),
        tier:           getPerformanceTier(Math.round(avgScore)),
        daysActive:     rows.length,
        completionRate: compRate,
        totalBlocked:   tb,
        totalEscalated: te,
      });
    }

    leaderboard.sort((a, b) => b.avgScore - a.avgScore);
  }

  const atRiskCount = leaderboard.filter((e) => e.avgScore < 60).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-[#1a1a1a] pb-4">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-1">
          Accountability
        </p>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
          Performance Scores
        </h1>
        <p className="text-xs text-stone-500 mt-0.5">
          Daily manager performance — completion, on-time rate, blocks, escalations
        </p>
      </div>

      {/* ── My Performance ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
          My Performance — Last 30 Days
        </h2>

        {!hasMyData ? (
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-6 text-center">
            <p className="text-sm text-stone-500">No score data yet. Scores are computed nightly after tasks are completed.</p>
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
              {/* Avg Score */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mb-1">Avg Score</p>
                <p className={`text-2xl font-mono font-bold ${scoreColor(myAggregate.avgScore)}`}>
                  {myAggregate.avgScore}
                </p>
                <span className={`mt-1 inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${tierBg(myAggregate.tier)}`}>
                  {myAggregate.tier}
                </span>
              </div>

              {/* Completion */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mb-1">Completion</p>
                <p className={`text-2xl font-mono font-bold ${myAggregate.completionRate >= 90 ? "text-emerald-400" : myAggregate.completionRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                  {pct(myAggregate.completionRate)}
                </p>
              </div>

              {/* On-time Rate */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mb-1">On-Time</p>
                <p className={`text-2xl font-mono font-bold ${myAggregate.onTimeRate >= 90 ? "text-emerald-400" : myAggregate.onTimeRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                  {pct(myAggregate.onTimeRate)}
                </p>
              </div>

              {/* Blocks */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mb-1">Blocks</p>
                <p className={`text-2xl font-mono font-bold ${myAggregate.totalBlocked > 0 ? "text-red-400" : "text-stone-500 dark:text-stone-400"}`}>
                  {myAggregate.totalBlocked}
                </p>
              </div>

              {/* Best Day */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mb-1">Best Day</p>
                <p className="text-2xl font-mono font-bold text-emerald-400">{myAggregate.best.score}</p>
                <p className="text-[9px] text-stone-500 mt-0.5 font-mono">{myAggregate.best.period_date}</p>
              </div>

              {/* Worst Day */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mb-1">Worst Day</p>
                <p className="text-2xl font-mono font-bold text-red-400">{myAggregate.worst.score}</p>
                <p className="text-[9px] text-stone-500 mt-0.5 font-mono">{myAggregate.worst.period_date}</p>
              </div>
            </div>

            {/* Score Chart */}
            <DailyScoreChart
              data={myScores.map((r: any) => ({
                date: r.period_date,
                score: r.score,
                completionRate: Number(r.completion_rate),
                onTimeRate: Number(r.on_time_rate),
                tasksAssigned: r.tasks_assigned,
                tasksCompleted: r.tasks_completed,
              }))}
            />

            {/* Score History Table */}
            <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    <th className="text-left px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Date</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Score</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Tier</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Completion</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">On-Time</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Assigned</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Done</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-stone-500">Blocks</th>
                  </tr>
                </thead>
                <tbody>
                  {myScores.map((row: any) => {
                    const tier = getPerformanceTier(row.score);
                    return (
                      <tr key={row.period_date} className="border-b border-[#141414] hover:bg-[#141414]">
                        <td className="px-3 py-2 font-mono text-stone-600 dark:text-stone-300">{row.period_date}</td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${scoreColor(row.score)}`}>{row.score}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm ${tierBg(tier)}`}>{tier}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600 dark:text-stone-300">{pct(row.completion_rate)}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600 dark:text-stone-300">{pct(row.on_time_rate)}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-500 dark:text-stone-400">{row.tasks_assigned}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-500 dark:text-stone-400">{row.tasks_completed}</td>
                        <td className={`px-3 py-2 text-right font-mono ${row.tasks_blocked > 0 ? "text-red-400" : "text-stone-500"}`}>{row.tasks_blocked}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Leaderboard (elevated only) ─────────────────────────────────── */}
      {isElevated && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500">
                GM Leaderboard
              </h2>
              {atRiskCount > 0 && (
                <p className="text-xs text-red-400 mt-0.5">
                  {atRiskCount} GM{atRiskCount > 1 ? "s" : ""} At Risk
                </p>
              )}
            </div>
            {/* Period toggle */}
            <div className="flex items-center gap-1 bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-0.5">
              <Link
                href="/dashboard/accountability?period=7d"
                className={`text-[10px] font-mono px-3 py-1 rounded-sm transition-colors ${
                  period === "7d"
                    ? "bg-[#1a1a1a] text-stone-100"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                7D
              </Link>
              <Link
                href="/dashboard/accountability?period=30d"
                className={`text-[10px] font-mono px-3 py-1 rounded-sm transition-colors ${
                  period === "30d"
                    ? "bg-[#1a1a1a] text-stone-100"
                    : "text-stone-500 hover:text-stone-300"
                }`}
              >
                30D
              </Link>
            </div>
          </div>

          {leaderboard.length === 0 ? (
            <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-6 text-center">
              <p className="text-sm text-stone-500">No score data for this period.</p>
            </div>
          ) : (
            <LeaderboardTable entries={leaderboard} currentUserId={ctx.userId} />
          )}
        </section>
      )}

    </div>
  );
}
