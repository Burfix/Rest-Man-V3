/**
 * Actions — execution-driven operations board
 *
 * Server component: fetches active actions + performance metrics.
 * Client component (ActionsBoard) handles all mutations.
 */

import { createServerClient } from "@/lib/supabase/server";
import ActionsBoard, { type Action } from "@/components/dashboard/actions/ActionsBoard";
import DailyOpsSummaryPanel from "@/components/dashboard/actions/DailyOpsSummaryPanel";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

// ── Performance metric fetcher ────────────────────────────────────────────────

async function getPerformance() {
  try {
    const supabase = createServerClient();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    const { data: recentCompleted } = await supabase
      .from("actions")
      .select("created_at, completed_at")
      .not("completed_at", "is", null)
      .gte("completed_at", `${sevenDaysAgoStr}T00:00:00.000Z`)
      .limit(500);

    let avgResolutionMinutes: number | null = null;
    if (recentCompleted && recentCompleted.length > 0) {
      const totalMs = recentCompleted.reduce((sum: number, a: { created_at: string; completed_at: string | null }) => {
        if (!a.completed_at || !a.created_at) return sum;
        return sum + (new Date(a.completed_at).getTime() - new Date(a.created_at).getTime());
      }, 0);
      avgResolutionMinutes = Math.round(totalMs / recentCompleted.length / 60_000);
    }

    return { avgResolutionMinutes, totalCompletedLast7: recentCompleted?.length ?? 0 };
  } catch {
    return { avgResolutionMinutes: null, totalCompletedLast7: 0 };
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ActionsPage() {
  let actions: Action[] = [];
  let loadError: string | null = null;
  let perf = { avgResolutionMinutes: null as number | null, totalCompletedLast7: 0 };

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("actions")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    actions = (data ?? []) as Action[];
    perf    = await getPerformance();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error";
  }

  const pendingCount    = actions.filter((a) => a.status === "pending").length;
  const inProgressCount = actions.filter((a) => a.status === "in_progress").length;
  const completedCount  = actions.filter((a) => a.status === "completed").length;

  function fmtTime(mins: number | null): string {
    if (mins === null) return "—";
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Actions</h1>
        <p className="mt-1 text-sm text-stone-500">
          Operational execution board — track every action from creation to completion.
        </p>
      </div>

      {/* Daily Ops Summary — morning brief / evening debrief */}
      <DailyOpsSummaryPanel />

      {/* Error banner */}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          ⚠ Could not load actions: <code className="font-mono">{loadError}</code>
        </div>
      )}

      {/* KPI strip */}
      {!loadError && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Pending</p>
            <p className="mt-1 text-3xl font-bold text-stone-900">{pendingCount}</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">In Progress</p>
            <p className="mt-1 text-3xl font-bold text-blue-700">{inProgressCount}</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-green-600 uppercase tracking-wide">Completed Today</p>
            <p className="mt-1 text-3xl font-bold text-green-700">{completedCount}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Avg Resolution</p>
            <p className="mt-1 text-3xl font-bold text-stone-900">{fmtTime(perf.avgResolutionMinutes)}</p>
            <p className="text-xs text-stone-400">last 7 days</p>
          </div>
        </div>
      )}

      {/* Daily reset hint */}
      {!loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-stone-100 bg-stone-50 px-4 py-2.5 text-xs text-stone-500">
          <svg className="h-4 w-4 shrink-0 text-stone-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd"/>
          </svg>
          <span>
            Completed actions are archived daily at midnight.{" "}
            <strong>Pending and in-progress actions carry forward automatically.</strong>
          </span>
        </div>
      )}

      {/* Board */}
      {!loadError && <ActionsBoard initial={actions} />}
    </div>
  );
}
