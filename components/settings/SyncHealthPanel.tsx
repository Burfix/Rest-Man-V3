/**
 * components/settings/SyncHealthPanel.tsx
 *
 * Answers: "Is my data trustworthy right now?"
 *
 * Shows one row per sync_type from sync_health_monitor.
 * Green  = last_outcome "success" and not overdue
 * Amber  = last_outcome "empty" or "partial", or overdue but not failing
 * Red    = last_outcome "failed" or consecutive_failures >= 3
 */

interface SyncHealthRow {
  sync_type: string;
  last_synced_at: string | null;
  last_outcome: string | null;
  consecutive_failures: number;
  is_overdue: boolean;
  total_runs_today: number;
  next_run_eta: string | null;
}

interface Props {
  rows: SyncHealthRow[];
}

const SYNC_TYPE_LABELS: Record<string, string> = {
  intraday_sales: "Sales (intraday)",
  daily_sales: "Sales (daily)",
  guest_checks: "Guest Checks",
  intervals: "Sales Intervals",
  labour: "Labour",
};

function rowStatus(row: SyncHealthRow): "green" | "amber" | "red" {
  if (row.consecutive_failures >= 3 || row.last_outcome === "failed") return "red";
  if (row.is_overdue || row.last_outcome === "empty" || row.last_outcome === "partial") return "amber";
  return "green";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusDot({ status }: { status: "green" | "amber" | "red" }) {
  const cls = {
    green: "bg-emerald-500",
    amber: "bg-amber-400",
    red: "bg-red-500",
  }[status];
  return <span className={`inline-block h-2 w-2 rounded-full ${cls} shrink-0`} />;
}

export default function SyncHealthPanel({ rows }: Props) {
  const overall = rows.length === 0
    ? "amber"
    : rows.some((r) => rowStatus(r) === "red")
    ? "red"
    : rows.some((r) => rowStatus(r) === "amber")
    ? "amber"
    : "green";

  const overallLabel = {
    green: "All data streams healthy",
    amber: "Some streams may be stale",
    red: "One or more streams are failing",
  }[overall];

  const overallBg = {
    green: "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
    amber: "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
    red: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
  }[overall];

  return (
    <section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-3 border-b ${overallBg}`}>
        <div className="flex items-center gap-2">
          <StatusDot status={overall} />
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            Data Health
          </h2>
        </div>
        <span className="text-xs text-stone-500 dark:text-stone-400">{overallLabel}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-stone-400">
          No sync health data yet — data will appear after the first scheduled sync.
        </div>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {rows.map((row) => {
            const status = rowStatus(row);
            return (
              <li key={row.sync_type} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusDot status={status} />
                  <span className="text-sm font-medium text-stone-700 dark:text-stone-300 truncate">
                    {SYNC_TYPE_LABELS[row.sync_type] ?? row.sync_type}
                  </span>
                  {row.consecutive_failures > 0 && (
                    <span className="shrink-0 rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                      {row.consecutive_failures} failure{row.consecutive_failures !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0 ml-4 space-y-0.5">
                  <p className="text-xs text-stone-600 dark:text-stone-400">
                    Last sync:{" "}
                    <span className={status === "red" ? "text-red-600 dark:text-red-400 font-medium" : ""}>
                      {relativeTime(row.last_synced_at)}
                    </span>
                  </p>
                  {row.next_run_eta && (
                    <p className="text-[10px] text-stone-400 dark:text-stone-500">
                      Next: {relativeTime(row.next_run_eta)}
                    </p>
                  )}
                  {row.total_runs_today > 0 && (
                    <p className="text-[10px] text-stone-400 dark:text-stone-500">
                      {row.total_runs_today} run{row.total_runs_today !== 1 ? "s" : ""} today
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
