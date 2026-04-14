/**
 * /dashboard/head-office/site/[siteId]
 *
 * Store drill-down page for Head Office users.
 * Server component — fetches data directly from the API route.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";

interface Props {
  params: { siteId: string };
}

interface DrillDownData {
  site: { id: string; name: string; site_type: string | null } | null;
  scores: {
    period_date: string;
    score: number;
    tasks_assigned: number;
    tasks_completed: number;
    tasks_on_time: number;
    tasks_late: number;
  }[];
  tasks: {
    id: string;
    action_name: string;
    status: string;
    assigned_to: string | null;
    due_time: string | null;
  }[];
  maintenance: {
    id: string;
    unit_name: string;
    priority: string;
    repair_status: string;
    date_reported: string;
  }[];
}

async function getDrillDown(siteId: string, cookie: string): Promise<DrillDownData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/head-office/site/${siteId}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<DrillDownData>;
}

export default async function SiteDrillDownPage({ params }: Props) {
  // Auth check
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Forward the request cookie so the API route can authenticate
  const { cookies } = await import("next/headers");
  const cookieStore = cookies();
  const cookieHeader = cookieStore.getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const data = await getDrillDown(params.siteId, cookieHeader);

  if (!data || !data.site) {
    return (
      <div className="p-8">
        <Link href="/dashboard/head-office" className="text-sm text-stone-500 hover:underline">← Head Office</Link>
        <p className="mt-6 text-stone-500">Site not found or access denied.</p>
      </div>
    );
  }

  const { site, scores, tasks, maintenance } = data;

  const completedTasks  = tasks.filter((t) => t.status === "completed").length;
  const pendingTasks    = tasks.filter((t) => t.status !== "completed").length;
  const criticalMaint   = maintenance.filter((m) => m.priority === "critical").length;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link href="/dashboard/head-office" className="text-sm text-stone-500 hover:underline">
        ← Head Office
      </Link>

      {/* Site header */}
      <div>
        <h1 className="text-2xl font-black text-stone-900 dark:text-stone-100">{site.name}</h1>
        <p className="text-sm text-stone-500 capitalize">{site.site_type ?? "Restaurant"}</p>
      </div>

      {/* 7-day score table */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">
          7-Day Performance
        </h2>
        {scores.length === 0 ? (
          <p className="text-sm text-stone-400">No score data in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 dark:bg-stone-800 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-right">Score</th>
                  <th className="px-4 py-2 text-right">Assigned</th>
                  <th className="px-4 py-2 text-right">Completed</th>
                  <th className="px-4 py-2 text-right">On Time</th>
                  <th className="px-4 py-2 text-right">Late</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {scores.map((row) => (
                  <tr key={row.period_date} className="bg-white dark:bg-stone-900">
                    <td className="px-4 py-2 tabular-nums text-stone-600 dark:text-stone-400">{row.period_date}</td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums"
                      style={{ color: row.score >= 75 ? "#10b981" : row.score >= 60 ? "#f59e0b" : "#ef4444" }}>
                      {row.score}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-600 dark:text-stone-400">{row.tasks_assigned}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-600 dark:text-stone-400">{row.tasks_completed}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-600 dark:text-stone-400">{row.tasks_on_time}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-600 dark:text-stone-400">{row.tasks_late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Today's tasks */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">
          Today's Tasks — {completedTasks} / {tasks.length} complete
          {pendingTasks > 0 && <span className="ml-2 text-amber-500">{pendingTasks} pending</span>}
        </h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-stone-400">No tasks for today.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 text-sm">
                <span className={t.status === "completed" ? "text-emerald-500" : "text-amber-500"}>
                  {t.status === "completed" ? "✓" : "○"}
                </span>
                <span className="text-stone-700 dark:text-stone-300">{t.action_name}</span>
                {t.due_time && (
                  <span className="text-xs text-stone-400 ml-auto">{t.due_time}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Open maintenance */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">
          Open Maintenance
          {criticalMaint > 0 && (
            <span className="ml-2 text-red-500">{criticalMaint} critical</span>
          )}
        </h2>
        {maintenance.length === 0 ? (
          <p className="text-sm text-stone-400">No open maintenance issues.</p>
        ) : (
          <ul className="space-y-1">
            {maintenance.map((m) => (
              <li key={m.id} className="flex items-center gap-3 text-sm">
                <span className={
                  m.priority === "critical" ? "text-red-500" :
                  m.priority === "high"     ? "text-amber-500" : "text-stone-400"
                }>●</span>
                <span className="text-stone-700 dark:text-stone-300">{m.unit_name}</span>
                <span className="text-xs text-stone-400 capitalize ml-auto">{m.repair_status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
