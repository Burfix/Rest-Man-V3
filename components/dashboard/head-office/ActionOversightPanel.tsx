/**
 * ActionOversightPanel
 *
 * Per-store action tracking table — gives executives a clear read on
 * which stores are executing, which are stalling, and which are overdue.
 */

import { cn } from "@/lib/utils";
import type { StoreActionStats } from "@/services/ops/headOffice";

// ── Completion progress bar ───────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] text-stone-300 dark:text-stone-700">—</span>;

  const color =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 50 ? "bg-amber-400"   :
               "bg-red-500";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
        <div className={cn("h-1.5 rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[11px] font-bold tabular-nums shrink-0 w-8 text-right", {
        "text-emerald-600 dark:text-emerald-400": pct >= 80,
        "text-amber-600 dark:text-amber-400":     pct >= 50,
        "text-red-600 dark:text-red-400":         pct < 50,
      })}>
        {pct}%
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  stats: StoreActionStats[];
}

export default function ActionOversightPanel({ stats }: Props) {
  const totals = {
    total:     stats.reduce((s, x) => s + x.total,     0),
    completed: stats.reduce((s, x) => s + x.completed, 0),
    open:      stats.reduce((s, x) => s + x.open,      0),
    overdue:   stats.reduce((s, x) => s + x.overdue,   0),
  };
  const groupPct = totals.total > 0
    ? Math.round((totals.completed / totals.total) * 100)
    : null;

  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 px-5 py-3.5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
          Action Oversight
        </h2>
        {totals.overdue > 0 && (
          <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-2.5 py-px text-[10px] font-bold text-red-700 dark:text-red-300">
            {totals.overdue} overdue
          </span>
        )}
      </div>

      {/* Group summary bar */}
      <div className="grid grid-cols-4 border-b border-stone-100 dark:border-stone-800">
        {[
          { label: "Total",     value: totals.total,     color: "text-stone-700 dark:text-stone-300" },
          { label: "Completed", value: totals.completed, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Open",      value: totals.open,      color: "text-amber-600 dark:text-amber-400" },
          { label: "Overdue",   value: totals.overdue,   color: totals.overdue > 0 ? "text-red-600 dark:text-red-400" : "text-stone-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="px-4 py-2.5 text-center border-r border-stone-100 dark:border-stone-800 last:border-r-0">
            <p className={cn("text-lg font-black tabular-nums leading-none", color)}>{value}</p>
            <p className="text-[10px] text-stone-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Per-store rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_40px_40px_40px_100px] gap-3 px-5 py-2 text-[9px] font-bold uppercase tracking-widest text-stone-400">
          <span>Store</span>
          <span className="text-center">Total</span>
          <span className="text-center">Done</span>
          <span className="text-center text-red-400">Late</span>
          <span>Completion</span>
        </div>

        {stats.map((store) => (
          <div
            key={store.site_id}
            className={cn(
              "grid grid-cols-[1fr_40px_40px_40px_100px] items-center gap-3 px-5 py-3",
              store.overdue > 0 && "bg-red-50/30 dark:bg-red-950/10"
            )}
          >
            {/* Store name */}
            <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
              {store.name}
            </p>

            {/* Total */}
            <p className="text-[11px] tabular-nums text-center text-stone-500">{store.total}</p>

            {/* Completed */}
            <p className="text-[11px] tabular-nums text-center text-emerald-600 dark:text-emerald-400 font-semibold">
              {store.completed}
            </p>

            {/* Overdue */}
            <p className={cn(
              "text-[11px] tabular-nums text-center font-bold",
              store.overdue > 0 ? "text-red-600 dark:text-red-400" : "text-stone-300 dark:text-stone-700"
            )}>
              {store.overdue > 0 ? store.overdue : "—"}
            </p>

            {/* Completion bar */}
            <ProgressBar pct={store.completion_pct} />
          </div>
        ))}
      </div>

      {/* Footer: group completion */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3 flex items-center justify-between">
        <span className="text-[11px] text-stone-400">Group completion rate</span>
        <ProgressBar pct={groupPct} />
      </div>
    </section>
  );
}
