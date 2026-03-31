/**
 * AccountabilityAlert
 *
 * Server component: fetches yesterday's score for the current user.
 * Renders an "At Risk" warning card if score < 60, or nothing if clean.
 * Intended for injection above CommandFeed in the Command Center.
 */

import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getPerformanceTier } from "@/services/accountability/score-calculator";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AccountabilityAlert() {
  try {
    const ctx = await getUserContext();
    const supabase = createServerClient() as any;

    // Yesterday in SAST
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

    const { data } = await supabase
      .from("manager_performance_scores")
      .select("score,completion_rate,on_time_rate,tasks_blocked")
      .eq("user_id", ctx.userId)
      .eq("period_date", yd)
      .maybeSingle();

    if (!data) return null;

    const score = data.score as number;
    const tier  = getPerformanceTier(score);

    if (tier !== "At Risk") return null;

    return (
      <div className="border-l-[3px] border-l-red-600 bg-[#0f0f0f] border border-[#1a1a1a] rounded-sm p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-red-500 mb-0.5">
              Accountability Alert
            </p>
            <p className="text-sm font-medium text-stone-100">
              Your score yesterday was{" "}
              <span className="font-mono font-bold text-red-400">{score}</span>
              {" "}— At Risk
            </p>
            {data.tasks_blocked > 0 && (
              <p className="text-xs text-stone-400 mt-0.5">
                {data.tasks_blocked} blocked task{data.tasks_blocked > 1 ? "s" : ""}
                {data.completion_rate != null && ` · ${Number(data.completion_rate).toFixed(0)}% completion`}
              </p>
            )}
          </div>
          <Link
            href="/dashboard/accountability"
            className="shrink-0 text-[10px] font-mono text-stone-400 hover:text-stone-200 border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-sm px-2 py-1 transition-colors"
          >
            View scores
          </Link>
        </div>
      </div>
    );
  } catch {
    return null;
  }
}
